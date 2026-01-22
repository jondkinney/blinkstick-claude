#!/usr/bin/env node
import { BlinkStick } from "blinkstick-node/source/BlinkStick.js";
import {
  existsSync,
  writeFileSync,
  unlinkSync,
  readFileSync,
  appendFileSync,
  readdirSync,
  openSync,
  closeSync,
} from "fs";
import { spawn } from "child_process";

const LOCK_FILE = "/tmp/blinkstick.lock";
const STATE_FILE = "/tmp/blinkstick-state.json";
const LOG_FILE = "/tmp/blinkstick.log";
const STALE_TIMEOUT = 30000; // Sessions older than 30s are considered stale
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fit-statUSB color mapping (single LED, RGB hex codes)
const FIT_STAT_COLORS = {
  working: "#AA0800", // red-orange (tuned for LED)
  ready: "#00FF00", // full green
  "dim-green": "#001900", // dim green
  split: "#FF4600", // full yellow (tuned for LED)
  "dim-split": "#641800", // dim yellow (tuned for LED)
  question: "#FF0080", // hot pink
  "dim-question": "#18000C", // dim pink (tuned for LED)
};

// Cached fit-statUSB port path (detected once per run)
let cachedFitStatPort = null;

/**
 * Detect fit-statUSB device by scanning /dev/cu.usbmodem* ports
 * Returns the port path if found, null otherwise
 */
function detectFitStatUSB() {
  if (cachedFitStatPort !== null) {
    // Return cached result (empty string means "not found" was cached)
    return cachedFitStatPort || null;
  }

  try {
    const devFiles = readdirSync("/dev");
    const modemPorts = devFiles
      .filter((f) => f.startsWith("cu.usbmodem"))
      .map((f) => `/dev/${f}`);

    for (const port of modemPorts) {
      try {
        // Try to open and write to the port to verify it's the fit-statUSB
        // The fit-statUSB responds to '?' with its UUID
        const fd = openSync(port, "r+");
        closeSync(fd);
        // If we can open it, assume it's the fit-statUSB for now
        // (A more robust check would send '?' and verify the response)
        cachedFitStatPort = port;
        log(`Detected fit-statUSB at ${port}`);
        return port;
      } catch (e) {
        // Port not accessible, try next
      }
    }
  } catch (e) {
    // /dev directory read failed
  }

  cachedFitStatPort = ""; // Cache "not found"
  return null;
}

/**
 * Set fit-statUSB LED color for the given mode
 */
async function setFitStatUSB(mode) {
  const port = detectFitStatUSB();
  if (!port) {
    return false;
  }

  const color = FIT_STAT_COLORS[mode];
  if (!color) {
    log(`Unknown mode for fit-statUSB: ${mode}`);
    return false;
  }

  try {
    const fd = openSync(port, "w");
    const command = `${color}\n`;
    writeFileSync(fd, command);
    closeSync(fd);
    log(`fit-statUSB: set ${mode} (${color})`);
    return true;
  } catch (e) {
    log(`fit-statUSB error: ${e.message}`);
    // Invalidate cache so we can retry detection
    cachedFitStatPort = null;
    return false;
  }
}

function log(msg) {
  const timestamp = new Date().toISOString();
  appendFileSync(LOG_FILE, `${timestamp} ${msg}\n`);
}

function getSessionId() {
  // Use env var if available, otherwise use arg, otherwise generate one
  return (
    process.env.CLAUDE_SESSION_ID || process.argv[3] || `session-${process.pid}`
  );
}

function readState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf8"));
    }
  } catch (e) {
    log(`Error reading state: ${e.message}`);
  }
  return { sessions: {} };
}

function writeState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function updateSessionState(sessionId, mode) {
  const state = readState();
  const now = Date.now();

  // Clean up stale sessions
  for (const [id, data] of Object.entries(state.sessions)) {
    if (now - data.timestamp > STALE_TIMEOUT) {
      delete state.sessions[id];
      log(`Cleaned up stale session: ${id}`);
    }
  }

  // Update this session's state
  state.sessions[sessionId] = { mode, timestamp: now };
  writeState(state);

  return state;
}

function getEffectiveMode(state, thisSessionMode) {
  const sessions = Object.values(state.sessions);
  if (sessions.length === 0) {
    return "ready"; // Default to green when no sessions
  }

  // If this session just started working, always show orange
  // (we don't care about other sessions' ready states when starting work)
  if (thisSessionMode === "working") {
    return "working";
  }

  // This session just finished (ready or question)
  // Check if any sessions are still working
  const workingCount = sessions.filter((s) => s.mode === "working").length;

  if (workingCount > 0) {
    // Other sessions still working - show yellow (split)
    return "split";
  }

  // No sessions working - show this session's completion state
  // Check if any session has a question
  const hasQuestion = sessions.some((s) => s.mode === "question");
  if (hasQuestion) {
    return "question";
  }

  return "ready";
}

async function acquireLock(timeout = 2000) {
  const start = Date.now();
  while (existsSync(LOCK_FILE)) {
    try {
      const lockTime = parseInt(readFileSync(LOCK_FILE, "utf8"));
      if (Date.now() - lockTime > 3000) {
        unlinkSync(LOCK_FILE);
        break;
      }
    } catch (e) {
      break;
    }
    if (Date.now() - start > timeout) {
      return false;
    }
    await sleep(50);
  }
  writeFileSync(LOCK_FILE, Date.now().toString());
  return true;
}

function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch (e) {}
}

/**
 * Set BlinkStick LEDs for the given mode
 * Returns true if successful, false otherwise
 */
async function setBlinkStick(mode, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const devices = BlinkStick.findAll();
    if (devices.length === 0) {
      return false; // No BlinkStick found (not an error)
    }

    const device = devices[0];
    try {
      await device.connect();
      await sleep(200);

      // Build LED data array - 8 LEDs × 3 bytes (GRB order for WS2812)
      let ledData;
      if (mode === "working") {
        // LED 0 = dim orange, rest off
        ledData = [20, 100, 0, ...Array(21).fill(0)];
      } else if (mode === "ready") {
        // All LEDs full green
        ledData = Array(8).fill([255, 0, 0]).flat();
      } else if (mode === "split") {
        // All LEDs bright yellow for mixed state (attention-grabbing)
        ledData = Array(8).fill([255, 255, 0]).flat(); // GRB for yellow × 8
      } else if (mode === "dim-green") {
        // LED 0 = dim green, rest off
        ledData = [100, 0, 0, ...Array(21).fill(0)];
      } else if (mode === "dim-split") {
        // Single dim yellow LED for mixed state
        ledData = [100, 100, 0, ...Array(21).fill(0)]; // GRB for dim yellow on LED 0
      } else if (mode === "question") {
        // All LEDs magenta/purple for "needs input" state
        ledData = Array(8).fill([0, 255, 255]).flat(); // GRB: G=0, R=255, B=255 = magenta
      } else if (mode === "dim-question") {
        // Single dim magenta LED for question state
        ledData = [0, 100, 100, ...Array(21).fill(0)]; // GRB for dim magenta on LED 0
      }

      // Send all LEDs in one batch command (report ID 6)
      device.hid.sendFeatureReport([6, 0, ...ledData]);

      await sleep(10);
      await device.disconnect();
      log(`BlinkStick: set ${mode}`);
      return true;
    } catch (e) {
      log(`BlinkStick attempt ${attempt} error: ${e.message}`);
      try {
        await device.disconnect();
      } catch (e2) {}
      if (attempt < retries) {
        await sleep(300 * attempt); // Increasing backoff
      }
    }
  }
  return false;
}

/**
 * Set all LED devices (BlinkStick and fit-statUSB) to the given mode
 * Returns true if at least one device was updated
 */
async function setLeds(mode) {
  const [blinkstickOk, fitstatOk] = await Promise.all([
    setBlinkStick(mode),
    setFitStatUSB(mode),
  ]);

  if (!blinkstickOk && !fitstatOk) {
    log("No LED devices found");
    return false;
  }

  return true;
}

const mode = process.argv[2];
const sessionId = getSessionId();

// Handle delayed dim modes
if (mode === "dim-green" || mode === "dim-split" || mode === "dim-question") {
  const delay = parseInt(process.env.BLINKSTICK_DIM_DELAY || "0");
  if (delay > 0) {
    log(`Waiting ${delay}ms before ${mode}`);
    await sleep(delay);
  }
}

log(`Starting: mode=${mode}, session=${sessionId}`);

// dim modes check state first and adapt to current state
if (mode === "dim-green" || mode === "dim-split" || mode === "dim-question") {
  if (await acquireLock()) {
    const state = readState();
    const now = Date.now();

    // Clean stale sessions before checking
    for (const [id, data] of Object.entries(state.sessions)) {
      if (now - data.timestamp > STALE_TIMEOUT) {
        delete state.sessions[id];
      }
    }

    const effectiveMode = getEffectiveMode(state, null);
    if (effectiveMode === "ready") {
      await setLeds("dim-green");
      log("dim complete (green)");
    } else if (effectiveMode === "split") {
      await setLeds("dim-split");
      log("dim complete (split)");
    } else if (effectiveMode === "question") {
      await setLeds("dim-question");
      log("dim complete (question)");
    } else {
      log(`dim skipped - current mode is ${effectiveMode}`);
    }
    releaseLock();
  }
} else if (await acquireLock()) {
  log(`Lock acquired for ${mode}`);

  // Update this session's state and get effective mode
  const state = updateSessionState(sessionId, mode);
  const effectiveMode = getEffectiveMode(state, mode);

  log(`Sessions: ${JSON.stringify(state.sessions)}`);
  log(`Effective mode: ${effectiveMode} (this session: ${mode})`);

  await setLeds(effectiveMode);
  releaseLock();
  log(`Lock released for ${mode}`);

  // Schedule dim after 5 seconds for ready/split/question modes (non-blocking)
  if (effectiveMode === "ready" || effectiveMode === "split" || effectiveMode === "question") {
    const dimMode =
      effectiveMode === "split"
        ? "dim-split"
        : effectiveMode === "question"
          ? "dim-question"
          : "dim-green";
    const child = spawn(process.argv[0], [process.argv[1], dimMode], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, BLINKSTICK_DIM_DELAY: "5000" },
    });
    child.unref();
    log(`Scheduled ${dimMode} in background`);
  }
} else {
  log(`Could not acquire lock for ${mode}`);
}

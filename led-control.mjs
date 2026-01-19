#!/usr/bin/env node
import { BlinkStick } from "blinkstick-node/source/BlinkStick.js";
import {
  existsSync,
  writeFileSync,
  unlinkSync,
  readFileSync,
  appendFileSync,
} from "fs";
import { spawn } from "child_process";

const LOCK_FILE = "/tmp/blinkstick.lock";
const STATE_FILE = "/tmp/blinkstick-state.json";
const LOG_FILE = "/tmp/blinkstick.log";
const STALE_TIMEOUT = 30000; // Sessions older than 30s are considered stale
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function getEffectiveMode(state) {
  const sessions = Object.values(state.sessions);
  if (sessions.length === 0) {
    return "ready"; // Default to green when no sessions
  }

  const hasReady = sessions.some((s) => s.mode === "ready");
  const hasWorking = sessions.some((s) => s.mode === "working");

  if (hasReady && hasWorking) {
    return "split"; // Some ready, some working
  } else if (hasReady) {
    return "ready"; // All ready
  } else {
    return "working"; // All working
  }
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

async function setLeds(mode, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const devices = BlinkStick.findAll();
    if (devices.length === 0) {
      log("No device found");
      return false;
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
        log("Set orange (dim)");
      } else if (mode === "ready") {
        // All LEDs full green
        ledData = Array(8).fill([255, 0, 0]).flat();
        log("Set green (full)");
      } else if (mode === "split") {
        // All LEDs bright yellow for mixed state (attention-grabbing)
        ledData = Array(8).fill([255, 255, 0]).flat(); // GRB for yellow × 8
        log("Set yellow (full)");
      } else if (mode === "dim-green") {
        // LED 0 = dim green, rest off
        ledData = [100, 0, 0, ...Array(21).fill(0)];
        log("Set green (dim)");
      } else if (mode === "dim-split") {
        // Single dim yellow LED for mixed state
        ledData = [100, 100, 0, ...Array(21).fill(0)]; // GRB for dim yellow on LED 0
        log("Set yellow (dim)");
      }

      // Send all LEDs in one batch command (report ID 6)
      device.hid.sendFeatureReport([6, 0, ...ledData]);

      await sleep(10);
      await device.disconnect();
      return true;
    } catch (e) {
      log(`Attempt ${attempt} error: ${e.message}`);
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

const mode = process.argv[2];
const sessionId = getSessionId();

// Handle delayed dim modes
if (mode === "dim-green" || mode === "dim-split") {
  const delay = parseInt(process.env.BLINKSTICK_DIM_DELAY || "0");
  if (delay > 0) {
    log(`Waiting ${delay}ms before ${mode}`);
    await sleep(delay);
  }
}

log(`Starting: mode=${mode}, session=${sessionId}`);

// dim modes check state first and adapt to current state
if (mode === "dim-green" || mode === "dim-split") {
  if (await acquireLock()) {
    const state = readState();
    const now = Date.now();

    // Clean stale sessions before checking
    for (const [id, data] of Object.entries(state.sessions)) {
      if (now - data.timestamp > STALE_TIMEOUT) {
        delete state.sessions[id];
      }
    }

    const effectiveMode = getEffectiveMode(state);
    if (effectiveMode === "ready") {
      await setLeds("dim-green");
      log("dim complete (green)");
    } else if (effectiveMode === "split") {
      await setLeds("dim-split");
      log("dim complete (split)");
    } else {
      log(`dim skipped - current mode is ${effectiveMode}`);
    }
    releaseLock();
  }
} else if (await acquireLock()) {
  log(`Lock acquired for ${mode}`);

  // Update this session's state and get effective mode
  const state = updateSessionState(sessionId, mode);
  const effectiveMode = getEffectiveMode(state);

  log(`Sessions: ${JSON.stringify(state.sessions)}`);
  log(`Effective mode: ${effectiveMode} (this session: ${mode})`);

  await setLeds(effectiveMode);
  releaseLock();
  log(`Lock released for ${mode}`);

  // Schedule dim after 5 seconds for ready/split modes (non-blocking)
  if (effectiveMode === "ready" || effectiveMode === "split") {
    const dimMode = effectiveMode === "split" ? "dim-split" : "dim-green";
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

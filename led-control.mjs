#!/usr/bin/env node
/**
 * LED Control Script
 * Manages multi-session state and controls LED devices via adapters
 */
import {
  existsSync,
  writeFileSync,
  unlinkSync,
  readFileSync,
  appendFileSync,
} from "fs";
import { spawn } from "child_process";
import { LedManager } from "./adapters/index.mjs";

const LOCK_FILE = "/tmp/blinkstick.lock";
const STATE_FILE = "/tmp/blinkstick-state.json";
const LOG_FILE = "/tmp/blinkstick.log";
const STALE_TIMEOUT = 30000; // Sessions older than 30s are considered stale
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Initialize LED manager
let ledManager;
try {
  ledManager = new LedManager();
} catch (e) {
  console.error(`Failed to initialize LED manager: ${e.message}`);
  process.exit(1);
}

function log(msg) {
  const timestamp = new Date().toISOString();
  appendFileSync(LOG_FILE, `${timestamp} ${msg}\n`);
}

function getSessionId() {
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
    return "ready";
  }

  // If this session just started working, always show orange
  if (thisSessionMode === "working") {
    return "working";
  }

  // This session just finished - check if others are still working
  const workingCount = sessions.filter((s) => s.mode === "working").length;

  if (workingCount > 0) {
    return "split";
  }

  // No sessions working - check for questions
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

async function setLeds(mode) {
  return ledManager.setMode(mode, log);
}

// Main execution
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

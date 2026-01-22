#!/usr/bin/env node
/**
 * Color Testing Utility
 * Test LED colors without session state management
 * Uses the adapter system and config file
 */
import { LedManager } from "./adapters/index.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Initialize LED manager
let ledManager;
try {
  ledManager = new LedManager();
} catch (e) {
  console.error(`Failed to initialize LED manager: ${e.message}`);
  process.exit(1);
}

// Bright/dim pairs for easy testing
const PAIRS = {
  green: ["ready", "dim-green"],
  yellow: ["split", "dim-split"],
  pink: ["question", "dim-question"],
};

async function setBoth(mode) {
  console.log(`\nSetting all devices to: ${mode}`);
  await ledManager.setMode(mode, (msg) => console.log(`  ${msg}`));
}

const arg = process.argv[2];
const modes = ledManager.getModes();

if (!arg) {
  console.log("Usage: node test-colors.mjs <mode|pair>");
  console.log("\nModes:", modes.join(", "));
  console.log("\nPairs (shows bright then dim after 2s):");
  console.log("  green  - ready → dim-green");
  console.log("  yellow - split → dim-split");
  console.log("  pink   - question → dim-question");
  process.exit(1);
}

// Check if it's a pair
if (PAIRS[arg]) {
  const [bright, dim] = PAIRS[arg];
  await setBoth(bright);
  console.log("\n(waiting 2s for dim...)");
  await sleep(2000);
  await setBoth(dim);
} else if (modes.includes(arg)) {
  await setBoth(arg);
} else {
  console.log(`Unknown mode: ${arg}`);
  console.log("Modes:", modes.join(", "));
  console.log("Pairs:", Object.keys(PAIRS).join(", "));
  process.exit(1);
}

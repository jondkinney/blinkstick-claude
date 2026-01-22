#!/usr/bin/env node
// Simple color test script - bypasses session state management
import { BlinkStick } from "blinkstick-node/source/BlinkStick.js";
import { readdirSync, openSync, writeFileSync, closeSync } from "fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fit-statUSB color mapping (tuned for LED color accuracy)
const FIT_STAT_COLORS = {
  // Bright modes
  working: "#AA0800",
  ready: "#00FF00",
  split: "#FF4600",
  question: "#FF0080",
  // Dim modes
  "dim-green": "#001900",
  "dim-split": "#641800",
  "dim-question": "#18000C",
};

// BlinkStick LED data (GRB order, 8 LEDs)
const BLINKSTICK_MODES = {
  // Bright modes (all 8 LEDs)
  working: [20, 100, 0, ...Array(21).fill(0)],
  ready: Array(8).fill([255, 0, 0]).flat(),
  split: Array(8).fill([255, 255, 0]).flat(),
  question: Array(8).fill([0, 255, 255]).flat(),
  // Dim modes (single LED)
  "dim-green": [100, 0, 0, ...Array(21).fill(0)],
  "dim-split": [100, 100, 0, ...Array(21).fill(0)],
  "dim-question": [0, 100, 100, ...Array(21).fill(0)],
};

// Bright/dim pairs for easy testing
const PAIRS = {
  green: ["ready", "dim-green"],
  yellow: ["split", "dim-split"],
  pink: ["question", "dim-question"],
};

async function setFitStatUSB(mode) {
  try {
    const devFiles = readdirSync("/dev");
    const port = devFiles.find((f) => f.startsWith("cu.usbmodem"));
    if (!port) {
      console.log("fit-statUSB: not found");
      return;
    }
    const fullPath = `/dev/${port}`;
    const color = FIT_STAT_COLORS[mode];
    const fd = openSync(fullPath, "w");
    writeFileSync(fd, `${color}\n`);
    closeSync(fd);
    console.log(`fit-statUSB: ${mode} → ${color}`);
  } catch (e) {
    console.log(`fit-statUSB error: ${e.message}`);
  }
}

async function setBlinkStick(mode) {
  const devices = BlinkStick.findAll();
  if (devices.length === 0) {
    console.log("BlinkStick: not found");
    return;
  }
  const device = devices[0];
  try {
    await device.connect();
    await sleep(200);
    const ledData = BLINKSTICK_MODES[mode];
    device.hid.sendFeatureReport([6, 0, ...ledData]);
    await sleep(10);
    await device.disconnect();
    console.log(`BlinkStick: ${mode}`);
  } catch (e) {
    console.log(`BlinkStick error: ${e.message}`);
  }
}

async function setBoth(mode) {
  console.log(`\nSetting both devices to: ${mode}`);
  await Promise.all([setBlinkStick(mode), setFitStatUSB(mode)]);
}

const arg = process.argv[2];

if (!arg) {
  console.log("Usage: node test-colors.mjs <mode|pair>");
  console.log("\nModes:", Object.keys(FIT_STAT_COLORS).join(", "));
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
} else if (FIT_STAT_COLORS[arg]) {
  await setBoth(arg);
} else {
  console.log(`Unknown mode: ${arg}`);
  console.log("Modes:", Object.keys(FIT_STAT_COLORS).join(", "));
  console.log("Pairs:", Object.keys(PAIRS).join(", "));
  process.exit(1);
}

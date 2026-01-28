/**
 * LED Adapter Manager
 * Loads config and manages multiple device adapters
 */
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { BlinkStickAdapter } from "./blinkstick.mjs";
import { SerialAdapter } from "./serial.mjs";
import { Blink1Adapter } from "./blink1.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, "..", "led-config.json");

// Adapter registry
const ADAPTERS = {
  blinkstick: BlinkStickAdapter,
  serial: SerialAdapter,
  blink1: Blink1Adapter,
};

export class LedManager {
  constructor(configPath = DEFAULT_CONFIG_PATH) {
    this.config = this.loadConfig(configPath);
    this.adapters = new Map();
    this.initAdapters();
  }

  loadConfig(configPath) {
    if (!existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    return JSON.parse(readFileSync(configPath, "utf8"));
  }

  initAdapters() {
    for (const [name, deviceConfig] of Object.entries(this.config.devices)) {
      if (!deviceConfig.enabled) continue;

      const AdapterClass = ADAPTERS[deviceConfig.adapter];
      if (!AdapterClass) {
        console.warn(`Unknown adapter type: ${deviceConfig.adapter}`);
        continue;
      }

      const adapter = new AdapterClass({
        ...deviceConfig.options,
        name,
      });
      this.adapters.set(name, adapter);
    }
  }

  /**
   * Detect which devices are present
   * @returns {Promise<string[]>} Names of detected devices
   */
  async detectDevices() {
    const detected = [];
    for (const [name, adapter] of this.adapters) {
      if (await adapter.detect()) {
        detected.push(name);
      }
    }
    return detected;
  }

  /**
   * Set all devices to the specified mode
   * @param {string} mode - Mode name from config (e.g., "ready", "working")
   * @param {function} log - Optional logging function
   * @returns {Promise<boolean>} True if at least one device was set
   */
  async setMode(mode, log = () => {}) {
    const modeConfig = this.config.modes[mode];
    if (!modeConfig) {
      log(`Unknown mode: ${mode}`);
      return false;
    }

    const results = await Promise.all(
      Array.from(this.adapters.entries()).map(async ([name, adapter]) => {
        const deviceMode = modeConfig[name];
        if (!deviceMode) {
          return false;
        }

        const detected = await adapter.detect();
        if (!detected) {
          return false;
        }

        const success = await adapter.setColor(deviceMode.color, {
          ledCount: deviceMode.ledCount,
          ...this.config.devices[name]?.options,
        });

        if (success) {
          log(`${name}: set ${mode} (${deviceMode.color})`);
        }
        return success;
      })
    );

    const anySuccess = results.some((r) => r);
    if (!anySuccess) {
      log("No LED devices found");
    }
    return anySuccess;
  }

  /**
   * Get list of available modes
   * @returns {string[]}
   */
  getModes() {
    return Object.keys(this.config.modes);
  }

  /**
   * Disconnect all adapters
   */
  async disconnect() {
    for (const adapter of this.adapters.values()) {
      await adapter.disconnect();
    }
  }
}

export default LedManager;

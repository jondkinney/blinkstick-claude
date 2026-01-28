/**
 * Blink(1) LED Adapter
 * Controls blink(1) devices via blink1-tool CLI
 * https://blink1.thingm.com/
 */
import { execSync } from "child_process";
import { LedAdapter } from "./base.mjs";

export class Blink1Adapter extends LedAdapter {
  name = "blink1";

  constructor(options = {}) {
    super();
    if (options.name) {
      this.name = options.name;
    }
  }

  /**
   * Detect if blink(1) device is present
   * @returns {Promise<boolean>}
   */
  async detect() {
    try {
      const result = execSync("blink1-tool --list 2>&1", {
        encoding: "utf8",
        timeout: 5000,
      });
      return result.includes("serialnum:");
    } catch (e) {
      return false;
    }
  }

  /**
   * Set LED color
   * @param {string} hexColor - RGB hex color (e.g., "#FF0000")
   */
  async setColor(hexColor) {
    // Ensure hex color has # prefix
    const color = hexColor.startsWith("#") ? hexColor : `#${hexColor}`;

    try {
      execSync(`blink1-tool --rgb '${color}' -m 0 2>&1`, {
        encoding: "utf8",
        timeout: 5000,
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async off() {
    try {
      execSync("blink1-tool --off -m 0 2>&1", {
        encoding: "utf8",
        timeout: 5000,
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async disconnect() {
    // No persistent connection for CLI-based adapter
  }
}

export default Blink1Adapter;

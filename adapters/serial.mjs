/**
 * Serial LED Adapter
 * Controls LED devices via serial port (e.g., fit-statUSB)
 * Protocol: sends #RRGGBB\n to set color
 */
import { readdirSync, openSync, writeFileSync, closeSync } from "fs";
import { LedAdapter } from "./base.mjs";

export class SerialAdapter extends LedAdapter {
  name = "serial";
  cachedPort = null;
  portPattern = "cu.usbmodem";

  constructor(options = {}) {
    super();
    if (options.portPattern) {
      this.portPattern = options.portPattern;
    }
    if (options.name) {
      this.name = options.name;
    }
  }

  /**
   * Detect serial port matching the pattern
   * @returns {Promise<boolean>}
   */
  async detect() {
    const port = this.findPort();
    return port !== null;
  }

  /**
   * Find the serial port matching the configured pattern
   * @returns {string|null}
   */
  findPort() {
    if (this.cachedPort !== null) {
      return this.cachedPort || null;
    }

    try {
      const devFiles = readdirSync("/dev");
      const pattern = this.portPattern.replace("*", "");
      const modemPorts = devFiles
        .filter((f) => f.startsWith(pattern))
        .map((f) => `/dev/${f}`);

      for (const port of modemPorts) {
        try {
          const fd = openSync(port, "r+");
          closeSync(fd);
          this.cachedPort = port;
          return port;
        } catch (e) {
          // Port not accessible, try next
        }
      }
    } catch (e) {
      // /dev directory read failed
    }

    this.cachedPort = "";
    return null;
  }

  /**
   * Set LED color via serial command
   * @param {string} hexColor - RGB hex color (e.g., "#FF0000")
   */
  async setColor(hexColor) {
    const port = this.findPort();
    if (!port) {
      return false;
    }

    // Ensure hex color has # prefix
    const color = hexColor.startsWith("#") ? hexColor : `#${hexColor}`;

    try {
      const fd = openSync(port, "w");
      writeFileSync(fd, `${color}\n`);
      closeSync(fd);
      return true;
    } catch (e) {
      // Invalidate cache so we can retry detection
      this.cachedPort = null;
      return false;
    }
  }

  async disconnect() {
    // No persistent connection for serial
    this.cachedPort = null;
  }
}

export default SerialAdapter;

/**
 * Base LED Adapter Interface
 * All device adapters must extend this class
 */
export class LedAdapter {
  name = "base";

  /**
   * Detect if the device is present and accessible
   * @returns {Promise<boolean>}
   */
  async detect() {
    return false;
  }

  /**
   * Set all LEDs to a single color
   * @param {string} hexColor - RGB hex color (e.g., "#FF0000")
   * @param {object} options - Device-specific options (e.g., ledCount)
   * @returns {Promise<boolean>}
   */
  async setColor(hexColor, options = {}) {
    throw new Error("setColor not implemented");
  }

  /**
   * Turn off all LEDs
   * @returns {Promise<boolean>}
   */
  async off() {
    return this.setColor("#000000");
  }

  /**
   * Disconnect/cleanup
   * @returns {Promise<void>}
   */
  async disconnect() {}
}

/**
 * Parse hex color to RGB components
 * @param {string} hex - Color in #RRGGBB format
 * @returns {{r: number, g: number, b: number}}
 */
export function parseHexColor(hex) {
  const match = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

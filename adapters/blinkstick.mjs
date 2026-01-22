/**
 * BlinkStick LED Adapter
 * Controls BlinkStick devices via HID protocol
 * Uses WS2812 LEDs in GRB order
 */
import { BlinkStick } from "blinkstick-node/source/BlinkStick.js";
import { LedAdapter, parseHexColor } from "./base.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BlinkStickAdapter extends LedAdapter {
  name = "blinkstick";
  device = null;

  async detect() {
    const devices = BlinkStick.findAll();
    return devices.length > 0;
  }

  /**
   * Set LEDs to a color
   * @param {string} hexColor - RGB hex color
   * @param {object} options
   * @param {number} options.ledCount - Number of LEDs to light (default: 8)
   * @param {number} options.totalLeds - Total LEDs on device (default: 8)
   */
  async setColor(hexColor, options = {}) {
    const { ledCount = 8, totalLeds = 8, retries = 5 } = options;
    const { r, g, b } = parseHexColor(hexColor);

    for (let attempt = 1; attempt <= retries; attempt++) {
      const devices = BlinkStick.findAll();
      if (devices.length === 0) {
        return false;
      }

      const device = devices[0];
      try {
        await device.connect();
        await sleep(200);

        // Build LED data array - GRB order for WS2812
        const ledData = [];
        for (let i = 0; i < totalLeds; i++) {
          if (i < ledCount) {
            // GRB order
            ledData.push(g, r, b);
          } else {
            ledData.push(0, 0, 0);
          }
        }

        // Send all LEDs in one batch command (report ID 6)
        device.hid.sendFeatureReport([6, 0, ...ledData]);

        await sleep(10);
        await device.disconnect();
        return true;
      } catch (e) {
        try {
          await device.disconnect();
        } catch (e2) {}
        if (attempt < retries) {
          await sleep(300 * attempt);
        }
      }
    }
    return false;
  }

  async disconnect() {
    if (this.device) {
      try {
        await this.device.disconnect();
      } catch (e) {}
      this.device = null;
    }
  }
}

export default BlinkStickAdapter;

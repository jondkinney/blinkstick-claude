# Claude Code BlinkStick

Visual status indicator for Claude Code using a BlinkStick LED device. Shows at a glance whether Claude is working or waiting for your input.

## LED States

| State        | LED Display                                  | Meaning                                      |
| ------------ | -------------------------------------------- | -------------------------------------------- |
| **Working**  | Dim orange (1 LED)                           | Claude is processing your request            |
| **Ready**    | Bright green (8 LEDs) → dims to 1 after 5s   | Claude finished, waiting for input           |
| **Question** | Bright magenta (8 LEDs) → dims to 1 after 5s | Claude asked a question or needs permission  |
| **Mixed**    | Bright yellow (8 LEDs) → dims to 1 after 5s  | Multiple sessions: some ready, some working  |

## Requirements

- [BlinkStick](https://www.blinkstick.com/) device (tested with BlinkStick Square)
- Node.js 18+
- [jq](https://jqlang.github.io/jq/) (for parsing JSON in hook scripts)
- Claude Code CLI

## Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/jondkinney/blinkstick-claude.git
   cd blinkstick-claude
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Test the LED (plug in your BlinkStick first):

   ```bash
   node led-control.mjs ready test
   # Should flash bright green, then dim after 5 seconds

   node led-control.mjs working test
   # Should show dim orange
   ```

## Claude Code Hook Configuration

Add the following to your Claude Code settings file (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/blinkstick-claude/hooks/on-prompt-submit.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/blinkstick-claude/hooks/on-stop.sh"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/blinkstick-claude/hooks/on-permission.sh"
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/blinkstick-claude` with the actual path where you cloned this repo.

### Hook Purposes

| Hook                  | Script              | Purpose                                           |
| --------------------- | ------------------- | ------------------------------------------------- |
| `UserPromptSubmit`    | on-prompt-submit.sh | Sets LED to working (orange) when you send input  |
| `Stop`                | on-stop.sh          | Sets LED to ready (green) or question (magenta)   |
| `PermissionRequest`   | on-permission.sh    | Sets LED to question (magenta) for tool approval  |

The `Stop` hook uses `detect-question.mjs` to analyze Claude's response and determine if it's asking a question. If so, the LED turns magenta instead of green.

## Configuration

LED behavior is configured in `led-config.json`. This file defines devices and color modes.

### Device Configuration

```json
{
  "devices": {
    "blinkstick": {
      "adapter": "blinkstick",
      "enabled": true,
      "options": {
        "totalLeds": 8
      }
    },
    "fit-statUSB": {
      "adapter": "serial",
      "enabled": true,
      "options": {
        "portPattern": "cu.usbmodem"
      }
    }
  }
}
```

**Available adapters:**

| Adapter     | Description                          | Options                        |
| ----------- | ------------------------------------ | ------------------------------ |
| `blinkstick`| BlinkStick USB LED devices           | `totalLeds`: Number of LEDs    |
| `serial`    | Serial devices (fit-statUSB, etc.)   | `portPattern`: Port name match |

Set `"enabled": false` to disable a device.

### Mode Configuration

Each mode defines colors per device:

```json
{
  "modes": {
    "working": {
      "blinkstick": { "color": "#642800", "ledCount": 1 },
      "fit-statUSB": { "color": "#AA0800" }
    },
    "ready": {
      "blinkstick": { "color": "#00FF00", "ledCount": 8 },
      "fit-statUSB": { "color": "#00FF00" }
    },
    "question": {
      "blinkstick": { "color": "#FF00FF", "ledCount": 8 },
      "fit-statUSB": { "color": "#FF0080" }
    }
  }
}
```

- `color`: Hex color code (RGB format, converted to GRB for BlinkStick)
- `ledCount`: Number of LEDs to light (BlinkStick only)

### All Modes

| Mode           | Purpose                              |
| -------------- | ------------------------------------ |
| `working`      | Claude is processing                 |
| `ready`        | Claude finished, no question         |
| `dim-green`    | Ready state after 5s timeout         |
| `split`        | Mixed state (some sessions working)  |
| `dim-split`    | Mixed state after 5s timeout         |
| `question`     | Claude asked a question or needs permission |
| `dim-question` | Question state after 5s timeout      |

## How It Works

### Multi-Session Support

The controller tracks multiple Claude Code sessions simultaneously. Each session is identified by a unique `session_id` passed from Claude Code hooks.

**State Logic:**

- If ANY session is ready (waiting for input) → shows green/yellow
- If ALL sessions are working → shows orange
- Mixed state (some ready, some working) → shows yellow

This means if you have 3 Claude instances running:

- All 3 working → dim orange
- 1 finishes → bright yellow flash (attention!) → dims to yellow
- All 3 finish → bright green flash → dims to green

### Session Cleanup

Sessions are automatically cleaned up after 30 seconds of inactivity. This handles crashed or closed Claude Code instances gracefully.

### File Locations

Runtime files are stored in `/tmp/`:

- `/tmp/blinkstick-state.json` - Current session states
- `/tmp/blinkstick.lock` - Device access lock
- `/tmp/blinkstick.log` - Debug log

## Technical Details

### Adapter System

The LED controller uses an adapter pattern to support multiple device types. Adapters are in `adapters/`:

- `blinkstick.mjs` - BlinkStick USB devices
- `serial.mjs` - Serial port devices (fit-statUSB)
- `index.mjs` - LedManager that coordinates all enabled adapters

### LED Protocol (BlinkStick)

Uses BlinkStick report ID 6 for atomic batch updates (all 8 LEDs in one command). This prevents visual stepping artifacts when changing colors.

WS2812 LEDs use **GRB** color order, not RGB. The adapter handles this conversion automatically from the hex colors in `led-config.json`.

### Question Detection

The `hooks/detect-question.mjs` script analyzes Claude's last message to determine if it's asking a question. It checks for:

- Plan approval patterns ("would you like me to proceed", "should I continue")
- Choice patterns ("which option", "would you prefer")
- Messages ending with `?`

### API

```bash
# Set working state (dim orange)
node led-control.mjs working <session_id>

# Set ready state (bright green → dim after 5s)
node led-control.mjs ready <session_id>

# Set question state (bright magenta → dim after 5s)
node led-control.mjs question <session_id>
```

The script handles:

- State tracking across sessions
- Automatic dimming via background process
- Device locking for concurrent access
- Retry logic for USB communication errors

## Troubleshooting

### Device not found

Make sure your BlinkStick is plugged in and recognized:

```bash
# List USB devices (macOS)
system_profiler SPUSBDataType | grep -i blinkstick
```

### Permission errors

On Linux, you may need udev rules. Create `/etc/udev/rules.d/85-blinkstick.rules`:

```
SUBSYSTEM=="usb", ATTR{idVendor}=="20a0", ATTR{idProduct}=="41e5", MODE="0666"
```

### Check the log

```bash
tail -f /tmp/blinkstick.log
```

### Clear stale state

```bash
rm /tmp/blinkstick-state.json /tmp/blinkstick.lock
```

## License

MIT

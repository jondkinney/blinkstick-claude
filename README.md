# Claude Code BlinkStick

Visual status indicator for Claude Code using a BlinkStick LED device. Shows at a glance whether Claude is working or waiting for your input.

## LED States

| State       | LED Display                                 | Meaning                                     |
| ----------- | ------------------------------------------- | ------------------------------------------- |
| **Working** | Dim orange (1 LED)                          | Claude is processing your request           |
| **Ready**   | Bright green (8 LEDs) → dims to 1 after 5s  | Claude finished, waiting for input          |
| **Mixed**   | Bright yellow (8 LEDs) → dims to 1 after 5s | Multiple sessions: some ready, some working |

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
    ]
  }
}
```

Replace `/path/to/blinkstick-claude` with the actual path where you cloned this repo.

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

### LED Protocol

Uses BlinkStick report ID 6 for atomic batch updates (all 8 LEDs in one command). This prevents visual stepping artifacts when changing colors.

WS2812 LEDs use **GRB** color order, not RGB.

### Color Values (GRB)

| Color         | G   | R   | B   |
| ------------- | --- | --- | --- |
| Bright Green  | 255 | 0   | 0   |
| Dim Green     | 100 | 0   | 0   |
| Bright Orange | 50  | 255 | 0   |
| Dim Orange    | 20  | 100 | 0   |
| Bright Yellow | 255 | 255 | 0   |
| Dim Yellow    | 100 | 100 | 0   |

### API

```bash
# Set working state (dim orange)
node led-control.mjs working <session_id>

# Set ready state (bright green → dim after 5s)
node led-control.mjs ready <session_id>
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

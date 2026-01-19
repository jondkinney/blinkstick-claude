#!/bin/bash
# Hook: Stop - Called when Claude finishes responding
# Sets LED to "ready" mode (bright green, dims after 5 seconds)

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Read JSON from stdin and extract session_id
hook_input=$(cat)
session_id=$(echo "$hook_input" | jq -r '.session_id // empty')

node "$SCRIPT_DIR/led-control.mjs" ready "$session_id"

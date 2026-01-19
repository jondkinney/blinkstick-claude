#!/bin/bash
# Hook: UserPromptSubmit - Called when user sends a message
# Sets LED to "working" mode (dim orange)

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Read JSON from stdin and extract session_id
hook_input=$(cat)
session_id=$(echo "$hook_input" | jq -r '.session_id // empty')

node "$SCRIPT_DIR/led-control.mjs" working "$session_id"

#!/bin/bash
# Hook: PermissionRequest - Called when Claude needs tool permission
# Sets LED to "question" mode (magenta) since user input is needed

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Read JSON from stdin
hook_input=$(cat)
session_id=$(echo "$hook_input" | jq -r '.session_id // empty')

# Set LED to question mode (magenta) - same as when Claude asks a question
node "$SCRIPT_DIR/led-control.mjs" question "$session_id"

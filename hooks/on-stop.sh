#!/bin/bash
# Hook: Stop - Called when Claude finishes responding
# Sets LED to:
# - "question" mode (magenta) if Claude is asking the user a question
# - "ready" mode (green) otherwise

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Read JSON from stdin
hook_input=$(cat)
session_id=$(echo "$hook_input" | jq -r '.session_id // empty')

# Run question detection
detection_result=$(echo "$hook_input" | node "$SCRIPT_DIR/hooks/detect-question.mjs")
is_question=$(echo "$detection_result" | jq -r '.is_question // false')

if [ "$is_question" = "true" ]; then
  node "$SCRIPT_DIR/led-control.mjs" question "$session_id"
else
  node "$SCRIPT_DIR/led-control.mjs" ready "$session_id"
fi

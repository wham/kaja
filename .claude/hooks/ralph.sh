#!/bin/bash
# Ralph hook: runs protoc-gen-kaja tests and injects results into the conversation.
# Named after the agentic loop pattern - keeps the agent coding until all tests pass.

PROJECT_DIR="$CLAUDE_PROJECT_DIR/protoc-gen-kaja"
TEST_SCRIPT="$PROJECT_DIR/scripts/test"

if [ ! -x "$TEST_SCRIPT" ]; then
  exit 0
fi

# Only activate if protoc-gen-kaja build dir exists (tests have been run before)
if [ ! -d "$PROJECT_DIR/build" ]; then
  exit 0
fi

OUTPUT=$("$TEST_SCRIPT" --summary 2>&1) || true
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "protoc-gen-kaja tests are failing. Here are the results:"
  echo ""
  echo "$OUTPUT"
  echo ""
  echo "Keep working until all tests pass."
fi

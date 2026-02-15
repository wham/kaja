#!/bin/bash
# Ralph hook for Copilot CLI: runs protoc-gen-kaja tests and injects results.
# Named after the agentic loop pattern - keeps the agent coding until all tests pass.

PROJECT_DIR="$PWD/protoc-gen-kaja"
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
  echo "❌ TESTS FAILING - YOU MUST CONTINUE IMMEDIATELY"
  echo ""
  echo "$OUTPUT"
  echo ""
  echo "🔴 ACTION REQUIRED: Fix the next failing test NOW."
  echo "Do NOT wait for user confirmation. Do NOT explain what you'll do."
  echo "IMMEDIATELY analyze the first failing test and fix it."
  echo "The user expects you to keep working autonomously until all tests pass."
fi

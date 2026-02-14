#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ "$COMMAND" == git\ push* ]] || [[ "$COMMAND" == *"&& git push"* ]] || [[ "$COMMAND" == *"; git push"* ]]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ -n "$BRANCH" ] && gh pr view "$BRANCH" --json number >/dev/null 2>&1; then
    echo "You just pushed. Update the PR description for branch $BRANCH to match the current state of changes. Keep it very short (one or two sentences). Use gh api to update to avoid the Projects Classic deprecation error."
  fi
fi

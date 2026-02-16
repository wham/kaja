#!/usr/bin/env bash

# https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started#using-github-copilot-cli-non-interactively

set -euo pipefail

PROMPT_FILE="PROMPT.md"
MAX_LOOPS=1000

if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "Error: $PROMPT_FILE not found"
    exit 1
fi

for ((i=1; i<=MAX_LOOPS; i++)); do
    echo "=== Loop $i/$MAX_LOOPS ==="
    
    # Check if last non-empty line of PROMPT.md is "DONE"
    last_line=$(grep -v '^[[:space:]]*$' "$PROMPT_FILE" | tail -n 1 | tr -d '\r\n')
    if [[ "$last_line" == "DONE" ]]; then
        echo "Last line is 'DONE'. Stopping loop."
        exit 0
    fi
    
    # Read prompt from PROMPT.md
    prompt=$(cat "$PROMPT_FILE")
    
    # Run GitHub Copilot CLI in non-interactive mode
    # Using gh copilot suggest with --target shell for command suggestions
    echo "Running GitHub Copilot CLI with prompt from $PROMPT_FILE"
    gh copilot suggest --target shell --yolo "$prompt" || {
        echo "Error: GitHub Copilot CLI command failed"
        exit 1
    }
    
    echo ""
done

echo "Reached maximum loops ($MAX_LOOPS). Exiting."
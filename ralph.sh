#!/usr/bin/env bash

# https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started#using-github-copilot-cli-non-interactively

set -euo pipefail

# Set default model to Claude Opus 4.6
export COPILOT_MODEL=claude-opus-4.6

PROMPT_FILE="RALPH.md"
NELSON_FILE="NELSON.md"
STATUS_FILE="status.txt"
MAX_LOOPS=1000

if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "Error: $PROMPT_FILE not found"
    exit 1
fi

if [[ ! -f "$NELSON_FILE" ]]; then
    echo "Error: $NELSON_FILE not found"
    exit 1
fi

for ((i=1; i<=MAX_LOOPS; i++)); do
    echo "=== Loop $i/$MAX_LOOPS ==="
    
    # Check if status.txt contains "DONE"
    if [[ -f "$STATUS_FILE" ]]; then
        status=$(cat "$STATUS_FILE" | tr -d '\r\n' | tr -d '[:space:]')
        if [[ "$status" == "DONE" ]]; then
            echo "Status is 'DONE'. Running NELSON.md task..."
            
            # Run NELSON.md task
            nelson_prompt=$(cat "$NELSON_FILE")
            copilot --yolo -p "$nelson_prompt" || {
                echo "Error: GitHub Copilot CLI command failed for NELSON.md"
                exit 1
            }
            
            # Check status again after NELSON task
            if [[ -f "$STATUS_FILE" ]]; then
                status=$(cat "$STATUS_FILE" | tr -d '\r\n' | tr -d '[:space:]')
                if [[ "$status" == "DONE" ]]; then
                    echo "Status is still 'DONE' after NELSON task. Exiting."
                    exit 0
                else
                    echo "Status changed after NELSON task. Continuing with RALPH.md..."
                fi
            else
                echo "Status file removed after NELSON task. Continuing with RALPH.md..."
            fi
        fi
    fi
    
    # Read prompt from RALPH.md
    prompt=$(cat "$PROMPT_FILE")
    
    # Run GitHub Copilot CLI in non-interactive mode with all permissions enabled
    echo "Running GitHub Copilot CLI with prompt from $PROMPT_FILE"
    copilot --yolo -p "$prompt" || {
        echo "Error: GitHub Copilot CLI command failed"
        exit 1
    }
    
    echo ""
done

echo "Reached maximum loops ($MAX_LOOPS). Exiting."
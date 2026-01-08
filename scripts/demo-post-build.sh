#!/bin/bash
# Demo post-build hook script
# This script is called after wails build completes

OUTPUT_FILE="$(dirname "$0")/../desktop/HELLO.txt"

{
  echo "Demo post-build hook executed"
  echo "Binary path: $1"
  echo "Working directory: $(pwd)"
  echo "Timestamp: $(date)"
} > "$OUTPUT_FILE"

echo "Created HELLO.txt in desktop directory"

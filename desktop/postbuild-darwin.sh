#!/bin/bash
set -e

# Script runs from desktop/ directory after wails build
# $1 is the path to the compiled binary (e.g., ./build/bin/desktop.app/Contents/MacOS/desktop)

BIN="$1"
BINDIR=$(dirname "$BIN")
RESOURCES_BIN="$BINDIR/../Resources/bin"

echo "Bundling protoc into macOS app..."
mkdir -p "$RESOURCES_BIN"
cp ../server/build/protoc "$RESOURCES_BIN/"
cp ../server/build/protoc-gen-ts "$RESOURCES_BIN/"
chmod +x "$RESOURCES_BIN/protoc" "$RESOURCES_BIN/protoc-gen-ts"
echo "Successfully bundled protoc into $RESOURCES_BIN"

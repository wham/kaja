#!/bin/bash
set -e

# Download Node.js binaries for macOS only
DESKTOP_DIR="desktop"
BINARIES_DIR="$DESKTOP_DIR/binaries"

# Node.js version
NODE_VERSION="20.11.0"

echo "Downloading Node.js binaries version $NODE_VERSION for macOS..."

# macOS platforms only
PLATFORMS=(
    "darwin-amd64"
    "darwin-arm64"
)

for platform in "${PLATFORMS[@]}"; do
    echo "Downloading Node.js for $platform..."
    
    platform_dir="$BINARIES_DIR/$platform"
    mkdir -p "$platform_dir"
    
    # Map platform to Node.js filename
    case "$platform" in
        "darwin-amd64") 
            node_file="node-v$NODE_VERSION-darwin-x64.tar.gz"
            ;;
        "darwin-arm64") 
            node_file="node-v$NODE_VERSION-darwin-arm64.tar.gz"
            ;;
    esac
    
    node_url="https://nodejs.org/dist/v$NODE_VERSION/$node_file"
    temp_file="/tmp/$node_file"
    
    if curl -fL "$node_url" -o "$temp_file"; then
        # Extract node binary
        tar -xzf "$temp_file" --strip-components=2 -C "$platform_dir" "*/bin/node"
        chmod +x "$platform_dir/node"
        
        rm "$temp_file"
        echo "✓ Downloaded Node.js for $platform"
    else
        echo "✗ Failed to download Node.js for $platform"
        exit 1
    fi
done

echo "Node.js binaries for macOS downloaded successfully!"
#!/bin/bash
set -e

# Download Node.js binaries for all platforms
DESKTOP_DIR="desktop"
BINARIES_DIR="$DESKTOP_DIR/binaries"

# Node.js version
NODE_VERSION="20.11.0"

echo "Downloading Node.js binaries version $NODE_VERSION..."

# Platform configurations: "os-arch"
PLATFORMS=(
    "darwin-amd64"
    "darwin-arm64"
    "linux-amd64"
    "linux-arm64"
    "windows-amd64"
    "windows-arm64"
)

for platform in "${PLATFORMS[@]}"; do
    echo "Downloading Node.js for $platform..."
    
    platform_dir="$BINARIES_DIR/$platform"
    mkdir -p "$platform_dir"
    
    # Map platform to Node.js filename and URL
    case "$platform" in
        "darwin-amd64") 
            node_file="node-v$NODE_VERSION-darwin-x64.tar.gz"
            node_url="https://nodejs.org/dist/v$NODE_VERSION/$node_file"
            ;;
        "darwin-arm64") 
            node_file="node-v$NODE_VERSION-darwin-arm64.tar.gz"
            node_url="https://nodejs.org/dist/v$NODE_VERSION/$node_file"
            ;;
        "linux-amd64") 
            node_file="node-v$NODE_VERSION-linux-x64.tar.xz"
            node_url="https://nodejs.org/dist/v$NODE_VERSION/$node_file"
            ;;
        "linux-arm64") 
            node_file="node-v$NODE_VERSION-linux-arm64.tar.xz"
            node_url="https://nodejs.org/dist/v$NODE_VERSION/$node_file"
            ;;
        "windows-amd64") 
            node_file="node-v$NODE_VERSION-win-x64.zip"
            node_url="https://nodejs.org/dist/v$NODE_VERSION/$node_file"
            ;;
        "windows-arm64") 
            node_file="node-v$NODE_VERSION-win-arm64.zip"
            node_url="https://nodejs.org/dist/v$NODE_VERSION/$node_file"
            ;;
    esac
    
    temp_file="/tmp/$node_file"
    
    if curl -fL "$node_url" -o "$temp_file"; then
        # Extract Node.js binary
        if [[ "$platform" == windows-* ]]; then
            # For Windows, extract node.exe
            unzip -j "$temp_file" "*/node.exe" -d "$platform_dir"
        elif [[ "$node_file" == *.tar.gz ]]; then
            # For macOS, extract from tar.gz
            tar -xzf "$temp_file" --strip-components=2 -C "$platform_dir" "*/bin/node"
            chmod +x "$platform_dir/node"
        else
            # For Linux, extract from tar.xz
            tar -xJf "$temp_file" --strip-components=2 -C "$platform_dir" "*/bin/node"
            chmod +x "$platform_dir/node"
        fi
        
        rm "$temp_file"
        echo "✓ Downloaded Node.js for $platform"
    else
        echo "✗ Failed to download Node.js for $platform"
        exit 1
    fi
done

echo "All Node.js binaries downloaded successfully!"
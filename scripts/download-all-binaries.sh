#!/bin/bash
set -e

# Download all binaries needed for desktop app: protoc, Node.js, and protoc-gen-ts
DESKTOP_DIR="desktop"
BINARIES_DIR="$DESKTOP_DIR/binaries"

# Versions
PROTOC_VERSION="28.3"
NODE_VERSION="20.11.0"

echo "Creating binaries directory structure..."
mkdir -p "$BINARIES_DIR"

# Platform configurations: "os-arch"
PLATFORMS=(
    "darwin-amd64"
    "darwin-arm64"
    "linux-amd64"
    "linux-arm64"
    "windows-amd64"
    "windows-arm64"
)

# Download protoc binaries with includes
echo "=== Downloading protoc binaries version $PROTOC_VERSION ==="
for platform in "${PLATFORMS[@]}"; do
    echo "Downloading protoc for $platform..."
    
    # Create platform directory
    platform_dir="$BINARIES_DIR/$platform"
    mkdir -p "$platform_dir"
    
    # Map platform to protoc filename
    case "$platform" in
        "darwin-amd64") protoc_file="protoc-$PROTOC_VERSION-osx-x86_64.zip" ;;
        "darwin-arm64") protoc_file="protoc-$PROTOC_VERSION-osx-aarch_64.zip" ;;
        "linux-amd64") protoc_file="protoc-$PROTOC_VERSION-linux-x86_64.zip" ;;
        "linux-arm64") protoc_file="protoc-$PROTOC_VERSION-linux-aarch_64.zip" ;;
        "windows-amd64") protoc_file="protoc-$PROTOC_VERSION-win64.zip" ;;
        "windows-arm64") protoc_file="protoc-$PROTOC_VERSION-win64.zip" ;;
    esac
    
    # Download protoc
    url="https://github.com/protocolbuffers/protobuf/releases/download/v$PROTOC_VERSION/$protoc_file"
    temp_zip="/tmp/$protoc_file"
    
    if curl -fL "$url" -o "$temp_zip"; then
        # Extract protoc binary and includes
        if [[ "$platform" == windows-* ]]; then
            unzip -j "$temp_zip" "bin/protoc.exe" -d "$platform_dir"
        else
            unzip -j "$temp_zip" "bin/protoc" -d "$platform_dir"
            chmod +x "$platform_dir/protoc"
        fi
        
        # Extract include files
        unzip -q "$temp_zip" "include/*" -d "$platform_dir"
        
        rm "$temp_zip"
        echo "✓ Downloaded protoc for $platform"
    else
        echo "✗ Failed to download protoc for $platform"
        exit 1
    fi
done

# Download Node.js binaries
echo -e "\n=== Downloading Node.js binaries version $NODE_VERSION ==="
for platform in "${PLATFORMS[@]}"; do
    echo "Downloading Node.js for $platform..."
    
    platform_dir="$BINARIES_DIR/$platform"
    
    # Map platform to Node.js filename
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

# Download and prepare protoc-gen-ts
echo -e "\n=== Preparing protoc-gen-ts ==="

# Convert BINARIES_DIR to absolute path before changing directory
BINARIES_DIR=$(cd "$BINARIES_DIR" && pwd)

# Create a temporary directory for protoc-gen-ts setup
temp_dir=$(mktemp -d)
cd "$temp_dir"

# Initialize npm project and install protoc-gen-ts
npm init -y > /dev/null 2>&1
npm install --save-exact @protobuf-ts/plugin@2.9.4 > /dev/null 2>&1

# Create protoc-gen-ts wrapper script for Unix platforms
cat > protoc-gen-ts.sh << 'EOF'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/node" "$DIR/protoc-gen-ts.js" "$@"
EOF

# Create protoc-gen-ts wrapper script for Windows
cat > protoc-gen-ts.bat << 'EOF'
@echo off
"%~dp0\node.exe" "%~dp0\protoc-gen-ts.js" %*
EOF

# Create the actual protoc-gen-ts.js entry point
cat > protoc-gen-ts.js << 'EOF'
#!/usr/bin/env node
const path = require('path');
const protocGenTs = path.join(__dirname, 'node_modules', '.bin', 'protoc-gen-ts');
require(protocGenTs);
EOF

# Copy node_modules to each platform
for platform in "${PLATFORMS[@]}"; do
    platform_dir="$BINARIES_DIR/$platform"
    
    # Copy node_modules
    cp -r node_modules "$platform_dir/"
    
    # Copy the appropriate wrapper script
    if [[ "$platform" == windows-* ]]; then
        cp protoc-gen-ts.bat "$platform_dir/protoc-gen-ts.bat"
        cp protoc-gen-ts.js "$platform_dir/protoc-gen-ts.js"
    else
        cp protoc-gen-ts.sh "$platform_dir/protoc-gen-ts"
        cp protoc-gen-ts.js "$platform_dir/protoc-gen-ts.js"
        chmod +x "$platform_dir/protoc-gen-ts"
    fi
    
    echo "✓ Installed protoc-gen-ts for $platform"
done

# Cleanup
cd - > /dev/null
rm -rf "$temp_dir"

echo -e "\nAll binaries downloaded successfully!"
echo "The desktop application now includes:"
echo "  - protoc with standard protobuf includes"
echo "  - Node.js runtime"
echo "  - protoc-gen-ts plugin"
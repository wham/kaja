#!/bin/bash
set -e

# Download protoc binaries for different platforms
PROTOC_VERSION="28.3"
DESKTOP_DIR="desktop"
BINARIES_DIR="$DESKTOP_DIR/binaries"

echo "Downloading protoc binaries version $PROTOC_VERSION..."

# Create binaries directory structure
mkdir -p "$BINARIES_DIR"

# Platform configurations: "os-arch:filename"
PLATFORMS=(
    "darwin-amd64:protoc-$PROTOC_VERSION-osx-x86_64.zip"
    "darwin-arm64:protoc-$PROTOC_VERSION-osx-aarch_64.zip"
    "linux-amd64:protoc-$PROTOC_VERSION-linux-x86_64.zip"
    "linux-arm64:protoc-$PROTOC_VERSION-linux-aarch_64.zip"
    "windows-amd64:protoc-$PROTOC_VERSION-win64.zip"
    "windows-arm64:protoc-$PROTOC_VERSION-win64.zip"
)

for platform_config in "${PLATFORMS[@]}"; do
    IFS=':' read -r platform filename <<< "$platform_config"
    echo "Downloading for $platform..."
    
    # Create platform directory
    platform_dir="$BINARIES_DIR/$platform"
    mkdir -p "$platform_dir"
    
    # Download protoc zip
    url="https://github.com/protocolbuffers/protobuf/releases/download/v$PROTOC_VERSION/$filename"
    temp_zip="/tmp/$filename"
    
    if curl -fL "$url" -o "$temp_zip"; then
        # Extract protoc binary and includes
        if [[ "$platform" == windows-* ]]; then
            unzip -j "$temp_zip" "bin/protoc.exe" -d "$platform_dir"
        else
            unzip -j "$temp_zip" "bin/protoc" -d "$platform_dir"
            chmod +x "$platform_dir/protoc"
        fi
        
        # Extract include files (protobuf standard library)
        unzip -q "$temp_zip" "include/*" -d "$platform_dir"
        
        # Clean up temp file
        rm "$temp_zip"
        echo "✓ Downloaded $platform"
    else
        echo "✗ Failed to download $platform"
        exit 1
    fi
done

echo "All protoc binaries downloaded successfully!"
echo "You can now build the desktop application with embedded protoc."
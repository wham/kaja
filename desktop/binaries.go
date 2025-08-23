package main

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
)

//go:embed binaries/*
var binariesFS embed.FS

// BinaryManager handles embedded binaries: protoc, Node.js, and include files
type BinaryManager struct {
	protocPath  string
	includePath string
	nodePath    string
}

// NewBinaryManager creates a new binary manager and extracts the appropriate binaries
func NewBinaryManager() (*BinaryManager, error) {
	bm := &BinaryManager{}
	
	// Create temporary directory for all binaries
	tempDir, err := os.MkdirTemp("", "kaja-binaries-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %w", err)
	}
	
	// Extract protoc binary and includes
	protocPath, includePath, err := bm.extractProtoc(tempDir)
	if err != nil {
		os.RemoveAll(tempDir)
		return nil, fmt.Errorf("failed to extract protoc: %w", err)
	}
	
	// Extract Node.js binary
	nodePath, err := bm.extractNode(tempDir)
	if err != nil {
		os.RemoveAll(tempDir)
		return nil, fmt.Errorf("failed to extract node: %w", err)
	}
	
	bm.protocPath = protocPath
	bm.includePath = includePath
	bm.nodePath = nodePath
	return bm, nil
}

// GetProtocPath returns the path to the extracted protoc binary
func (bm *BinaryManager) GetProtocPath() string {
	return bm.protocPath
}

// GetIncludePath returns the path to the extracted protoc include files
func (bm *BinaryManager) GetIncludePath() string {
	return bm.includePath
}

// GetNodePath returns the path to the extracted Node.js binary
func (bm *BinaryManager) GetNodePath() string {
	return bm.nodePath
}

// extractProtoc extracts the protoc binary and includes for the current platform
func (bm *BinaryManager) extractProtoc(tempDir string) (string, string, error) {
	// Determine platform-specific binary path
	platform := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	
	var binaryName string
	if runtime.GOOS == "windows" {
		binaryName = "protoc.exe"
	} else {
		binaryName = "protoc"
	}
	
	embeddedPath := fmt.Sprintf("binaries/%s/%s", platform, binaryName)
	
	// Check if embedded binary exists
	if _, err := fs.Stat(binariesFS, embeddedPath); err != nil {
		return "", "", fmt.Errorf("protoc binary not found for platform %s: %w", platform, err)
	}
	
	
	// Extract binary to temp directory
	binaryData, err := binariesFS.ReadFile(embeddedPath)
	if err != nil {
		return "", "", fmt.Errorf("failed to read embedded binary: %w", err)
	}
	
	extractedPath := filepath.Join(tempDir, binaryName)
	if err := os.WriteFile(extractedPath, binaryData, 0755); err != nil {
		return "", "", fmt.Errorf("failed to write binary to temp location: %w", err)
	}
	
	// Extract include files
	includePath := filepath.Join(tempDir, "include")
	if err := bm.extractIncludes(includePath); err != nil {
		return "", "", fmt.Errorf("failed to extract includes: %w", err)
	}
	
	return extractedPath, includePath, nil
}

// extractNode extracts the Node.js binary for the current platform
func (bm *BinaryManager) extractNode(tempDir string) (string, error) {
	// Determine platform-specific binary path
	platform := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	
	var binaryName string
	if runtime.GOOS == "windows" {
		binaryName = "node.exe"
	} else {
		binaryName = "node"
	}
	
	embeddedPath := fmt.Sprintf("binaries/%s/%s", platform, binaryName)
	
	// Check if embedded binary exists
	if _, err := fs.Stat(binariesFS, embeddedPath); err != nil {
		return "", fmt.Errorf("node binary not found for platform %s: %w", platform, err)
	}
	
	// Extract binary to temp directory
	binaryData, err := binariesFS.ReadFile(embeddedPath)
	if err != nil {
		return "", fmt.Errorf("failed to read embedded node binary: %w", err)
	}
	
	extractedPath := filepath.Join(tempDir, binaryName)
	if err := os.WriteFile(extractedPath, binaryData, 0755); err != nil {
		return "", fmt.Errorf("failed to write node binary to temp location: %w", err)
	}
	
	return extractedPath, nil
}

// extractIncludes extracts the protobuf include files to the specified directory
func (bm *BinaryManager) extractIncludes(includePath string) error {
	// Create include directory
	if err := os.MkdirAll(includePath, 0755); err != nil {
		return fmt.Errorf("failed to create include directory: %w", err)
	}
	
	// Walk through embedded include files
	err := fs.WalkDir(binariesFS, "binaries", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		
		// Skip if not in current platform directory
		platform := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
		expectedPrefix := fmt.Sprintf("binaries/%s/include/", platform)
		if !filepath.HasPrefix(path, expectedPrefix) {
			return nil
		}
		
		// Skip directories
		if d.IsDir() {
			return nil
		}
		
		// Calculate relative path from include root
		relPath, err := filepath.Rel(expectedPrefix, path)
		if err != nil {
			return err
		}
		
		// Read file from embedded FS
		data, err := binariesFS.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read embedded include file %s: %w", path, err)
		}
		
		// Write to extracted location
		destPath := filepath.Join(includePath, relPath)
		destDir := filepath.Dir(destPath)
		if err := os.MkdirAll(destDir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", destDir, err)
		}
		
		if err := os.WriteFile(destPath, data, 0644); err != nil {
			return fmt.Errorf("failed to write include file %s: %w", destPath, err)
		}
		
		return nil
	})
	
	return err
}

// Cleanup removes the extracted binary (call this when app exits)
func (bm *BinaryManager) Cleanup() error {
	if bm.protocPath != "" {
		tempDir := filepath.Dir(bm.protocPath)
		return os.RemoveAll(tempDir)
	}
	return nil
}
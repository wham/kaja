// Package tempdir manages temporary directories for compilation.
// It creates a "kaja" folder under the system temp directory and
// automatically cleans up folders older than 60 minutes.
package tempdir

import (
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	// kajaSubdir is the subdirectory name under the system temp folder
	kajaSubdir = "kaja"

	// maxAge is the maximum age of temp folders before cleanup
	maxAge = 60 * time.Minute

	// cleanupInterval is how often the cleanup goroutine runs
	cleanupInterval = 5 * time.Minute
)

var (
	cleanupOnce sync.Once
)

// StartCleanup starts a background goroutine that periodically cleans up
// old temp folders. It's safe to call multiple times - only the first call
// starts the goroutine.
func StartCleanup() {
	cleanupOnce.Do(func() {
		go cleanupLoop()
	})
}

// NewCompilationDir creates a new unique temporary directory for compilation.
// The directory is created under the system temp folder in a "kaja" subdirectory.
// Returns the path to the created directory.
func NewCompilationDir() (string, error) {
	baseDir := filepath.Join(os.TempDir(), kajaSubdir)

	// Ensure the kaja base directory exists
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return "", err
	}

	// Create a unique temp directory using Go's os.MkdirTemp
	// The pattern "compile-*" will have a unique suffix added
	compilationDir, err := os.MkdirTemp(baseDir, "compile-*")
	if err != nil {
		return "", err
	}

	slog.Debug("Created temp compilation directory", "path", compilationDir)
	return compilationDir, nil
}

// Cleanup removes a specific temp directory
func Cleanup(dir string) error {
	return os.RemoveAll(dir)
}

// cleanupLoop runs periodically to remove old temp folders
func cleanupLoop() {
	// Run cleanup immediately on startup
	cleanupOldFolders()

	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		cleanupOldFolders()
	}
}

// cleanupOldFolders removes all folders older than maxAge
func cleanupOldFolders() {
	baseDir := filepath.Join(os.TempDir(), kajaSubdir)

	entries, err := os.ReadDir(baseDir)
	if err != nil {
		// Directory doesn't exist yet, that's fine
		if os.IsNotExist(err) {
			return
		}
		slog.Error("Failed to read kaja temp directory", "error", err)
		return
	}

	now := time.Now()
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			slog.Error("Failed to get info for temp folder", "name", entry.Name(), "error", err)
			continue
		}

		age := now.Sub(info.ModTime())
		if age > maxAge {
			path := filepath.Join(baseDir, entry.Name())
			if err := os.RemoveAll(path); err != nil {
				slog.Error("Failed to remove old temp folder", "path", path, "error", err)
			} else {
				slog.Debug("Cleaned up old temp folder", "path", path, "age", age)
			}
		}
	}
}

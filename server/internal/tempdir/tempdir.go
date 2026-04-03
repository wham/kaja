package tempdir

import (
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	kajaSubdir      = "kaja"
	maxAge          = 60 * time.Minute
	cleanupInterval = 5 * time.Minute
)

var cleanupOnce sync.Once

func StartCleanup() {
	cleanupOnce.Do(func() {
		go cleanupLoop()
	})
}

func tempBase() string {
	// Use a cache directory under the user's home. Under App Sandbox,
	// os.UserHomeDir() returns the container path, so this works in
	// both sandboxed and non-sandboxed environments without CGo.
	home, err := os.UserHomeDir()
	if err == nil {
		dir := filepath.Join(home, "Library", "Caches", kajaSubdir, "tmp")
		if err := os.MkdirAll(dir, 0755); err == nil {
			return dir
		}
	}
	// Fallback for non-macOS or if home dir lookup fails
	return filepath.Join(os.TempDir(), kajaSubdir)
}

func NewSourcesDir() (string, error) {
	dir := tempBase()

	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	sourcesDir, err := os.MkdirTemp(dir, "sources-*")
	if err != nil {
		return "", err
	}

	slog.Debug("Created temp sources directory", "path", sourcesDir)
	return sourcesDir, nil
}

func cleanupLoop() {
	cleanupOldFolders()

	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		cleanupOldFolders()
	}
}

func cleanupOldFolders() {
	dir := tempBase()

	entries, err := os.ReadDir(dir)
	if err != nil {
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
			path := filepath.Join(dir, entry.Name())
			if err := os.RemoveAll(path); err != nil {
				slog.Error("Failed to remove old temp folder", "path", path, "error", err)
			} else {
				slog.Debug("Cleaned up old temp folder", "path", path, "age", age)
			}
		}
	}
}

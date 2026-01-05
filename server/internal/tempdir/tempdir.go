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

func NewSourcesDir() (string, error) {
	baseDir := filepath.Join(os.TempDir(), kajaSubdir)

	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return "", err
	}

	sourcesDir, err := os.MkdirTemp(baseDir, "sources-*")
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
	baseDir := filepath.Join(os.TempDir(), kajaSubdir)

	entries, err := os.ReadDir(baseDir)
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
			path := filepath.Join(baseDir, entry.Name())
			if err := os.RemoveAll(path); err != nil {
				slog.Error("Failed to remove old temp folder", "path", path, "error", err)
			} else {
				slog.Debug("Cleaned up old temp folder", "path", path, "age", age)
			}
		}
	}
}

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

// baseDir is the override for the temp base directory.
// When empty, os.TempDir() is used (works outside sandbox).
// Set via SetBaseDir before calling NewSourcesDir.
var baseDir string
var baseDirMu sync.Mutex

// SetBaseDir overrides the temp base directory. Under macOS App Sandbox,
// os.TempDir() returns the system-wide path which is not writable;
// call SetBaseDir with NSTemporaryDirectory() to use the sandbox-scoped path.
func SetBaseDir(dir string) {
	baseDirMu.Lock()
	defer baseDirMu.Unlock()
	baseDir = dir
}

func getBaseDir() string {
	baseDirMu.Lock()
	defer baseDirMu.Unlock()
	if baseDir != "" {
		return filepath.Join(baseDir, kajaSubdir)
	}
	return filepath.Join(os.TempDir(), kajaSubdir)
}

func StartCleanup() {
	cleanupOnce.Do(func() {
		go cleanupLoop()
	})
}

func NewSourcesDir() (string, error) {
	dir := getBaseDir()

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
	dir := getBaseDir()

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

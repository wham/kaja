// Package workspace resolves the paths kaja.json writes relative to the
// workspace it configures - proto directories, PEM files - against the same
// root, so a certificate sits beside the protos that describe the service it
// secures.
package workspace

import (
	"os"
	"path/filepath"
)

// Resolve turns a workspace-relative path into an absolute one. An absolute path
// and an empty one are handed back as they are.
func Resolve(path string) string {
	if path == "" || filepath.IsAbs(path) {
		return path
	}
	cwd, err := os.Getwd()
	if err != nil {
		return path
	}
	return filepath.Join(cwd, "../workspace", path)
}

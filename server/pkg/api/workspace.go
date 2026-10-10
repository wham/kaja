package api

import (
	"path/filepath"
	"strings"
)

// A relative path in kaja.json is relative to the file, never to the working directory.
var pathParameters = []string{"proto_dir", "ca_file", "client_cert_file", "client_key_file"}

func workspaceDir(configurationPath string) string {
	dir := filepath.Dir(configurationPath)
	if absolute, err := filepath.Abs(dir); err == nil {
		return absolute
	}
	return dir
}

func resolveWorkspacePath(workspaceDir string, path string) string {
	path = strings.TrimSpace(path)
	if path == "" || filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(workspaceDir, path)
}

func resolveWorkspacePaths(parameters map[string]string, workspaceDir string) {
	for _, name := range pathParameters {
		if value, ok := parameters[name]; ok && strings.TrimSpace(value) != "" {
			parameters[name] = resolveWorkspacePath(workspaceDir, value)
		}
	}
}

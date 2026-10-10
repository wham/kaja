package api

import (
	"path/filepath"
	"strings"
)

// A workspace is a folder holding a kaja.json, and a relative path in that file is a
// path inside the folder - proto directories, PEM files, the scripts folder alike - so
// a checkout carries its own and opens the same on every clone. The server's working
// directory says nothing about where the file is: a desktop build has no useful one.

// pathParameters are the app parameters that name a file or a folder.
var pathParameters = []string{"proto_dir", "ca_file", "client_cert_file", "client_key_file"}

// workspaceDir is the folder a configuration file sits in, made absolute because the
// paths resolved against it are handed to things that run elsewhere.
func workspaceDir(configurationPath string) string {
	dir := filepath.Dir(configurationPath)
	if absolute, err := filepath.Abs(dir); err == nil {
		return absolute
	}
	return dir
}

// resolveWorkspacePath turns a workspace-relative path into an absolute one. An
// absolute path and an empty one are handed back as they are.
func resolveWorkspacePath(workspaceDir string, path string) string {
	path = strings.TrimSpace(path)
	if path == "" || filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(workspaceDir, path)
}

// resolveWorkspacePaths resolves every path parameter in place, which is done once at
// the boundary the apps are handed their parameters across so no app has to know
// where the workspace is.
func resolveWorkspacePaths(parameters map[string]string, workspaceDir string) {
	for _, name := range pathParameters {
		if value, ok := parameters[name]; ok && strings.TrimSpace(value) != "" {
			parameters[name] = resolveWorkspacePath(workspaceDir, value)
		}
	}
}

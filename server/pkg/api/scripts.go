package api

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// scriptsDir is the flat scripts folder beside kaja.json - the same folder the
// desktop app reads, named the same way (see desktop/main.go). It is derived
// from the configuration path rather than from the process's working directory
// so the two can never point at different folders. The path is absolute because
// it is what identifies a script to the client - its console and its stored runs
// are keyed on it - and the configuration path a server is started with is
// usually relative to wherever it was started.
func (s *ApiService) scriptsDir() string {
	dir := filepath.Join(filepath.Dir(s.configurationPath), "scripts")
	if absolute, err := filepath.Abs(dir); err == nil {
		return absolute
	}
	return dir
}

// ListScripts returns the *.ts files in the workspace's scripts folder, by name.
// A missing folder is not a failure: most workspaces ship no scripts, and an
// empty list is the honest answer for one that doesn't.
func (s *ApiService) ListScripts(ctx context.Context, req *ListScriptsRequest) (*ListScriptsResponse, error) {
	dir := s.scriptsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return &ListScriptsResponse{}, nil
		}
		return nil, fmt.Errorf("failed to list scripts: %w", err)
	}

	scripts := make([]*Script, 0, len(entries))
	for _, entry := range entries {
		if !isScriptFile(entry.Name()) || entry.IsDir() {
			continue
		}
		scripts = append(scripts, &Script{
			Path: filepath.Join(dir, entry.Name()),
			Name: entry.Name(),
		})
	}
	sort.Slice(scripts, func(i, j int) bool { return scripts[i].Name < scripts[j].Name })

	slog.Info("Listed scripts", "dir", dir, "count", len(scripts))

	return &ListScriptsResponse{Scripts: scripts}, nil
}

// ReadScript reads one script by its bare file name. The name arrives from a
// browser, so it is never joined onto anything: it is validated as a plain name
// and opened through an os.Root over the scripts folder, which is the whole
// access boundary - the same rule the folder app follows.
func (s *ApiService) ReadScript(ctx context.Context, req *ReadScriptRequest) (*ReadScriptResponse, error) {
	name := strings.TrimSpace(req.Name)
	// filepath.IsLocal rejects absolute paths, "..", and anything that would
	// escape the folder; it is the canonical path-traversal barrier.
	if name == "" || !filepath.IsLocal(name) || name != filepath.Base(name) {
		return nil, fmt.Errorf("script must be a plain name within the scripts folder, got %q", req.Name)
	}
	if !isScriptFile(name) {
		return nil, fmt.Errorf("not a script: %q", name)
	}

	dir := s.scriptsDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to open the scripts folder: %w", err)
	}
	defer root.Close()

	file, err := root.Open(name)
	if err != nil {
		return nil, fmt.Errorf("failed to read script %s: %w", name, err)
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read script %s: %w", name, err)
	}

	return &ReadScriptResponse{Script: &Script{
		Path:    filepath.Join(dir, name),
		Name:    name,
		Content: string(content),
	}}, nil
}

// isScriptFile matches what the desktop lists: a .ts file, dotfiles left out.
func isScriptFile(name string) bool {
	return strings.HasSuffix(name, ".ts") && !strings.HasPrefix(name, ".")
}

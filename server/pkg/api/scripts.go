package api

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// scriptsDir is the scripts folder beside kaja.json - the same folder the
// desktop app reads, named the same way (see desktop/scripts.go). It is derived
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

// ListScripts returns every *.ts file under the workspace's scripts folder, at
// any depth, each with the folder it sits in. A missing folder is not a failure:
// most workspaces ship no scripts, and an empty list is the honest answer for
// one that doesn't.
func (s *ApiService) ListScripts(ctx context.Context, req *ListScriptsRequest) (*ListScriptsResponse, error) {
	dir := s.scriptsDir()
	if _, err := os.Stat(dir); err != nil {
		if os.IsNotExist(err) {
			return &ListScriptsResponse{}, nil
		}
		return nil, fmt.Errorf("failed to list scripts: %w", err)
	}

	scripts := make([]*Script, 0, 16)
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == dir {
			return nil
		}
		// A dot-directory is stepped over whole: it is not part of the
		// workspace's scripts, and neither is anything under it.
		if strings.HasPrefix(entry.Name(), ".") {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entry.IsDir() || !isScriptFile(entry.Name()) {
			return nil
		}
		relative, relErr := filepath.Rel(dir, path)
		if relErr != nil {
			return relErr
		}
		relative = filepath.ToSlash(relative)
		scripts = append(scripts, &Script{
			Path:   path,
			Name:   entry.Name(),
			Folder: path2Dir(relative),
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list scripts: %w", err)
	}
	sort.Slice(scripts, func(i, j int) bool {
		if scripts[i].Folder != scripts[j].Folder {
			return strings.ToLower(scripts[i].Folder) < strings.ToLower(scripts[j].Folder)
		}
		return strings.ToLower(scripts[i].Name) < strings.ToLower(scripts[j].Name)
	})

	slog.Info("Listed scripts", "dir", dir, "count", len(scripts))

	return &ListScriptsResponse{Scripts: scripts}, nil
}

// ReadScript reads one script by its name within the scripts folder, which may
// name a folder. The name arrives from a browser, so it is never joined onto
// anything: it is validated as a local path and opened through an os.Root over
// the scripts folder, which is the whole access boundary - the same rule the
// folder app follows.
func (s *ApiService) ReadScript(ctx context.Context, req *ReadScriptRequest) (*ReadScriptResponse, error) {
	name := filepath.ToSlash(strings.TrimSpace(req.Name))
	// filepath.IsLocal rejects absolute paths, "..", and anything that would
	// escape the folder; it is the canonical path-traversal barrier.
	if name == "" || !filepath.IsLocal(filepath.FromSlash(name)) {
		return nil, fmt.Errorf("script must be a name within the scripts folder, got %q", req.Name)
	}
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") {
			return nil, fmt.Errorf("script must be a name within the scripts folder, got %q", req.Name)
		}
	}
	if !isScriptFile(filepath.Base(name)) {
		return nil, fmt.Errorf("not a script: %q", name)
	}

	dir := s.scriptsDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to open the scripts folder: %w", err)
	}
	defer root.Close()

	content, err := root.ReadFile(name)
	if err != nil {
		return nil, fmt.Errorf("failed to read script %s: %w", name, err)
	}

	return &ReadScriptResponse{Script: &Script{
		Path:    filepath.Join(dir, filepath.FromSlash(name)),
		Name:    filepath.Base(name),
		Folder:  path2Dir(name),
		Content: string(content),
	}}, nil
}

// isScriptFile matches what the desktop lists: a .ts file, dotfiles left out.
func isScriptFile(name string) bool {
	return strings.HasSuffix(name, ".ts") && !strings.HasPrefix(name, ".")
}

// path2Dir is the folder part of a slash-separated relative path, empty at the
// root. filepath.Dir answers "." there, which is a folder name nothing has.
func path2Dir(relative string) string {
	at := strings.LastIndex(relative, "/")
	if at == -1 {
		return ""
	}
	return relative[:at]
}

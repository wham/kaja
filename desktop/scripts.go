package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// The workspace's scripts folder, and the directories inside it. A folder in Files is
// a real directory under that root: creating one, renaming it and moving a file all
// hit disk immediately, so there is no staged state to reconcile.
//
// Every name crossing this boundary is relative to the root and is opened through an
// os.Root, which is the whole access boundary — a path is a name to resolve inside the
// folder, never a handle to follow out of it.

// ScriptFile is the on-disk representation of a Kaja script.
// For ListScripts only Path, Name and Folder are populated; Content is fetched
// on demand via ReadScriptFile.
type ScriptFile struct {
	Path string `json:"path"`
	Name string `json:"name"`
	// Relative to the scripts root, forward-slashed. Empty for a file at the root.
	Folder  string `json:"folder"`
	Content string `json:"content"`
}

// scriptsDir is the scripts folder living next to kaja.json.
func (a *App) scriptsDir() string {
	return filepath.Join(a.workspaceDir, "scripts")
}

// ScriptsFolder is where the workspace's scripts live, for the one thing the UI
// needs the folder itself for: revealing it in the system file browser.
func (a *App) ScriptsFolder() string {
	return a.scriptsDir()
}

// ListScripts returns every *.ts file under the scripts directory, at any depth. A
// missing folder is not a failure: most workspaces ship no scripts.
func (a *App) ListScripts() ([]ScriptFile, error) {
	root := a.scriptsDir()
	scripts := make([]ScriptFile, 0, 16)
	err := walkScripts(root, func(relative string) {
		scripts = append(scripts, ScriptFile{
			Path:   filepath.Join(root, filepath.FromSlash(relative)),
			Name:   pathBase(relative),
			Folder: pathDir(relative),
		})
	}, nil)
	if err != nil {
		return nil, err
	}
	sortScripts(scripts)
	return scripts, nil
}

// ListScriptFolders returns every directory under the scripts root, relative,
// slash-separated and sorted. An empty directory is in the list: it is a directory,
// not a UI grouping.
func (a *App) ListScriptFolders() ([]string, error) {
	folders := []string{}
	if err := walkScripts(a.scriptsDir(), nil, func(relative string) { folders = append(folders, relative) }); err != nil {
		return nil, err
	}
	sort.Strings(folders)
	return folders, nil
}

// ReadScriptFile reads one script. The name is relative to the scripts root.
func (a *App) ReadScriptFile(name string) (*ScriptFile, error) {
	relative, err := relativeScriptPath(a.scriptsDir(), name)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(a.scriptsDir())
	if err != nil {
		return nil, err
	}
	defer root.Close()

	data, err := root.ReadFile(relative)
	if err != nil {
		return nil, err
	}
	return &ScriptFile{
		Path:    filepath.Join(a.scriptsDir(), filepath.FromSlash(relative)),
		Name:    pathBase(relative),
		Folder:  pathDir(relative),
		Content: string(data),
	}, nil
}

// WriteScriptFile writes content back to a script that already exists.
func (a *App) WriteScriptFile(name string, content string) error {
	relative, err := relativeScriptPath(a.scriptsDir(), name)
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(a.scriptsDir())
	if err != nil {
		return err
	}
	defer root.Close()
	if _, err := root.Stat(relative); err != nil {
		return err
	}
	return root.WriteFile(relative, []byte(content), 0644)
}

// CreateScript writes a new script and returns it. The name may name a folder
// ("reports/weekly-usage.ts"). A .ts extension is added if the name doesn't carry one,
// and the folder is created if it doesn't exist yet.
func (a *App) CreateScript(name string, content string) (*ScriptFile, error) {
	dir := a.scriptsDir()
	relative, err := newScriptPath(dir, name)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	defer root.Close()

	if folder := pathDir(relative); folder != "" {
		if err := root.MkdirAll(folder, 0755); err != nil {
			return nil, err
		}
	}
	if _, err := root.Stat(relative); err == nil {
		return nil, fmt.Errorf("a script named %q already exists", relative)
	}
	if err := root.WriteFile(relative, []byte(content), 0644); err != nil {
		return nil, err
	}
	return &ScriptFile{
		Path:    filepath.Join(dir, filepath.FromSlash(relative)),
		Name:    pathBase(relative),
		Folder:  pathDir(relative),
		Content: content,
	}, nil
}

// DeleteScript removes a script.
func (a *App) DeleteScript(name string) error {
	relative, err := relativeScriptPath(a.scriptsDir(), name)
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(a.scriptsDir())
	if err != nil {
		return err
	}
	defer root.Close()
	return root.Remove(relative)
}

// RenameScript renames a script and, when the new name carries a folder, moves it
// there. Renaming and moving are one operation because on disk they are one: the
// file's path is its name.
func (a *App) RenameScript(name string, newName string) (*ScriptFile, error) {
	dir := a.scriptsDir()
	from, err := relativeScriptPath(dir, name)
	if err != nil {
		return nil, err
	}
	to, err := newScriptPath(dir, newName)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	defer root.Close()

	if to != from {
		if folder := pathDir(to); folder != "" {
			if err := root.MkdirAll(folder, 0755); err != nil {
				return nil, err
			}
		}
		if _, err := root.Stat(to); err == nil {
			return nil, fmt.Errorf("a script named %q already exists", to)
		}
		if err := root.Rename(from, to); err != nil {
			return nil, err
		}
	}
	data, err := root.ReadFile(to)
	if err != nil {
		return nil, err
	}
	return &ScriptFile{
		Path:    filepath.Join(dir, filepath.FromSlash(to)),
		Name:    pathBase(to),
		Folder:  pathDir(to),
		Content: string(data),
	}, nil
}

// CreateScriptFolder makes a directory under the scripts root and returns its
// relative path.
func (a *App) CreateScriptFolder(name string) (string, error) {
	dir := a.scriptsDir()
	relative, err := relativeFolderPath(name)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return "", err
	}
	defer root.Close()

	if _, err := root.Stat(relative); err == nil {
		return "", fmt.Errorf("a folder named %q already exists", relative)
	}
	if err := root.MkdirAll(relative, 0755); err != nil {
		return "", err
	}
	return relative, nil
}

// RenameScriptFolder renames a directory. newName is a folder name, not a path: a
// folder is renamed where it is, and moving one is not offered.
func (a *App) RenameScriptFolder(name string, newName string) (string, error) {
	from, err := relativeFolderPath(name)
	if err != nil {
		return "", err
	}
	base, err := relativeFolderPath(newName)
	if err != nil {
		return "", err
	}
	if strings.Contains(base, "/") {
		return "", fmt.Errorf("a folder name is a name, not a path: %q", newName)
	}
	to := base
	if parent := pathDir(from); parent != "" {
		to = parent + "/" + base
	}

	root, err := os.OpenRoot(a.scriptsDir())
	if err != nil {
		return "", err
	}
	defer root.Close()

	if to != from {
		if _, err := root.Stat(to); err == nil {
			return "", fmt.Errorf("a folder named %q already exists", to)
		}
		if err := root.Rename(from, to); err != nil {
			return "", err
		}
	}
	return to, nil
}

// DeleteScriptFolder removes an empty directory. A folder holding scripts is never
// removed as a side effect of tidying the sidebar.
func (a *App) DeleteScriptFolder(name string) error {
	relative, err := relativeFolderPath(name)
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(a.scriptsDir())
	if err != nil {
		return err
	}
	defer root.Close()
	return root.Remove(relative)
}

// scriptPath is the absolute path a name resolves to, which is what identifies a
// script to the UI — its console and its stored runs are keyed on it. A name that
// resolves to nothing is reported back as it arrived, so the caller's own error shows.
func (a *App) scriptPath(name string) string {
	if strings.TrimSpace(name) == "" {
		return ""
	}
	relative, err := relativeScriptPath(a.scriptsDir(), name)
	if err != nil {
		return name
	}
	return filepath.Join(a.scriptsDir(), filepath.FromSlash(relative))
}

// relativeScriptPath reduces whatever the caller has — an absolute path from a
// listing, or a relative one from an agent — to a name inside the scripts root.
func relativeScriptPath(root string, name string) (string, error) {
	relative, err := insideScripts(root, name)
	if err != nil {
		return "", err
	}
	if !isScriptName(pathBase(relative)) {
		return "", fmt.Errorf("not a script: %q", name)
	}
	return relative, nil
}

// newScriptPath is the same, for a name that doesn't exist yet: the extension is
// implied, because naming a draft asks for a name and not for a filename.
func newScriptPath(root string, name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed != "" && !strings.HasSuffix(trimmed, ".ts") {
		trimmed += ".ts"
	}
	return relativeScriptPath(root, trimmed)
}

func relativeFolderPath(name string) (string, error) {
	relative, err := insideScripts("", name)
	if err != nil {
		return "", err
	}
	return relative, nil
}

// insideScripts turns a name into a clean, slash-separated path relative to the
// scripts root, or fails. filepath.IsLocal is the canonical barrier: it rejects
// absolute paths, "..", and anything else that would leave the folder.
func insideScripts(root string, name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", fmt.Errorf("empty script name")
	}
	if root != "" && filepath.IsAbs(trimmed) {
		relative, err := filepath.Rel(root, trimmed)
		if err != nil {
			return "", fmt.Errorf("invalid script path %q", name)
		}
		trimmed = relative
	}
	trimmed = filepath.ToSlash(filepath.Clean(filepath.FromSlash(trimmed)))
	if !filepath.IsLocal(filepath.FromSlash(trimmed)) {
		return "", fmt.Errorf("invalid script path %q", name)
	}
	for _, part := range strings.Split(trimmed, "/") {
		if strings.HasPrefix(part, ".") {
			return "", fmt.Errorf("invalid script path %q", name)
		}
	}
	return trimmed, nil
}

func pathBase(relative string) string {
	at := strings.LastIndex(relative, "/")
	if at == -1 {
		return relative
	}
	return relative[at+1:]
}

func pathDir(relative string) string {
	at := strings.LastIndex(relative, "/")
	if at == -1 {
		return ""
	}
	return relative[:at]
}

func isScriptName(name string) bool {
	return strings.HasSuffix(name, ".ts") && !strings.HasPrefix(name, ".")
}

// --- Disk ------------------------------------------------------------------

// walkScripts visits every script and every directory under root, relative and
// slash-separated. Dot-directories are stepped over whole.
func walkScripts(root string, onFile func(relative string), onFolder func(relative string)) error {
	entries, err := os.Stat(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if !entries.IsDir() {
		return nil
	}

	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		relative, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return relErr
		}
		relative = filepath.ToSlash(relative)
		if strings.HasPrefix(entry.Name(), ".") {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if onFolder != nil {
				onFolder(relative)
			}
			return nil
		}
		if onFile != nil && isScriptName(entry.Name()) {
			onFile(relative)
		}
		return nil
	})
}

// sortScripts puts a listing in the order the sidebar reads it: by folder, then
// by name, both case-insensitively.
func sortScripts(scripts []ScriptFile) {
	sort.Slice(scripts, func(i, j int) bool {
		if scripts[i].Folder != scripts[j].Folder {
			return strings.ToLower(scripts[i].Folder) < strings.ToLower(scripts[j].Folder)
		}
		return strings.ToLower(scripts[i].Name) < strings.ToLower(scripts[j].Name)
	})
}

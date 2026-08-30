package api

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// The workspace's scripts folder, and the directories inside it. A folder in Files is
// a real directory under the scripts root: creating one, renaming it and moving a file
// all hit disk immediately, so there is no staged state to reconcile.
//
// Every name crossing this boundary - the window's own sidebar, an agent, a browser -
// is reduced to a relative path and opened through an os.Root, which is the whole
// access boundary: a path is a name to resolve inside the folder, never a handle to
// follow out of it.
//
// Writing is refused where this kaja does not own the workspace it opened, which is
// the one answer canUpdateConfiguration reports.

// scriptsDir is the scripts folder beside kaja.json. It is derived from the
// configuration path rather than from the process's working directory so the two can
// never point at different folders. The path is absolute because it is what identifies
// a script to the client - its console and its stored runs are keyed on it - and the
// configuration path a server is started with is usually relative to wherever it was
// started.
func (s *ApiService) scriptsDir() string {
	dir := filepath.Join(filepath.Dir(s.configurationPath), "scripts")
	if absolute, err := filepath.Abs(dir); err == nil {
		return absolute
	}
	return dir
}

// CanWriteWorkspace reports whether this kaja may write the workspace it opened. The
// agent switchboard asks it to decide whether the tools that write a script are
// offered at all.
func (s *ApiService) CanWriteWorkspace() bool {
	return s.canUpdateConfiguration
}

// ScriptPath is the absolute path a name resolves to, which is what identifies a
// script to the UI. A name that resolves to nothing is reported back as it arrived, so
// the caller's own error shows.
func (s *ApiService) ScriptPath(name string) string {
	dir := s.scriptsDir()
	relative, err := relativeScriptPath(dir, name)
	if err != nil {
		return name
	}
	return filepath.Join(dir, filepath.FromSlash(relative))
}

// ListScripts returns every *.ts file under the workspace's scripts folder, at any
// depth, each with the folder it sits in. A missing folder is not a failure: most
// workspaces ship no scripts, and an empty list is the honest answer for one that
// doesn't.
func (s *ApiService) ListScripts(ctx context.Context, req *ListScriptsRequest) (*ListScriptsResponse, error) {
	dir := s.scriptsDir()
	scripts := make([]*Script, 0, 16)
	err := walkScripts(dir, func(relative string) {
		scripts = append(scripts, &Script{
			Path:   filepath.Join(dir, filepath.FromSlash(relative)),
			Name:   scriptBase(relative),
			Folder: scriptDir(relative),
		})
	}, nil)
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

// ListScriptFolders returns every directory under the scripts root, sorted. An empty
// directory is in the list: it is a directory, not a UI grouping, so nothing else
// would report it.
func (s *ApiService) ListScriptFolders(ctx context.Context, req *ListScriptFoldersRequest) (*ListScriptFoldersResponse, error) {
	folders := []string{}
	if err := walkScripts(s.scriptsDir(), nil, func(relative string) { folders = append(folders, relative) }); err != nil {
		return nil, fmt.Errorf("failed to list script folders: %w", err)
	}
	sort.Strings(folders)
	return &ListScriptFoldersResponse{Folders: folders}, nil
}

// ReadScript reads one script.
func (s *ApiService) ReadScript(ctx context.Context, req *ReadScriptRequest) (*ReadScriptResponse, error) {
	dir := s.scriptsDir()
	relative, err := relativeScriptPath(dir, req.Name)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to open the scripts folder: %w", err)
	}
	defer root.Close()

	content, err := root.ReadFile(relative)
	if err != nil {
		return nil, fmt.Errorf("failed to read script %s: %w", relative, err)
	}
	return &ReadScriptResponse{Script: scriptAt(dir, relative, string(content))}, nil
}

// WriteScript writes content back to a script that already exists.
func (s *ApiService) WriteScript(ctx context.Context, req *WriteScriptRequest) (*WriteScriptResponse, error) {
	dir, root, err := s.openScriptsForWriting()
	if err != nil {
		return nil, err
	}
	defer root.Close()

	relative, err := relativeScriptPath(dir, req.Name)
	if err != nil {
		return nil, err
	}
	if _, err := root.Stat(relative); err != nil {
		return nil, err
	}
	if err := root.WriteFile(relative, []byte(req.Content), 0644); err != nil {
		return nil, err
	}
	return &WriteScriptResponse{Script: scriptAt(dir, relative, req.Content)}, nil
}

// CreateScript writes a new script and returns it.
func (s *ApiService) CreateScript(ctx context.Context, req *CreateScriptRequest) (*CreateScriptResponse, error) {
	dir, root, err := s.openScriptsForWriting()
	if err != nil {
		return nil, err
	}
	defer root.Close()

	relative, err := newScriptPath(dir, req.Name)
	if err != nil {
		return nil, err
	}
	if folder := scriptDir(relative); folder != "" {
		if err := root.MkdirAll(folder, 0755); err != nil {
			return nil, err
		}
	}
	if _, err := root.Stat(relative); err == nil {
		return nil, fmt.Errorf("a script named %q already exists", relative)
	}
	if err := root.WriteFile(relative, []byte(req.Content), 0644); err != nil {
		return nil, err
	}
	return &CreateScriptResponse{Script: scriptAt(dir, relative, req.Content)}, nil
}

// RenameScript renames a script and, when the new name carries a folder, moves it
// there.
func (s *ApiService) RenameScript(ctx context.Context, req *RenameScriptRequest) (*RenameScriptResponse, error) {
	dir, root, err := s.openScriptsForWriting()
	if err != nil {
		return nil, err
	}
	defer root.Close()

	from, err := relativeScriptPath(dir, req.Name)
	if err != nil {
		return nil, err
	}
	to, err := newScriptPath(dir, req.NewName)
	if err != nil {
		return nil, err
	}
	if to != from {
		if folder := scriptDir(to); folder != "" {
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
	content, err := root.ReadFile(to)
	if err != nil {
		return nil, err
	}
	return &RenameScriptResponse{Script: scriptAt(dir, to, string(content))}, nil
}

// DeleteScript removes a script.
func (s *ApiService) DeleteScript(ctx context.Context, req *DeleteScriptRequest) (*DeleteScriptResponse, error) {
	dir, root, err := s.openScriptsForWriting()
	if err != nil {
		return nil, err
	}
	defer root.Close()

	relative, err := relativeScriptPath(dir, req.Name)
	if err != nil {
		return nil, err
	}
	if err := root.Remove(relative); err != nil {
		return nil, err
	}
	return &DeleteScriptResponse{}, nil
}

// CreateScriptFolder makes a directory under the scripts root.
func (s *ApiService) CreateScriptFolder(ctx context.Context, req *CreateScriptFolderRequest) (*CreateScriptFolderResponse, error) {
	_, root, err := s.openScriptsForWriting()
	if err != nil {
		return nil, err
	}
	defer root.Close()

	relative, err := relativeFolderPath(req.Name)
	if err != nil {
		return nil, err
	}
	if _, err := root.Stat(relative); err == nil {
		return nil, fmt.Errorf("a folder named %q already exists", relative)
	}
	if err := root.MkdirAll(relative, 0755); err != nil {
		return nil, err
	}
	return &CreateScriptFolderResponse{Folder: relative}, nil
}

// RenameScriptFolder renames a directory where it is.
func (s *ApiService) RenameScriptFolder(ctx context.Context, req *RenameScriptFolderRequest) (*RenameScriptFolderResponse, error) {
	_, root, err := s.openScriptsForWriting()
	if err != nil {
		return nil, err
	}
	defer root.Close()

	from, err := relativeFolderPath(req.Name)
	if err != nil {
		return nil, err
	}
	base, err := relativeFolderPath(req.NewName)
	if err != nil {
		return nil, err
	}
	if strings.Contains(base, "/") {
		return nil, fmt.Errorf("a folder name is a name, not a path: %q", req.NewName)
	}
	to := base
	if parent := scriptDir(from); parent != "" {
		to = parent + "/" + base
	}
	if to != from {
		if _, err := root.Stat(to); err == nil {
			return nil, fmt.Errorf("a folder named %q already exists", to)
		}
		if err := root.Rename(from, to); err != nil {
			return nil, err
		}
	}
	return &RenameScriptFolderResponse{Folder: to}, nil
}

// DeleteScriptFolder removes a folder and everything under it. It opens the root
// itself rather than going through openScriptsForWriting, which makes the folder it is
// about to write in: a workspace with no scripts folder has nothing to delete, and
// making one to say so is the wrong answer.
func (s *ApiService) DeleteScriptFolder(ctx context.Context, req *DeleteScriptFolderRequest) (*DeleteScriptFolderResponse, error) {
	if !s.canUpdateConfiguration {
		return nil, ErrScriptsReadOnly
	}
	relative, err := relativeFolderPath(req.Name)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(s.scriptsDir())
	if err != nil {
		if os.IsNotExist(err) {
			return &DeleteScriptFolderResponse{}, nil
		}
		return nil, err
	}
	defer root.Close()
	if err := root.RemoveAll(relative); err != nil {
		return nil, err
	}
	return &DeleteScriptFolderResponse{}, nil
}

// ErrScriptsReadOnly is every write a served workspace refuses. It is the sentence an
// agent is answered with too, which is why it names what a kaja here can still do.
var ErrScriptsReadOnly = errors.New("this Kaja serves a workspace it does not own, so scripts here can be read and run, not written")

// openScriptsForWriting is the gate and the root every write goes through, so refusing
// and resolving are never spelled out twice. The folder is created first: filing a
// script somewhere new needs no trip to make the place.
func (s *ApiService) openScriptsForWriting() (string, *os.Root, error) {
	if !s.canUpdateConfiguration {
		return "", nil, ErrScriptsReadOnly
	}
	dir := s.scriptsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", nil, err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return "", nil, fmt.Errorf("failed to open the scripts folder: %w", err)
	}
	return dir, root, nil
}

func scriptAt(dir string, relative string, content string) *Script {
	return &Script{
		Path:    filepath.Join(dir, filepath.FromSlash(relative)),
		Name:    scriptBase(relative),
		Folder:  scriptDir(relative),
		Content: content,
	}
}

// relativeScriptPath reduces whatever the caller has - an absolute path from a
// listing, or a relative one typed by hand - to the name of a script inside the root.
func relativeScriptPath(root string, name string) (string, error) {
	relative, err := insideScripts(root, name)
	if err != nil {
		return "", err
	}
	if !isScriptFile(scriptBase(relative)) {
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
	return insideScripts("", name)
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

// isScriptFile is what the sidebar lists: a .ts file, dotfiles left out.
func isScriptFile(name string) bool {
	return strings.HasSuffix(name, ".ts") && !strings.HasPrefix(name, ".")
}

func scriptBase(relative string) string {
	at := strings.LastIndex(relative, "/")
	if at == -1 {
		return relative
	}
	return relative[at+1:]
}

// scriptDir is the folder part of a slash-separated relative path, empty at the root.
// filepath.Dir answers "." there, which is a folder name nothing has.
func scriptDir(relative string) string {
	at := strings.LastIndex(relative, "/")
	if at == -1 {
		return ""
	}
	return relative[:at]
}

// walkScripts visits every script and every directory under root, relative and
// slash-separated. Dot-directories are stepped over whole, and a root that isn't there
// is an empty workspace rather than a failure.
func walkScripts(root string, onFile func(relative string), onFolder func(relative string)) error {
	info, err := os.Stat(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if !info.IsDir() {
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
		if onFile != nil && isScriptFile(entry.Name()) {
			onFile(relative)
		}
		return nil
	})
}

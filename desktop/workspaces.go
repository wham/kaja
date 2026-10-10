package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/wham/kaja/v2/pkg/api"
)

const workspacesFileName = "workspaces.json"

type Workspace struct {
	Dir     string `json:"dir"`
	Name    string `json:"name"`
	Default bool   `json:"default"`
}

type WorkspacesInfo struct {
	Current Workspace   `json:"current"`
	Known   []Workspace `json:"known"`
}

// The default is never written: it is always known.
type workspaceStore struct {
	path       string
	defaultDir string
}

type workspaceEntries struct {
	Current string   `json:"current,omitempty"`
	Known   []string `json:"known,omitempty"`
}

func newWorkspaceStore(kajaDir string) *workspaceStore {
	return &workspaceStore{path: filepath.Join(kajaDir, workspacesFileName), defaultDir: defaultWorkspaceDir(kajaDir)}
}

func defaultWorkspaceDir(kajaDir string) string {
	return filepath.Join(kajaDir, "workspace")
}

func readableFolder(dir string) error {
	info, err := os.Stat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a folder", dir)
	}
	return nil
}

func (s *workspaceStore) load() workspaceEntries {
	var entries workspaceEntries
	data, err := os.ReadFile(s.path)
	if err != nil {
		return entries
	}
	if err := json.Unmarshal(data, &entries); err != nil {
		slog.Warn("Failed to read the workspaces file", "path", s.path, "error", err)
	}
	return entries
}

func (s *workspaceStore) save(entries workspaceEntries) error {
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0644)
}

// A folder that isn't there falls back to the default rather than being created: an
// unplugged disk's mount point is a path that looks writable.
func (s *workspaceStore) current() (dir string, missing string) {
	entries := s.load()
	if entries.Current == "" || entries.Current == s.defaultDir {
		return s.defaultDir, ""
	}
	if err := readableFolder(entries.Current); err != nil {
		return s.defaultDir, entries.Current
	}
	return entries.Current, ""
}

func (s *workspaceStore) known() []string {
	return knownWorkspaces(s.defaultDir, s.load().Known)
}

func (s *workspaceStore) open(dir string) error {
	entries := s.load()
	entries.Current = dir
	entries.Known = rememberWorkspace(s.defaultDir, entries.Known, dir)
	return s.save(entries)
}

func (s *workspaceStore) clearRecent() error {
	entries := s.load()
	entries.Known = nil
	if entries.Current != "" && entries.Current != s.defaultDir {
		entries.Known = []string{entries.Current}
	}
	return s.save(entries)
}

func knownWorkspaces(defaultDir string, known []string) []string {
	dirs := []string{defaultDir}
	for _, dir := range known {
		if dir != "" && dir != defaultDir {
			dirs = append(dirs, dir)
		}
	}
	return dirs
}

func rememberWorkspace(defaultDir string, known []string, dir string) []string {
	if dir == defaultDir {
		return known
	}
	return append([]string{dir}, forgetWorkspace(known, dir)...)
}

func forgetWorkspace(known []string, dir string) []string {
	kept := make([]string, 0, len(known))
	for _, candidate := range known {
		if candidate != dir {
			kept = append(kept, candidate)
		}
	}
	return kept
}

// Two folders named alike are told apart by the folder above.
func describeWorkspaces(defaultDir string, dirs []string) []Workspace {
	counts := map[string]int{}
	for _, dir := range dirs {
		if dir != defaultDir {
			counts[filepath.Base(dir)]++
		}
	}
	workspaces := make([]Workspace, 0, len(dirs))
	for _, dir := range dirs {
		if dir == defaultDir {
			workspaces = append(workspaces, Workspace{Dir: dir, Name: "Default", Default: true})
			continue
		}
		name := filepath.Base(dir)
		if counts[name] > 1 {
			name = filepath.Join(filepath.Base(filepath.Dir(dir)), name)
		}
		workspaces = append(workspaces, Workspace{Dir: dir, Name: name})
	}
	return workspaces
}

func configurationPathIn(dir string) string {
	return filepath.Join(dir, "kaja.json")
}

// Writes kaja.json where there is none and nothing else, so opening a checkout adds
// one file to it at most.
func prepareWorkspace(dir string) error {
	if err := readableFolder(dir); err != nil {
		return err
	}
	path := configurationPathIn(dir)
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.WriteFile(path, []byte("{}\n"), 0644)
}

// Workspaces reports the open workspace and every known one. Desktop only.
func (a *App) Workspaces() WorkspacesInfo {
	a.workspaceMu.Lock()
	defer a.workspaceMu.Unlock()
	return a.workspacesLocked()
}

// Must be called with workspaceMu held.
func (a *App) workspacesLocked() WorkspacesInfo {
	known := describeWorkspaces(a.workspaces.defaultDir, a.workspaces.known())
	info := WorkspacesInfo{Known: known}
	for _, workspace := range known {
		if workspace.Dir == a.workspaceDir {
			info.Current = workspace
		}
	}
	return info
}

func (a *App) chooseWorkspace() {
	dir, err := a.app.Dialog.OpenFile().
		CanChooseFiles(false).
		CanChooseDirectories(true).
		CanCreateDirectories(true).
		SetTitle("Open Workspace").
		SetMessage("A workspace is a folder with a kaja.json in it. Kaja writes one into a folder that has none.").
		SetButtonText("Open").
		PromptForSingleSelection()
	if err != nil {
		slog.Warn("Failed to pick a workspace", "error", err)
		return
	}
	if dir == "" {
		return
	}
	if a.bookmarkStore != nil {
		if err := a.bookmarkStore.Save(dir, dir); err != nil {
			slog.Warn("Failed to save bookmark", "path", dir, "error", err)
		}
	}
	a.openWorkspace(dir, "")
}

// A link handed over is delivered once the new page is listening.
func (a *App) openWorkspace(dir string, pendingLink string) {
	dir = filepath.Clean(dir)
	if err := prepareWorkspace(dir); err != nil {
		slog.Error("Failed to open the workspace", "path", dir, "error", err)
		a.app.Dialog.Warning().
			SetTitle("Kaja can't open that folder").
			SetMessage(fmt.Sprintf("%s: %s. The workspace is unchanged.", dir, err)).
			Show()
		return
	}

	a.workspaceMu.Lock()
	if dir == a.workspaceDir {
		a.workspaceMu.Unlock()
		if pendingLink != "" {
			a.openLink(pendingLink)
		}
		return
	}
	a.workspaceMu.Unlock()

	a.stopMCPServer()

	configurationPath := configurationPathIn(dir)
	a.api.SetWorkspace(configurationPath, NewKeychainStore(configurationPath))

	a.workspaceMu.Lock()
	a.workspaceDir = dir
	if err := a.workspaces.open(dir); err != nil {
		slog.Warn("Failed to record the open workspace", "path", dir, "error", err)
	}
	a.workspaceMu.Unlock()

	if a.api.McpEnabled() {
		a.startMCPServer()
	}

	// Reset before the reload, or the link goes to the page on its way out.
	a.linkMu.Lock()
	a.linksReady = false
	if pendingLink != "" {
		a.pendingLinks = append(a.pendingLinks, pendingLink)
	}
	a.linkMu.Unlock()

	a.app.Menu.Set(a.buildAppMenu())
	a.window.Reload()
	slog.Info("Opened workspace", "path", dir)
}

func (a *App) clearRecentWorkspaces() {
	a.workspaceMu.Lock()
	err := a.workspaces.clearRecent()
	a.workspaceMu.Unlock()
	if err != nil {
		slog.Warn("Failed to clear the recent workspaces", "error", err)
		return
	}
	a.app.Menu.Set(a.buildAppMenu())
	a.app.Event.Emit("workspace:changed")
}

func (a *App) reportMissingWorkspace(dir string) {
	a.app.Dialog.Warning().
		SetTitle("Workspace not found").
		SetMessage(fmt.Sprintf("%s isn't there, so Kaja opened its default workspace instead. It stays in the list and opens again once it is back.", dir)).
		Show()
}

// The open workspace first, then the known ones most recently opened first.
func (a *App) workspaceForLink(link string) (dir string, elsewhere bool) {
	named := api.LinkedScriptName(link)
	a.workspaceMu.Lock()
	current := a.workspaceDir
	known := a.workspaces.known()
	a.workspaceMu.Unlock()
	if named == "" || api.WorkspaceHasScript(configurationPathIn(current), named) {
		return current, false
	}
	for _, candidate := range known {
		if candidate != current && api.WorkspaceHasScript(configurationPathIn(candidate), named) {
			return candidate, true
		}
	}
	return current, false
}

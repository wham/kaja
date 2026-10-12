package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

const settingsFileName = "settings.json"

type Settings struct {
	Shortcuts  map[string]string `json:"shortcuts,omitempty"`
	Mcp        McpSettings       `json:"mcp"`
	Workspaces WorkspaceList     `json:"workspaces"`
}

type McpSettings struct {
	Enabled bool   `json:"enabled,omitempty"`
	Token   string `json:"token,omitempty"`
}

// The default is never written: it is always known, and iOS moves the container it
// sits in on an update.
type WorkspaceList struct {
	Current string   `json:"current,omitempty"`
	Known   []string `json:"known,omitempty"`
}

type settingsStore struct {
	path string
	mu   sync.Mutex
}

func newSettingsStore(kajaDir string) *settingsStore {
	return &settingsStore{path: filepath.Join(kajaDir, settingsFileName)}
}

func (s *settingsStore) load() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read()
}

func (s *settingsStore) update(change func(*Settings)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	settings := s.read()
	change(&settings)
	return s.write(settings)
}

// Must be called with mu held.
func (s *settingsStore) read() Settings {
	var settings Settings
	data, err := os.ReadFile(s.path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			slog.Warn("Failed to read the settings", "path", s.path, "error", err)
		}
		return settings
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		slog.Warn("Failed to parse the settings", "path", s.path, "error", err)
	}
	return settings
}

// Owner-only, because the MCP token is in it.
// Must be called with mu held.
func (s *settingsStore) write(settings Settings) error {
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	temp := s.path + ".tmp"
	if err := os.WriteFile(temp, data, 0600); err != nil {
		return err
	}
	if err := os.Rename(temp, s.path); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return nil
}

// Shortcuts reports the keys this person set. Desktop only: a browser keeps its own.
func (a *App) Shortcuts() map[string]string {
	shortcuts := a.settings.load().Shortcuts
	if shortcuts == nil {
		return map[string]string{}
	}
	return shortcuts
}

// SetShortcuts replaces the keys this person set.
func (a *App) SetShortcuts(shortcuts map[string]string) error {
	if err := a.settings.update(func(settings *Settings) {
		settings.Shortcuts = shortcuts
		if len(shortcuts) == 0 {
			settings.Shortcuts = nil
		}
	}); err != nil {
		return fmt.Errorf("the shortcuts could not be written to %s: %w", settingsFileName, err)
	}
	return nil
}

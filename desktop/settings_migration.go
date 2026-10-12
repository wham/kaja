package main

import (
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/wham/kaja/v2/pkg/api"
)

// The settings used to be two files and two keys in whichever kaja.json was open: the
// workspace list, the MCP token, the keyboard shortcuts and the MCP switch. Done once,
// when there is no settings.json yet. The old files go only after the new one is written,
// so a move that failed is found again next time; kaja.json is left as it is, since what
// it says is still a fair default for that workspace.
func migrateSettings(kajaDir string) error {
	store := newSettingsStore(kajaDir)
	if _, err := os.Stat(store.path); err == nil || !errors.Is(err, os.ErrNotExist) {
		return err
	}

	listPath := filepath.Join(kajaDir, "workspaces.json")
	tokenPath := filepath.Join(kajaDir, "mcp-token")

	var settings Settings
	if data, err := os.ReadFile(listPath); err == nil {
		if err := json.Unmarshal(data, &settings.Workspaces); err != nil {
			slog.Warn("Failed to read the old workspace list", "path", listPath, "error", err)
		}
	}
	if data, err := os.ReadFile(tokenPath); err == nil {
		settings.Mcp.Token = strings.TrimSpace(string(data))
	}

	open := settings.Workspaces.Current
	if open == "" {
		open = defaultWorkspaceDir(kajaDir)
	}
	if workspace := api.LoadGetWorkspaceResponse(workspaceFileIn(open)).Workspace; workspace != nil {
		settings.Shortcuts = workspace.GetShortcuts()
		settings.Mcp.Enabled = workspace.GetMcp().GetEnabled()
	}

	store.mu.Lock()
	err := store.write(settings)
	store.mu.Unlock()
	if err != nil {
		return err
	}
	for _, path := range []string{listPath, tokenPath} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("Failed to remove a moved settings file", "path", path, "error", err)
		}
	}
	slog.Info("Moved the settings", "to", store.path)
	return nil
}

package main

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/wham/kaja/v2/pkg/api"
)

// The installation's folder used to be the workspace. Done once, when the old layout
// is found and the new one is not; the keychain keys values by the file's path, so
// they move with it.
func migrateDefaultWorkspace(kajaDir string, storeFor func(configurationPath string) api.VariableStore) error {
	oldPath := filepath.Join(kajaDir, "kaja.json")
	newDir := defaultWorkspaceDir(kajaDir)
	newPath := configurationPathIn(newDir)
	if _, err := os.Stat(newPath); err == nil {
		return nil
	}
	if _, err := os.Stat(oldPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	if err := os.MkdirAll(newDir, 0755); err != nil {
		return err
	}
	oldScripts := filepath.Join(kajaDir, "scripts")
	entries, err := os.ReadDir(oldScripts)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, entry := range entries {
		if err := os.Rename(filepath.Join(oldScripts, entry.Name()), filepath.Join(newDir, entry.Name())); err != nil {
			return err
		}
	}
	if err == nil {
		_ = os.Remove(oldScripts)
	}

	// The file goes last, so a move that failed halfway is found again next time.
	configuration := api.LoadGetConfigurationResponse(oldPath).Configuration
	if err := os.Rename(oldPath, newPath); err != nil {
		return err
	}
	moveStoredValues(configuration.GetVariables(), storeFor(oldPath), storeFor(newPath))
	slog.Info("Moved the default workspace", "from", kajaDir, "to", newDir)
	return nil
}

func moveStoredValues(variables map[string]string, from api.VariableStore, to api.VariableStore) {
	if from == nil || to == nil || !from.Available() {
		return
	}
	for name, value := range variables {
		if value != api.SecretSource {
			continue
		}
		stored, ok := from.Get(name)
		if !ok {
			continue
		}
		if err := to.Set(name, stored); err != nil {
			slog.Warn("Failed to move a stored value", "name", name, "error", err)
			continue
		}
		if err := from.Delete(name); err != nil {
			slog.Warn("Failed to remove a moved value", "name", name, "error", err)
		}
	}
}

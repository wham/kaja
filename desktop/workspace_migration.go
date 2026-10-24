package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/wham/kaja/v2/pkg/api"
)

// keychainItems is the keychain addressed by account, which is how an item named
// before workspaces had an id - "<kaja.json path>#NAME" - is reached.
type keychainItems interface {
	Available() bool
	Get(account string) (string, bool)
	Set(account string, value string) error
	Delete(account string) error
}

type osKeychainItems struct{ store *keychainStore }

func (k osKeychainItems) Available() bool                        { return k.store.Available() }
func (k osKeychainItems) Get(account string) (string, bool)      { return keychainGet(account) }
func (k osKeychainItems) Set(account string, value string) error { return keychainSet(account, value) }
func (k osKeychainItems) Delete(account string) error            { return keychainDelete(account) }

// The installation's folder used to be the workspace. Done once, when the old layout
// is found and the new one is not; a value from then is named by the file's path, so
// it moves with it, and adoptStoredValues takes it from there.
func migrateDefaultWorkspace(kajaDir string, items keychainItems) error {
	oldPath := filepath.Join(kajaDir, "kaja.json")
	newDir := defaultWorkspaceDir(kajaDir)
	newPath := workspaceFileIn(newDir)
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
	workspace := api.LoadGetWorkspaceResponse(oldPath).Workspace
	if err := os.Rename(oldPath, newPath); err != nil {
		return err
	}
	moveStoredValues(workspace.GetVariables(), items, oldPath, newPath)
	slog.Info("Moved the default workspace", "from", kajaDir, "to", newDir)
	return nil
}

func moveStoredValues(variables map[string]string, items keychainItems, fromFile string, toFile string) {
	if items == nil || !items.Available() {
		return
	}
	for name, value := range variables {
		if strings.TrimSpace(value) != api.SecretSource {
			continue
		}
		stored, ok := items.Get(keychainAccount(fromFile, name))
		if !ok {
			continue
		}
		if err := items.Set(keychainAccount(toFile, name), stored); err != nil {
			slog.Warn("Failed to move a stored value", "name", name, "error", err)
			continue
		}
		if err := items.Delete(keychainAccount(fromFile, name)); err != nil {
			slog.Warn("Failed to remove a moved value", "name", name, "error", err)
		}
	}
}

// adoptStoredValues files the values named by the workspace's kaja.json path under
// the workspace's id instead, giving it one if it has none, so they sync. Done each
// time a workspace is opened, and a no-op once nothing is named the old way. Where
// the id already holds a value - the workspace arrived from another device with its
// values - that one is kept and the old item dropped.
func adoptStoredValues(service *api.ApiService, workspaceFile string, items keychainItems) {
	if items == nil || !items.Available() {
		return
	}
	ctx := context.Background()
	response, err := service.GetWorkspace(ctx, &api.GetWorkspaceRequest{})
	if err != nil {
		slog.Warn("Failed to read the workspace for its stored values", "error", err)
		return
	}
	stored := map[string]bool{}
	for _, status := range response.VariableStatus {
		stored[status.Name] = status.Source == api.VariableSource_VARIABLE_SOURCE_KEYCHAIN
	}
	for name, value := range response.Workspace.GetVariables() {
		if strings.TrimSpace(value) != api.SecretSource {
			continue
		}
		account := keychainAccount(workspaceFile, name)
		legacy, ok := items.Get(account)
		if !ok {
			continue
		}
		if !stored[name] {
			if _, err := service.SetStoredValue(ctx, &api.SetStoredValueRequest{Name: name, Value: legacy}); err != nil {
				slog.Warn("Failed to adopt a stored value", "name", name, "error", err)
				continue
			}
		}
		if err := items.Delete(account); err != nil {
			slog.Warn("Failed to remove an adopted value", "name", name, "error", err)
		}
		slog.Info("Filed a stored value under the workspace's id", "name", name)
	}
}

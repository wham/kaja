package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wham/kaja/v2/pkg/api"
)

// memoryItems is the keychain by account, and a VariableStore over the same items.
type memoryItems struct{ values map[string]string }

func (s *memoryItems) Available() bool { return true }
func (s *memoryItems) Get(account string) (string, bool) {
	value, ok := s.values[account]
	return value, ok
}
func (s *memoryItems) Set(account string, value string) error { s.values[account] = value; return nil }
func (s *memoryItems) Delete(account string) error            { delete(s.values, account); return nil }

type memoryStore struct{ items *memoryItems }

func (s memoryStore) Available() bool { return true }
func (s memoryStore) Get(workspaceID string, name string) (string, bool) {
	return s.items.Get(keychainAccount(workspaceID, name))
}
func (s memoryStore) Set(workspaceID string, name string, value string) error {
	return s.items.Set(keychainAccount(workspaceID, name), value)
}
func (s memoryStore) Delete(workspaceID string, name string) error {
	return s.items.Delete(keychainAccount(workspaceID, name))
}

func TestMigrateDefaultWorkspaceMovesTheFileTheScriptsAndTheValues(t *testing.T) {
	kajaDir := t.TempDir()
	oldPath := filepath.Join(kajaDir, "kaja.json")
	if err := os.WriteFile(oldPath, []byte(`{"variables": {"TOKEN": "${secret}", "URL": "http://x"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(kajaDir, "scripts", "reports"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"churn.ts", "reports/weekly.ts"} {
		if err := os.WriteFile(filepath.Join(kajaDir, "scripts", name), []byte("// "+name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(kajaDir, "mcp-token"), []byte("t"), 0600); err != nil {
		t.Fatal(err)
	}

	newDir := defaultWorkspaceDir(kajaDir)
	newPath := workspaceFileIn(newDir)
	items := &memoryItems{values: map[string]string{oldPath + "#TOKEN": "hunter2", oldPath + "#URL": "stale"}}

	if err := migrateDefaultWorkspace(kajaDir, items); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"kaja.json", "churn.ts", "reports/weekly.ts"} {
		if _, err := os.Stat(filepath.Join(newDir, name)); err != nil {
			t.Errorf("%s was not moved: %v", name, err)
		}
	}
	for _, name := range []string{"kaja.json", "scripts"} {
		if _, err := os.Stat(filepath.Join(kajaDir, name)); err == nil {
			t.Errorf("%s was left behind", name)
		}
	}
	if _, err := os.Stat(filepath.Join(kajaDir, "mcp-token")); err != nil {
		t.Error("the installation's own files were moved")
	}
	if got := items.values[newPath+"#TOKEN"]; got != "hunter2" {
		t.Errorf("the stored value did not follow the file: %q", got)
	}
	if _, left := items.values[oldPath+"#TOKEN"]; left {
		t.Error("the old value was not removed")
	}
	if _, moved := items.values[newPath+"#URL"]; moved {
		t.Error("a value written in the file is not in the store")
	}

	// Done once: a second run finds the new layout and touches nothing.
	if err := migrateDefaultWorkspace(kajaDir, items); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateDefaultWorkspaceLeavesAFreshInstallationAlone(t *testing.T) {
	kajaDir := t.TempDir()
	if err := migrateDefaultWorkspace(kajaDir, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(defaultWorkspaceDir(kajaDir)); err == nil {
		t.Error("a workspace was made where there was nothing to move")
	}
}

// A value named by the file's path is filed under the workspace's id, which the
// workspace is given; one the id already holds is kept over it.
func TestAdoptStoredValuesFilesThemUnderTheWorkspaceId(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kaja.json")
	if err := os.WriteFile(path, []byte(`{"variables": {"TOKEN": "${secret}", "OTHER": "${secret}", "URL": "http://x"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	items := &memoryItems{values: map[string]string{path + "#TOKEN": "hunter2", path + "#URL": "stale"}}
	service := api.NewApiService(path, true, "", "", memoryStore{items})
	defer service.Close()

	adoptStoredValues(service, path, items)

	id, err := service.EnsureWorkspaceID()
	if err != nil {
		t.Fatal(err)
	}
	written := api.LoadGetWorkspaceResponse(path).Workspace.GetId()
	if written == "" || written != id {
		t.Fatalf("kaja.json says id %q, the service %q", written, id)
	}
	if got := items.values[id+"#TOKEN"]; got != "hunter2" {
		t.Errorf("TOKEN under the id is %q, want the adopted value", got)
	}
	if _, left := items.values[path+"#TOKEN"]; left {
		t.Error("the value is still named by the path")
	}
	if _, ok := items.values[path+"#URL"]; !ok {
		t.Error("an item for a variable kaja.json writes out was touched")
	}

	// Arriving from another device: the id's value is the one kept.
	items.values[path+"#TOKEN"] = "older"
	adoptStoredValues(service, path, items)
	if got := items.values[id+"#TOKEN"]; got != "hunter2" {
		t.Errorf("TOKEN under the id is %q, want the one already there", got)
	}
	if _, left := items.values[path+"#TOKEN"]; left {
		t.Error("the duplicate was not dropped")
	}
}

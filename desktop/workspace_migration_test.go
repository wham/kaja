package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wham/kaja/v2/pkg/api"
)

type memoryStore struct{ values map[string]string }

func (s *memoryStore) Available() bool { return true }
func (s *memoryStore) Get(name string) (string, bool) {
	value, ok := s.values[name]
	return value, ok
}
func (s *memoryStore) Set(name string, value string) error { s.values[name] = value; return nil }
func (s *memoryStore) Delete(name string) error            { delete(s.values, name); return nil }

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
	stores := map[string]*memoryStore{
		oldPath:                     {values: map[string]string{"TOKEN": "hunter2", "URL": "stale"}},
		configurationPathIn(newDir): {values: map[string]string{}},
	}
	storeFor := func(path string) api.VariableStore { return stores[path] }

	if err := migrateDefaultWorkspace(kajaDir, storeFor); err != nil {
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
	if got := stores[configurationPathIn(newDir)].values["TOKEN"]; got != "hunter2" {
		t.Errorf("the stored value did not follow the file: %q", got)
	}
	if _, left := stores[oldPath].values["TOKEN"]; left {
		t.Error("the old value was not removed")
	}
	if _, moved := stores[configurationPathIn(newDir)].values["URL"]; moved {
		t.Error("a value written in the file is not in the store")
	}

	// Done once: a second run finds the new layout and touches nothing.
	if err := migrateDefaultWorkspace(kajaDir, storeFor); err != nil {
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

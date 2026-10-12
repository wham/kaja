package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestMigrateSettingsGathersTheOldFiles(t *testing.T) {
	kajaDir := t.TempDir()
	open := t.TempDir()
	write := func(path, content string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(kajaDir, "workspaces.json"), `{"current": "`+open+`", "known": ["`+open+`"]}`)
	write(filepath.Join(kajaDir, "mcp-token"), "abc123\n")
	write(workspaceFileIn(open), `{"shortcuts": {"run": "Mod+R"}, "mcp": {"enabled": true}}`)

	if err := migrateSettings(kajaDir); err != nil {
		t.Fatal(err)
	}

	got := newSettingsStore(kajaDir).load()
	want := Settings{
		Shortcuts:  map[string]string{"run": "Mod+R"},
		Mcp:        McpSettings{Enabled: true, Token: "abc123"},
		Workspaces: WorkspaceList{Current: open, Known: []string{open}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("settings = %+v, want %+v", got, want)
	}
	for _, name := range []string{"workspaces.json", "mcp-token"} {
		if _, err := os.Stat(filepath.Join(kajaDir, name)); !os.IsNotExist(err) {
			t.Errorf("%s is still there: %v", name, err)
		}
	}
	if info, err := os.Stat(filepath.Join(kajaDir, settingsFileName)); err != nil || info.Mode().Perm() != 0600 {
		t.Errorf("settings.json mode = %v (%v), want 0600 because the token is in it", info.Mode().Perm(), err)
	}
	if data, _ := os.ReadFile(workspaceFileIn(open)); len(data) == 0 {
		t.Error("kaja.json was emptied, want it left as it was")
	}
}

func TestMigrateSettingsRunsOnce(t *testing.T) {
	kajaDir := t.TempDir()
	if err := newSettingsStore(kajaDir).update(func(settings *Settings) { settings.Mcp.Token = "kept" }); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(kajaDir, "mcp-token"), []byte("stale"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := migrateSettings(kajaDir); err != nil {
		t.Fatal(err)
	}
	if got := newSettingsStore(kajaDir).load().Mcp.Token; got != "kept" {
		t.Errorf("token = %q, want the settings left alone once they exist", got)
	}
}

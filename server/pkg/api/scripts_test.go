package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// workspaceWithScripts writes a kaja.json and the scripts beside it, and returns
// the configuration path a service is started with.
func workspaceWithScripts(t *testing.T, scripts map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	configurationPath := filepath.Join(dir, "kaja.json")
	if err := os.WriteFile(configurationPath, []byte("{}"), 0644); err != nil {
		t.Fatalf("failed to write configuration: %v", err)
	}
	if len(scripts) == 0 {
		return configurationPath
	}
	scriptsDir := filepath.Join(dir, "scripts")
	if err := os.MkdirAll(scriptsDir, 0755); err != nil {
		t.Fatalf("failed to create scripts dir: %v", err)
	}
	for name, content := range scripts {
		if err := os.WriteFile(filepath.Join(scriptsDir, name), []byte(content), 0644); err != nil {
			t.Fatalf("failed to write script %s: %v", name, err)
		}
	}
	return configurationPath
}

func TestListScriptsReadsTheFolderBesideTheConfiguration(t *testing.T) {
	configurationPath := workspaceWithScripts(t, map[string]string{
		"seat-map.ts":  "// seats",
		"programme.ts": "// shows",
		"notes.md":     "not a script",
		".hidden.ts":   "// hidden",
	})
	service := NewApiService(configurationPath, false, "", "", nil)

	response, err := service.ListScripts(context.Background(), &ListScriptsRequest{})
	if err != nil {
		t.Fatalf("failed to list scripts: %v", err)
	}

	if len(response.Scripts) != 2 {
		t.Fatalf("expected the two .ts files, got %d: %v", len(response.Scripts), response.Scripts)
	}
	// Sorted by name, so a listing is stable across filesystems.
	if response.Scripts[0].Name != "programme.ts" || response.Scripts[1].Name != "seat-map.ts" {
		t.Errorf("expected the scripts sorted by name, got %q and %q", response.Scripts[0].Name, response.Scripts[1].Name)
	}
	// The path identifies the script to the client, so it must not depend on
	// where the server happened to be started.
	if !filepath.IsAbs(response.Scripts[0].Path) {
		t.Errorf("expected an absolute path, got %q", response.Scripts[0].Path)
	}
	// A listing carries names; contents cost a read each.
	if response.Scripts[0].Content != "" {
		t.Errorf("expected a listing to carry no content, got %q", response.Scripts[0].Content)
	}
}

// Most workspaces ship no scripts at all, which is not a failure to report.
func TestListScriptsWithNoFolder(t *testing.T) {
	service := NewApiService(workspaceWithScripts(t, nil), false, "", "", nil)

	response, err := service.ListScripts(context.Background(), &ListScriptsRequest{})
	if err != nil {
		t.Fatalf("expected a missing scripts folder to be an empty list, got %v", err)
	}
	if len(response.Scripts) != 0 {
		t.Fatalf("expected no scripts, got %d", len(response.Scripts))
	}
}

func TestReadScript(t *testing.T) {
	configurationPath := workspaceWithScripts(t, map[string]string{"programme.ts": "// shows\n"})
	service := NewApiService(configurationPath, false, "", "", nil)

	response, err := service.ReadScript(context.Background(), &ReadScriptRequest{Name: "programme.ts"})
	if err != nil {
		t.Fatalf("failed to read script: %v", err)
	}
	if response.Script.Content != "// shows\n" {
		t.Errorf("expected the file's content, got %q", response.Script.Content)
	}
	if response.Script.Name != "programme.ts" {
		t.Errorf("expected the file's name, got %q", response.Script.Name)
	}
}

// The name arrives from a browser, so the scripts folder is the whole access
// boundary: nothing may name its way out of it, and nothing outside it is a
// script to begin with.
func TestReadScriptRefusesAnythingButAPlainScriptName(t *testing.T) {
	configurationPath := workspaceWithScripts(t, map[string]string{"programme.ts": "// shows"})
	service := NewApiService(configurationPath, false, "", "", nil)

	for _, name := range []string{
		"../kaja.json",
		"../../etc/passwd",
		"/etc/passwd",
		"nested/programme.ts",
		"",
		"kaja.json",
		"programme.txt",
	} {
		if _, err := service.ReadScript(context.Background(), &ReadScriptRequest{Name: name}); err == nil {
			t.Errorf("expected %q to be refused", name)
		}
	}
}

// A symlink pointing out of the folder is the case filepath.IsLocal can't see:
// the name is plain, and only opening it through the root refuses it.
func TestReadScriptRefusesASymlinkOutOfTheFolder(t *testing.T) {
	configurationPath := workspaceWithScripts(t, map[string]string{"programme.ts": "// shows"})
	secret := filepath.Join(t.TempDir(), "secret.ts")
	if err := os.WriteFile(secret, []byte("// secret"), 0644); err != nil {
		t.Fatalf("failed to write the file to link to: %v", err)
	}
	link := filepath.Join(filepath.Dir(configurationPath), "scripts", "escape.ts")
	if err := os.Symlink(secret, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	service := NewApiService(configurationPath, false, "", "", nil)
	if _, err := service.ReadScript(context.Background(), &ReadScriptRequest{Name: "escape.ts"}); err == nil {
		t.Error("expected a symlink out of the scripts folder to be refused")
	}
}

package api

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
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
		path := filepath.Join(scriptsDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatalf("failed to create folder for %s: %v", name, err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
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

// A folder in Files is a real directory, so a listing is the whole tree and each
// script says which folder it is filed in.
func TestListScriptsWalksTheFolders(t *testing.T) {
	configurationPath := workspaceWithScripts(t, map[string]string{
		"programme.ts":              "// shows",
		"reports/churn.ts":          "// churn",
		"reports/weekly/usage.ts":   "// usage",
		"seed-data/ingest.ts":       "// ingest",
		".hidden/nothing-to-see.ts": "// hidden",
	})
	service := NewApiService(configurationPath, false, "", "", nil)

	response, err := service.ListScripts(context.Background(), &ListScriptsRequest{})
	if err != nil {
		t.Fatalf("failed to list scripts: %v", err)
	}

	got := make([]string, 0, len(response.Scripts))
	for _, script := range response.Scripts {
		got = append(got, script.Folder+"|"+script.Name)
	}
	want := []string{"|programme.ts", "reports|churn.ts", "reports/weekly|usage.ts", "seed-data|ingest.ts"}
	if len(got) != len(want) {
		t.Fatalf("listed %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("listed %v, want %v", got, want)
		}
	}
}

// A folder is part of a script's name now, so reading one is the same read.
func TestReadScriptInAFolder(t *testing.T) {
	configurationPath := workspaceWithScripts(t, map[string]string{"reports/churn.ts": "// churn"})
	service := NewApiService(configurationPath, false, "", "", nil)

	response, err := service.ReadScript(context.Background(), &ReadScriptRequest{Name: "reports/churn.ts"})
	if err != nil {
		t.Fatalf("failed to read script: %v", err)
	}
	if response.Script.Content != "// churn" || response.Script.Folder != "reports" || response.Script.Name != "churn.ts" {
		t.Errorf("read back %+v", response.Script)
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
		"reports/../../kaja.json",
		".hidden/programme.ts",
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

// writableWorkspace is a kaja that owns the workspace it opened, which is what every
// write below needs and what the served build refuses.
func writableWorkspace(t *testing.T) *ApiService {
	t.Helper()
	return NewApiService(workspaceWithScripts(t, nil), true, "", "", nil)
}

func createScript(t *testing.T, service *ApiService, name string, content string) *Script {
	t.Helper()
	response, err := service.CreateScript(context.Background(), &CreateScriptRequest{Name: name, Content: content})
	if err != nil {
		t.Fatalf("failed to create %s: %v", name, err)
	}
	return response.Script
}

// The folder is the whole access boundary: a name is resolved inside it, never
// followed out of it.
func TestScriptPathsStayInsideTheFolder(t *testing.T) {
	root := t.TempDir()

	// A name, a name with a folder, and the absolute path a listing hands back all
	// name the same kind of thing.
	for _, name := range []string{"hello.ts", "reports/weekly.ts", filepath.Join(root, "hello.ts")} {
		relative, err := relativeScriptPath(root, name)
		if err != nil {
			t.Fatalf("relativeScriptPath(%q): %v", name, err)
		}
		if strings.HasPrefix(relative, "/") || strings.Contains(relative, "..") {
			t.Fatalf("relativeScriptPath(%q) = %q", name, relative)
		}
	}

	// Anything that would leave the folder is refused rather than clamped, so a
	// caller hears about it instead of silently writing somewhere else.
	for _, name := range []string{"../../etc/passwd", "/etc/passwd", "../secret.ts", "  ", ".hidden.ts", ".config/x.ts"} {
		if _, err := relativeScriptPath(root, name); err == nil {
			t.Fatalf("relativeScriptPath(%q) was accepted", name)
		}
	}

	// Only scripts.
	if _, err := relativeScriptPath(root, "notes.md"); err == nil {
		t.Fatalf("a non-script was accepted")
	}
}

// Naming a draft asks for a name and a folder; they arrive here as one path, and
// the folder is created because a folder in the naming sheet may be a new one.
func TestCreateScriptFilesItInAFolder(t *testing.T) {
	service := writableWorkspace(t)

	file := createScript(t, service, "reports/weekly-usage", "// hi")
	if file.Name != "weekly-usage.ts" || file.Folder != "reports" {
		t.Fatalf("created %+v", file)
	}
	if data, err := os.ReadFile(filepath.Join(service.scriptsDir(), "reports", "weekly-usage.ts")); err != nil || string(data) != "// hi" {
		t.Fatalf("read back: %v %q", err, data)
	}

	// A name that is taken is a failure, not an overwrite.
	if _, err := service.CreateScript(context.Background(), &CreateScriptRequest{Name: "reports/weekly-usage.ts", Content: "// other"}); err == nil {
		t.Fatalf("expected a collision")
	}
}

// An empty folder persists: it is a directory, not a UI grouping.
func TestFoldersAreDirectories(t *testing.T) {
	service := writableWorkspace(t)
	ctx := context.Background()

	if _, err := service.CreateScriptFolder(ctx, &CreateScriptFolderRequest{Name: "billing"}); err != nil {
		t.Fatal(err)
	}
	listed, err := service.ListScriptFolders(ctx, &ListScriptFoldersRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Folders) != 1 || listed.Folders[0] != "billing" {
		t.Fatalf("folders = %q", listed.Folders)
	}
	if _, err := service.CreateScriptFolder(ctx, &CreateScriptFolderRequest{Name: "billing"}); err == nil {
		t.Fatalf("a duplicate folder was accepted")
	}

	// Renaming is a name, not a path: the folder is renamed where it is.
	if _, err := service.CreateScriptFolder(ctx, &CreateScriptFolderRequest{Name: "billing/monthly"}); err != nil {
		t.Fatal(err)
	}
	moved, err := service.RenameScriptFolder(ctx, &RenameScriptFolderRequest{Name: "billing/monthly", NewName: "quarterly"})
	if err != nil {
		t.Fatal(err)
	}
	if moved.Folder != "billing/quarterly" {
		t.Fatalf("renamed to %q", moved.Folder)
	}
	if _, err := service.RenameScriptFolder(ctx, &RenameScriptFolderRequest{Name: "billing", NewName: "a/b"}); err == nil {
		t.Fatalf("a path was accepted as a folder name")
	}

	if _, err := service.DeleteScriptFolder(ctx, &DeleteScriptFolderRequest{Name: "billing/quarterly"}); err != nil {
		t.Fatalf("an empty folder was not removed: %v", err)
	}

	// A folder is a place, so deleting one takes what is filed there with it.
	createScript(t, service, "billing/invoices.ts", "")
	createScript(t, service, "billing/2024/january.ts", "")
	if _, err := service.DeleteScriptFolder(ctx, &DeleteScriptFolderRequest{Name: "billing"}); err != nil {
		t.Fatalf("a folder holding scripts was not removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(service.scriptsDir(), "billing")); !os.IsNotExist(err) {
		t.Fatalf("the folder is still there")
	}
	scripts, err := service.ListScripts(ctx, &ListScriptsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(scripts.Scripts) != 0 {
		t.Fatalf("scripts = %+v", scripts.Scripts)
	}

	// Deleting one that is already gone is the act asked for, not a failure.
	if _, err := service.DeleteScriptFolder(ctx, &DeleteScriptFolderRequest{Name: "billing"}); err != nil {
		t.Fatalf("a folder that was already gone reported %v", err)
	}
	// The scripts root itself is not a folder anything may delete.
	if _, err := service.DeleteScriptFolder(ctx, &DeleteScriptFolderRequest{Name: "."}); err == nil {
		t.Fatalf("the scripts root was accepted")
	}
	if _, err := service.DeleteScriptFolder(ctx, &DeleteScriptFolderRequest{Name: "../scripts"}); err == nil {
		t.Fatalf("a path leaving the scripts root was accepted")
	}
}

// Renaming and moving are one operation, because a file's path is its name.
func TestRenameScriptMoves(t *testing.T) {
	service := writableWorkspace(t)
	ctx := context.Background()
	createScript(t, service, "draft.ts", "// body")

	moved, err := service.RenameScript(ctx, &RenameScriptRequest{Name: "draft.ts", NewName: "reports/churn"})
	if err != nil {
		t.Fatal(err)
	}
	if moved.Script.Folder != "reports" || moved.Script.Name != "churn.ts" || moved.Script.Content != "// body" {
		t.Fatalf("moved %+v", moved.Script)
	}
	if _, err := os.Stat(filepath.Join(service.scriptsDir(), "draft.ts")); !os.IsNotExist(err) {
		t.Fatalf("the original is still there")
	}

	// Onto a name that is taken, nothing moves.
	createScript(t, service, "other.ts", "")
	if _, err := service.RenameScript(ctx, &RenameScriptRequest{Name: "other.ts", NewName: "reports/churn.ts"}); err == nil {
		t.Fatalf("a move onto an existing file was accepted")
	}
	if _, err := service.ReadScript(ctx, &ReadScriptRequest{Name: "other.ts"}); err != nil {
		t.Fatalf("the source was moved anyway: %v", err)
	}
}

// A write is to a script that exists; creating one is the other verb. Reading takes
// the absolute path a listing reported as readily as the name inside the folder.
func TestWriteScript(t *testing.T) {
	service := writableWorkspace(t)
	ctx := context.Background()
	createScript(t, service, "reports/churn.ts", "old")

	if _, err := service.WriteScript(ctx, &WriteScriptRequest{Name: "reports/churn.ts", Content: "new"}); err != nil {
		t.Fatal(err)
	}
	read, err := service.ReadScript(ctx, &ReadScriptRequest{Name: filepath.Join(service.scriptsDir(), "reports", "churn.ts")})
	if err != nil {
		t.Fatal(err)
	}
	if read.Script.Content != "new" || read.Script.Folder != "reports" {
		t.Fatalf("read back %+v", read.Script)
	}
	if _, err := service.WriteScript(ctx, &WriteScriptRequest{Name: "reports/nothing.ts", Content: "x"}); err == nil {
		t.Fatalf("wrote a file that doesn't exist")
	}

	if _, err := service.DeleteScript(ctx, &DeleteScriptRequest{Name: "reports/churn.ts"}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReadScript(ctx, &ReadScriptRequest{Name: "reports/churn.ts"}); err == nil {
		t.Fatalf("the deleted script is still readable")
	}
}

// A kaja serving a workspace it does not own reads and runs, and refuses every verb
// that would write - before anything reaches disk.
func TestAServedWorkspaceRefusesEveryWrite(t *testing.T) {
	writable := writableWorkspace(t)
	createScript(t, writable, "reports/churn.ts", "// body")
	served := NewApiService(filepath.Join(filepath.Dir(writable.scriptsDir()), "kaja.json"), false, "", "", nil)
	ctx := context.Background()

	writes := map[string]error{}
	_, writes["WriteScript"] = served.WriteScript(ctx, &WriteScriptRequest{Name: "reports/churn.ts", Content: "changed"})
	_, writes["CreateScript"] = served.CreateScript(ctx, &CreateScriptRequest{Name: "new.ts", Content: ""})
	_, writes["RenameScript"] = served.RenameScript(ctx, &RenameScriptRequest{Name: "reports/churn.ts", NewName: "moved.ts"})
	_, writes["DeleteScript"] = served.DeleteScript(ctx, &DeleteScriptRequest{Name: "reports/churn.ts"})
	_, writes["CreateScriptFolder"] = served.CreateScriptFolder(ctx, &CreateScriptFolderRequest{Name: "billing"})
	_, writes["RenameScriptFolder"] = served.RenameScriptFolder(ctx, &RenameScriptFolderRequest{Name: "reports", NewName: "billing"})
	_, writes["DeleteScriptFolder"] = served.DeleteScriptFolder(ctx, &DeleteScriptFolderRequest{Name: "reports"})
	for verb, err := range writes {
		if !errors.Is(err, ErrScriptsReadOnly) {
			t.Errorf("%s answered %v, want the read-only refusal", verb, err)
		}
	}

	if served.CanWriteWorkspace() {
		t.Error("a served workspace reported itself writable")
	}
	read, err := served.ReadScript(ctx, &ReadScriptRequest{Name: "reports/churn.ts"})
	if err != nil {
		t.Fatalf("reading is still offered: %v", err)
	}
	if read.Script.Content != "// body" {
		t.Errorf("a refused write landed anyway: %q", read.Script.Content)
	}
}

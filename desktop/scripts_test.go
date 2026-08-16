package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func scriptsApp(t *testing.T) *App {
	t.Helper()
	app := &App{workspaceDir: t.TempDir()}
	if err := os.MkdirAll(app.scriptsDir(), 0755); err != nil {
		t.Fatal(err)
	}
	return app
}

// The folder is the whole access boundary: a name is resolved inside it, never
// followed out of it.
func TestScriptPathsStayInsideTheFolder(t *testing.T) {
	app := scriptsApp(t)
	root := app.scriptsDir()

	// A name, a name with the extension, a name with a folder, and the absolute
	// path a listing hands back all name the same kind of thing.
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
	app := scriptsApp(t)

	file, err := app.CreateScript("reports/weekly-usage", "// hi")
	if err != nil {
		t.Fatal(err)
	}
	if file.Name != "weekly-usage.ts" || file.Folder != "reports" {
		t.Fatalf("created %+v", file)
	}
	if data, err := os.ReadFile(filepath.Join(app.scriptsDir(), "reports", "weekly-usage.ts")); err != nil || string(data) != "// hi" {
		t.Fatalf("read back: %v %q", err, data)
	}

	// A name that is taken is a failure, not an overwrite.
	if _, err := app.CreateScript("reports/weekly-usage.ts", "// other"); err == nil {
		t.Fatalf("expected a collision")
	}
}

// A listing is the whole tree, at any depth, with the folder each file sits in.
func TestListScriptsWalksTheTree(t *testing.T) {
	app := scriptsApp(t)
	for _, name := range []string{"root.ts", "reports/churn.ts", "reports/weekly/usage.ts", "seed-data/ingest.ts"} {
		if _, err := app.CreateScript(name, ""); err != nil {
			t.Fatal(err)
		}
	}
	// Not scripts, and not listed.
	if err := os.WriteFile(filepath.Join(app.scriptsDir(), "notes.md"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(app.scriptsDir(), ".hidden"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app.scriptsDir(), ".hidden", "x.ts"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	scripts, err := app.ListScripts()
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, script := range scripts {
		got = append(got, script.Folder+"/"+script.Name)
	}
	want := "/root.ts reports/churn.ts reports/weekly/usage.ts seed-data/ingest.ts"
	if strings.Join(got, " ") != want {
		t.Fatalf("listed %q, want %q", strings.Join(got, " "), want)
	}

	folders, err := app.ListScriptFolders()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(folders, " ") != "reports reports/weekly seed-data" {
		t.Fatalf("folders = %q", folders)
	}
}

// An empty folder persists: it is a directory, not a UI grouping.
func TestFoldersAreDirectories(t *testing.T) {
	app := scriptsApp(t)

	if _, err := app.CreateScriptFolder("billing"); err != nil {
		t.Fatal(err)
	}
	folders, _ := app.ListScriptFolders()
	if len(folders) != 1 || folders[0] != "billing" {
		t.Fatalf("folders = %q", folders)
	}
	if _, err := app.CreateScriptFolder("billing"); err == nil {
		t.Fatalf("a duplicate folder was accepted")
	}

	// Renaming is a name, not a path: the folder is renamed where it is.
	if _, err := app.CreateScriptFolder("billing/monthly"); err != nil {
		t.Fatal(err)
	}
	moved, err := app.RenameScriptFolder("billing/monthly", "quarterly")
	if err != nil {
		t.Fatal(err)
	}
	if moved != "billing/quarterly" {
		t.Fatalf("renamed to %q", moved)
	}
	if _, err := app.RenameScriptFolder("billing", "a/b"); err == nil {
		t.Fatalf("a path was accepted as a folder name")
	}

	// A folder holding scripts is not removed as a side effect of tidying up.
	if _, err := app.CreateScript("billing/invoices.ts", ""); err != nil {
		t.Fatal(err)
	}
	if err := app.DeleteScriptFolder("billing"); err == nil {
		t.Fatalf("a folder holding scripts was removed")
	}
	if err := app.DeleteScriptFolder("billing/quarterly"); err != nil {
		t.Fatalf("an empty folder was not removed: %v", err)
	}
}

// Renaming and moving are one operation, because a file's path is its name.
func TestRenameScriptMoves(t *testing.T) {
	app := scriptsApp(t)
	if _, err := app.CreateScript("draft.ts", "// body"); err != nil {
		t.Fatal(err)
	}

	moved, err := app.RenameScript("draft.ts", "reports/churn")
	if err != nil {
		t.Fatal(err)
	}
	if moved.Folder != "reports" || moved.Name != "churn.ts" || moved.Content != "// body" {
		t.Fatalf("moved %+v", moved)
	}
	if _, err := os.Stat(filepath.Join(app.scriptsDir(), "draft.ts")); !os.IsNotExist(err) {
		t.Fatalf("the original is still there")
	}

	// Onto a name that is taken, nothing moves.
	if _, err := app.CreateScript("other.ts", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := app.RenameScript("other.ts", "reports/churn.ts"); err == nil {
		t.Fatalf("a move onto an existing file was accepted")
	}
	if _, err := app.ReadScriptFile("other.ts"); err != nil {
		t.Fatalf("the source was moved anyway: %v", err)
	}
}

// A write is to a script that exists; creating one is the other verb.
func TestWriteScriptFile(t *testing.T) {
	app := scriptsApp(t)
	if _, err := app.CreateScript("reports/churn.ts", "old"); err != nil {
		t.Fatal(err)
	}
	if err := app.WriteScriptFile("reports/churn.ts", "new"); err != nil {
		t.Fatal(err)
	}
	file, err := app.ReadScriptFile(filepath.Join(app.scriptsDir(), "reports", "churn.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if file.Content != "new" || file.Folder != "reports" {
		t.Fatalf("read back %+v", file)
	}
	if err := app.WriteScriptFile("reports/nothing.ts", "x"); err == nil {
		t.Fatalf("wrote a file that doesn't exist")
	}
}

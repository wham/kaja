package folder

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveExpandsHome(t *testing.T) {
	home := homeDir()
	if home == "" {
		t.Skip("no home directory")
	}
	for path, want := range map[string]string{
		"~":             home,
		"~/Downloads":   filepath.Join(home, "Downloads"),
		" ~/a/../b/ ":   filepath.Join(home, "b"),
		"/srv/data/":    "/srv/data",
		"~other/folder": "~other/folder",
		"":              "",
	} {
		if got := Resolve(path); got != want {
			t.Errorf("Resolve(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestCheck(t *testing.T) {
	folder := t.TempDir()
	if problem := Check(folder); problem != nil {
		t.Errorf("an empty folder: %v", problem)
	}

	file := filepath.Join(folder, "notes.md")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if problem := Check(file); problem == nil || problem.Kind != NotAFolder {
		t.Errorf("a file: %v", problem)
	}
	if problem := Check(filepath.Join(folder, "gone")); problem == nil || problem.Kind != Missing {
		t.Errorf("nothing: %v", problem)
	}

	if os.Geteuid() == 0 {
		return
	}
	locked := filepath.Join(folder, "locked")
	if err := os.Mkdir(locked, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(locked, 0o755) })
	if problem := Check(locked); problem == nil || problem.Kind != Refused {
		t.Errorf("a folder it may not read: %v", problem)
	}
}

func TestOpenRefusesAFolderItCannotRead(t *testing.T) {
	_, err := New().Open(context.Background(), map[string]string{"path": filepath.Join(t.TempDir(), "gone")}, t.TempDir(), func(string) {})
	var problem *Problem
	if !errors.As(err, &problem) || problem.Kind != Missing {
		t.Fatalf("Open = %v, want the folder reported missing", err)
	}
}

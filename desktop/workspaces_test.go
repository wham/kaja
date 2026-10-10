package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestWorkspaceStoreRemembersWhatWasOpened(t *testing.T) {
	kajaDir := defaultWorkspaceDir(t.TempDir())
	store := newWorkspaceStore(filepath.Dir(kajaDir))

	if dir, missing := store.current(); dir != kajaDir || missing != "" {
		t.Fatalf("a fresh store opens the default: got %q (missing %q)", dir, missing)
	}

	a := t.TempDir()
	b := t.TempDir()
	for _, dir := range []string{a, b, a} {
		if err := store.open(dir); err != nil {
			t.Fatal(err)
		}
	}
	if got, want := store.known(), []string{kajaDir, a, b}; !reflect.DeepEqual(got, want) {
		t.Errorf("known = %v, want the default first and then most recent first %v", got, want)
	}
	if dir, _ := store.current(); dir != a {
		t.Errorf("current = %q, want %q", dir, a)
	}

	// Clearing the menu keeps the open workspace and the default, which are not in it.
	if err := store.clearRecent(); err != nil {
		t.Fatal(err)
	}
	if got, want := store.known(), []string{kajaDir, a}; !reflect.DeepEqual(got, want) {
		t.Errorf("known after clearing = %v, want %v", got, want)
	}

	// Opening the default records nothing about it: it is always known.
	if err := store.open(kajaDir); err != nil {
		t.Fatal(err)
	}
	if got, want := store.known(), []string{kajaDir, a}; !reflect.DeepEqual(got, want) {
		t.Errorf("known after opening the default = %v, want %v", got, want)
	}
}

func TestWorkspaceStoreFallsBackWhenTheFolderIsGone(t *testing.T) {
	kajaDir := defaultWorkspaceDir(t.TempDir())
	store := newWorkspaceStore(filepath.Dir(kajaDir))
	gone := filepath.Join(t.TempDir(), "unplugged")
	if err := store.open(gone); err != nil {
		t.Fatal(err)
	}
	dir, missing := store.current()
	if dir != kajaDir || missing != gone {
		t.Errorf("current = %q (missing %q), want the default and the folder that is gone", dir, missing)
	}
	// The name is left in the file, so it is used again as soon as it is back.
	if got := store.known(); !reflect.DeepEqual(got, []string{kajaDir, gone}) {
		t.Errorf("known = %v, want the missing folder kept", got)
	}
}

func TestDescribeWorkspacesNamesFoldersAndTellsTwinsApart(t *testing.T) {
	defaultDir := "/containers/kaja"
	got := describeWorkspaces(defaultDir, []string{defaultDir, "/work/acme/api", "/home/me/api", "/work/site"})
	want := []Workspace{
		{Dir: defaultDir, Name: "Default", Default: true},
		{Dir: "/work/acme/api", Name: "acme/api"},
		{Dir: "/home/me/api", Name: "me/api"},
		{Dir: "/work/site", Name: "site"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("describeWorkspaces = %+v, want %+v", got, want)
	}
}

func TestPrepareWorkspaceWritesOnlyTheMissingFile(t *testing.T) {
	dir := t.TempDir()
	if err := prepareWorkspace(dir); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(configurationPathIn(dir))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "{}\n" {
		t.Errorf("a new workspace's file = %q", data)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Errorf("opening a folder wrote more than kaja.json into it: %v", entries)
	}

	if err := os.WriteFile(configurationPathIn(dir), []byte(`{"apps": []}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := prepareWorkspace(dir); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(configurationPathIn(dir)); string(data) != `{"apps": []}` {
		t.Errorf("a file that was there was rewritten: %q", data)
	}

	if err := prepareWorkspace(filepath.Join(dir, "missing")); err == nil {
		t.Error("a folder that is not there is refused rather than created")
	}
}

func TestReadableFolderRefusesWhatIsNotAFolder(t *testing.T) {
	dir := t.TempDir()
	if err := readableFolder(dir); err != nil {
		t.Fatalf("expected a folder to be usable: %v", err)
	}
	if err := readableFolder(filepath.Join(dir, "missing")); err == nil {
		t.Error("expected a missing folder to be refused")
	}
	file := filepath.Join(dir, "notes.md")
	if err := os.WriteFile(file, []byte("hi"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := readableFolder(file); err == nil {
		t.Error("expected a file to be refused")
	}
}

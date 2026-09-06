package main

import (
	"os"
	"path/filepath"
	"testing"
)

// A folder that isn't there is refused rather than created, so an unplugged disk's
// mount point never becomes the place scripts are written.
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
		t.Fatalf("failed to write the file: %v", err)
	}
	if err := readableFolder(file); err == nil {
		t.Error("expected a file to be refused")
	}
}

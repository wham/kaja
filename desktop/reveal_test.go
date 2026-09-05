package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRevealTarget(t *testing.T) {
	root := t.TempDir()
	folder := filepath.Join(root, "Application Support", "Claude")
	if err := os.MkdirAll(folder, 0755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(folder, "claude_desktop_config.json")
	if err := os.WriteFile(file, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		path string
		want string
	}{
		{"the file itself", file, file},
		{"an agent that hasn't written its file yet", filepath.Join(folder, "missing.json"), folder},
		{"an agent that isn't installed", filepath.Join(root, "Application Support", "Zed", "settings.json"), filepath.Join(root, "Application Support")},
		{"nothing to reveal", "   ", ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := revealTarget(test.path); got != test.want {
				t.Errorf("revealTarget(%q) = %q, want %q", test.path, got, test.want)
			}
		})
	}
}

// A path whose metadata is refused rather than absent is the App Sandbox's case, and
// the answer is the path itself: climbing past it would land on a folder that has
// nothing to do with what was asked for.
func TestRevealTargetKeepsAPathItCannotStat(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root reads through the mode bits this stands the case up with")
	}
	root := t.TempDir()
	closed := filepath.Join(root, "closed")
	if err := os.MkdirAll(filepath.Join(closed, "Claude"), 0755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(closed, "Claude", "claude_desktop_config.json")
	if err := os.WriteFile(file, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(closed, 0000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(closed, 0755) })

	if got := revealTarget(file); got != file {
		t.Errorf("revealTarget(%q) = %q, want the path itself", file, got)
	}
}

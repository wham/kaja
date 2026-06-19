package main

import (
	"path/filepath"
	"testing"
)

func TestGuardScriptPath(t *testing.T) {
	a := &App{workspaceDir: t.TempDir()}
	root := filepath.Clean(a.scriptsDir())

	// Valid: bare name, name with .ts, and an absolute path already in the dir.
	for _, in := range []string{"hello.ts", "hello", filepath.Join(root, "hello.ts")} {
		got, err := a.guardScriptPath(in)
		if err != nil {
			t.Fatalf("guardScriptPath(%q) unexpected error: %v", in, err)
		}
		if filepath.Dir(got) != root {
			t.Fatalf("guardScriptPath(%q) = %q, escaped root %q", in, got, root)
		}
	}

	// Traversal and absolute escapes must be confined to the root, never escape.
	for _, in := range []string{"../../etc/passwd", "/etc/passwd", "../secret.ts", "a/b/c.ts"} {
		got, err := a.guardScriptPath(in)
		if err != nil {
			continue // rejected outright is fine
		}
		if filepath.Dir(got) != root {
			t.Fatalf("guardScriptPath(%q) = %q escaped root %q", in, got, root)
		}
	}

	// Empty is rejected.
	if _, err := a.guardScriptPath("  "); err == nil {
		t.Fatalf("expected error for empty path")
	}
}

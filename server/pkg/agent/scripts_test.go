package agent

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wham/kaja/v2/pkg/api"
)

// The window keys an open editor, a console and a sidebar row on the absolute path, so
// that is what a change carries. Said relatively, a write reached no open editor and
// the file only caught up when it was opened again.
func TestAChangeCarriesTheAbsolutePath(t *testing.T) {
	root := t.TempDir()
	configuration := filepath.Join(root, "kaja.json")
	if err := os.WriteFile(configuration, []byte("{}"), 0o644); err != nil {
		t.Fatalf("write configuration: %v", err)
	}
	scripts := NewWorkspaceScripts(api.NewApiService(configuration, true, "", "", nil))
	folder := filepath.Join(root, "scripts", "reports")
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatalf("make folder: %v", err)
	}

	created, err := scripts.Create("reports/weekly.ts", "// weekly")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	want := filepath.Join(folder, "weekly.ts")
	if created.Path != want {
		t.Errorf("create path = %q, want %q", created.Path, want)
	}
	// And the agent is still answered with the name it hands back.
	if info := created.Script(); info.Path != "reports/weekly.ts" {
		t.Errorf("the agent's name = %q", info.Path)
	}

	written, err := scripts.Write("reports/weekly.ts", "// edited")
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if written.Path != want {
		t.Errorf("write path = %q, want %q", written.Path, want)
	}
	if written.Content != "// edited" {
		t.Errorf("write content = %q", written.Content)
	}

	renamed, err := scripts.Rename("reports/weekly.ts", "reports/monthly.ts")
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.OldPath != want {
		t.Errorf("rename oldPath = %q, want %q", renamed.OldPath, want)
	}
	if moved := filepath.Join(folder, "monthly.ts"); renamed.Path != moved {
		t.Errorf("rename path = %q, want %q", renamed.Path, moved)
	}
}

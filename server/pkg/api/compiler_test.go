package api

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCompileWorkspaceProto(t *testing.T) {
	// Find workspace directory relative to this test
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}

	// Navigate from server/pkg/api/ to the workspace proto directory
	protoDir := filepath.Join(cwd, "../../../workspace/quirks/proto")
	if _, err := os.Stat(protoDir); os.IsNotExist(err) {
		t.Skipf("workspace not found at %s", protoDir)
	}

	compiler := NewCompiler(NewLogger())

	manifest, err := compiler.compile(protoDir)
	if err != nil {
		t.Fatalf("compile failed: %v", err)
	}
	if !strings.Contains(manifest, `"modules":[{`) {
		t.Fatalf("the manifest has no modules: %s", manifest)
	}
}

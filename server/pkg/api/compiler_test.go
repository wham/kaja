package api

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCompileQuirksProto(t *testing.T) {
	// Find workspace directory relative to this test
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}

	// Navigate from server/pkg/api/ to workspace/quirks/proto
	protoDir := filepath.Join(cwd, "../../../workspace/quirks/proto")
	if _, err := os.Stat(protoDir); os.IsNotExist(err) {
		t.Skipf("workspace not found at %s", protoDir)
	}

	sourcesDir := t.TempDir()

	compiler := NewCompiler()
	compiler.logger = NewLogger()

	err = compiler.compile(filepath.Join(cwd, "../../.."), sourcesDir, protoDir)
	if err != nil {
		t.Fatalf("compile failed: %v", err)
	}

	// Check that some .ts files were generated
	var tsFiles []string
	filepath.Walk(sourcesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && filepath.Ext(path) == ".ts" {
			tsFiles = append(tsFiles, path)
		}
		return nil
	})

	if len(tsFiles) == 0 {
		t.Fatal("no TypeScript files generated")
	}
	t.Logf("Generated %d TypeScript files", len(tsFiles))
}

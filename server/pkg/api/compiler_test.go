package api

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/apps/openapi"
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

// A surface an app compiled to open itself is generated from as it is, and has to
// read exactly as the same .proto files compiled off the disk do.
func TestGenerateFromOpenedApp(t *testing.T) {
	spec, err := os.ReadFile("../apps/openapi/testdata/kitchensink.yaml")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	opened, err := openapi.New().Open(context.Background(), map[string]string{"spec_content": string(spec)}, dir, func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if opened.Compiled == nil {
		t.Fatal("the app handed on nothing it compiled")
	}

	compiler := NewCompiler(NewLogger())
	generated, err := compiler.run(dir, opened.Compiled)
	if err != nil {
		t.Fatalf("generating from the opened app: %v", err)
	}
	compiled, err := compiler.run(dir, nil)
	if err != nil {
		t.Fatalf("compiling the folder: %v", err)
	}
	if generated != compiled {
		t.Fatal("the manifest generated from the opened app differs from the folder's")
	}
}

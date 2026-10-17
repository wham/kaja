package kaja

import (
	"bytes"
	"encoding/json"
	"flag"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/wham/protoc-go/protoc"
)

var update = flag.Bool("update", false, "rewrite the expected output of every case in tests/")

// TestCases compiles every folder in tests/ and holds what the plugin makes of it
// against the folder's expected/: the manifest, with each module's editor text
// written out as a file of its own so a change reads as a diff of TypeScript.
//
//	go test ./kaja -run TestCases -update
func TestCases(t *testing.T) {
	entries, err := os.ReadDir("../tests")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join("..", "tests", entry.Name())
		t.Run(entry.Name(), func(t *testing.T) {
			t.Parallel()
			got := generateCase(t, dir)
			expected := filepath.Join(dir, "expected")
			if *update {
				writeCase(t, expected, got)
				return
			}
			compareCase(t, expected, got)
		})
	}
}

func generateCase(t *testing.T, dir string) map[string]string {
	var protos []string
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && d.Name() == "expected" {
			return filepath.SkipDir
		}
		if !d.IsDir() && strings.HasSuffix(path, ".proto") {
			rel, err := filepath.Rel(dir, path)
			if err != nil {
				return err
			}
			protos = append(protos, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(protos)

	// A case protoc refuses is a case about the refusal.
	result, err := protoc.New(protoc.WithProtoPaths(dir)).Compile(protos...)
	if err != nil {
		return map[string]string{"error.txt": err.Error() + "\n"}
	}
	files, err := result.RunLibraryPlugin(NewPlugin(), "kaja_manifest")
	if err != nil {
		t.Fatalf("protoc-gen-kaja: %v", err)
	}

	var m manifest
	if err := json.Unmarshal([]byte(files[0].Content), &m); err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, module := range m.Modules {
		got["editor/"+module.Path] = module.EditorText
		module.EditorText = ""
	}
	encoded, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	got["manifest.json"] = string(encoded) + "\n"
	return got
}

func writeCase(t *testing.T, expected string, got map[string]string) {
	if err := os.RemoveAll(expected); err != nil {
		t.Fatal(err)
	}
	for name, content := range got {
		path := filepath.Join(expected, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func compareCase(t *testing.T, expected string, got map[string]string) {
	want := map[string]string{}
	err := filepath.WalkDir(expected, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(expected, path)
		if err != nil {
			return err
		}
		want[filepath.ToSlash(rel)] = string(content)
		return nil
	})
	if err != nil {
		t.Fatalf("reading %s: %v (run with -update to write it)", expected, err)
	}
	for name, content := range got {
		if _, ok := want[name]; !ok {
			t.Errorf("%s is generated but not expected", name)
		} else if content != want[name] {
			t.Errorf("%s differs at:\n%s", name, firstDifference(want[name], content))
		}
	}
	for name := range want {
		if _, ok := got[name]; !ok {
			t.Errorf("%s is expected but not generated", name)
		}
	}
}

// firstDifference is the line the two texts part at, and the lines either side of it.
func firstDifference(want, got string) string {
	wantLines := strings.Split(want, "\n")
	gotLines := strings.Split(got, "\n")
	for i := 0; i < len(wantLines) || i < len(gotLines); i++ {
		if i < len(wantLines) && i < len(gotLines) && wantLines[i] == gotLines[i] {
			continue
		}
		var b bytes.Buffer
		for _, side := range []struct {
			mark  string
			lines []string
		}{{"-", wantLines}, {"+", gotLines}} {
			for j := max(0, i-2); j < min(len(side.lines), i+3); j++ {
				b.WriteString(side.mark + " " + side.lines[j] + "\n")
			}
		}
		return b.String()
	}
	return ""
}

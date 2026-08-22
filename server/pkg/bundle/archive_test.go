package bundle

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTestBundle(t *testing.T) []byte {
	t.Helper()
	buffer := &bytes.Buffer{}
	writer := NewWriter(buffer)
	if err := writer.AddManifest(&Manifest{Name: "whats-on", Title: "What's on"}); err != nil {
		t.Fatal(err)
	}
	if err := writer.Add(ScriptName, []byte("kaja.text('hello');")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Add(AppsDir+"/Theatre/proto/service.proto", []byte("syntax = \"proto3\";")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestWriteAndRead(t *testing.T) {
	content := writeTestBundle(t)

	bundle, err := Read(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if bundle.Manifest.Name != "whats-on" {
		t.Errorf("name = %q", bundle.Manifest.Name)
	}
	if bundle.Manifest.FormatVersion != FormatVersion {
		t.Errorf("format version = %d, want %d", bundle.Manifest.FormatVersion, FormatVersion)
	}
	script, err := bundle.ReadFile(ScriptName)
	if err != nil || !strings.Contains(string(script), "hello") {
		t.Errorf("script = %q, %v", script, err)
	}
}

// A bundle is read the same whether it is a file or the tail of a program, which
// is the whole of what makes an exported app one file.
func TestReadAppendedToAnExecutable(t *testing.T) {
	dir := t.TempDir()
	runner := filepath.Join(dir, "runner")
	// Any prefix will do — the zip's directory is at the end and its offsets are
	// relative to wherever the archive starts.
	if err := os.WriteFile(runner, bytes.Repeat([]byte("MZ\x00\x90runner bytes"), 512), 0o755); err != nil {
		t.Fatal(err)
	}
	bundlePath := filepath.Join(dir, "app.kaja")
	if err := os.WriteFile(bundlePath, writeTestBundle(t), 0o644); err != nil {
		t.Fatal(err)
	}

	out := filepath.Join(dir, "whats-on")
	if err := AppendTo(runner, bundlePath, out); err != nil {
		t.Fatalf("AppendTo: %v", err)
	}

	info, err := os.Stat(out)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Errorf("exported app is not executable: %v", info.Mode())
	}

	bundle, err := Open(out)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer bundle.Close()
	if bundle.Manifest.Title != "What's on" {
		t.Errorf("manifest = %+v", bundle.Manifest)
	}
}

func TestOpenRefusesSomethingElse(t *testing.T) {
	dir := t.TempDir()
	name := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(name, []byte("not a bundle"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(name); err == nil {
		t.Error("want an error")
	}
}

func TestReadRefusesALaterFormat(t *testing.T) {
	buffer := &bytes.Buffer{}
	writer := NewWriter(buffer)
	if err := writer.Add(ManifestName, []byte(`{"formatVersion": 99, "name": "later"}`)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	_, err := Read(bytes.NewReader(buffer.Bytes()), int64(buffer.Len()))
	if err == nil {
		t.Fatal("want an error")
	}
	if !strings.Contains(err.Error(), "99") {
		t.Errorf("the error should name the version, got %v", err)
	}
}

func TestExtract(t *testing.T) {
	content := writeTestBundle(t)
	bundle, err := Read(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	if err := bundle.Extract(AppsDir, dir); err != nil {
		t.Fatalf("Extract: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(dir, "Theatre", "proto", "service.proto"))
	if err != nil {
		t.Fatalf("extracted tree: %v", err)
	}
	if !strings.Contains(string(got), "proto3") {
		t.Errorf("content = %q", got)
	}
	// Nothing outside the prefix comes along.
	if _, err := os.Stat(filepath.Join(dir, ScriptName)); err == nil {
		t.Error("Extract took an entry from outside the prefix")
	}
}

// A bundle arrives from wherever it arrived from, so an entry naming its way out
// of the directory is refused rather than followed.
func TestExtractRefusesAnEscapingEntry(t *testing.T) {
	buffer := &bytes.Buffer{}
	zipWriter := zip.NewWriter(buffer)
	entry, err := zipWriter.Create(ManifestName)
	if err != nil {
		t.Fatal(err)
	}
	entry.Write([]byte(`{"formatVersion": 1, "name": "escape"}`))
	entry, err = zipWriter.Create(AppsDir + "/../../etc/passwd")
	if err != nil {
		t.Fatal(err)
	}
	entry.Write([]byte("nope"))
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}

	bundle, err := Read(bytes.NewReader(buffer.Bytes()), int64(buffer.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if err := bundle.Extract(AppsDir, t.TempDir()); err == nil {
		t.Error("want an error")
	}
}

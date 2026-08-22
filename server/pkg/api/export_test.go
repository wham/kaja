package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/bundle"
	"google.golang.org/protobuf/encoding/protojson"
)

// A folder app is the one app type that is entirely local, so exporting one
// exercises the whole path — open, compile, freeze, stub, bind — without asking
// anything of the network.
func exportWorkspace(t *testing.T, script string) (*ExportResult, *bundle.Bundle) {
	t.Helper()

	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(workspace, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	configuration := `{
	  "apps": [{"name": "Notes", "folder": {"path": "` + filepath.Join(workspace, "notes") + `"}}],
	  "variables": {"TOKEN": "${secret}", "GREETING": "hello"}
	}`
	configurationPath := filepath.Join(workspace, "kaja.json")
	if err := os.WriteFile(configurationPath, []byte(configuration), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "scripts", "notes.ts"), []byte(script), 0o644); err != nil {
		t.Fatal(err)
	}

	service := NewApiService(configurationPath, false, "test", "", nil)
	out := filepath.Join(t.TempDir(), "notes.kaja")
	result, err := service.ExportScript(&ExportRequest{Script: "notes.ts", Out: out})
	if err != nil {
		t.Fatalf("ExportScript: %v", err)
	}

	opened, err := bundle.Open(out)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { opened.Close() })
	return result, opened
}

const notesScript = `import { kaja } from "kaja";
import { Folder } from "Notes/folder";

const files = await Folder.ListFiles({});
kaja.table(["name"], files.files.map((file) => [file.name]));
`

func TestExportScript(t *testing.T) {
	result, opened := exportWorkspace(t, notesScript)

	if result.Manifest.Name != "notes" {
		t.Errorf("name = %q", result.Manifest.Name)
	}
	if len(result.Manifest.Apps) != 1 || result.Manifest.Apps[0].Name != "Notes" {
		t.Fatalf("apps = %+v", result.Manifest.Apps)
	}
	if !result.Manifest.Apps[0].Frozen {
		t.Errorf("a folder app is local, so it should export frozen: %+v", result.Manifest.Apps[0])
	}
	// A script with nothing to approve is worth running on sight.
	if !result.Manifest.RunOnLoad {
		t.Errorf("runOnLoad = false")
	}

	// The imports are resolved once, here, which is what lets the player carry no
	// compiler: each name says which stub module holds it.
	byAlias := map[string]bundle.Import{}
	for _, entry := range result.Manifest.Imports {
		byAlias[entry.Alias] = entry
	}
	if byAlias["kaja"].Module != "kaja" {
		t.Errorf("kaja import = %+v", byAlias["kaja"])
	}
	folder := byAlias["Folder"]
	if folder.Module != "Notes$folder" || folder.ClientModule != "Notes$folder$client" || folder.App != "Notes" {
		t.Errorf("Folder import = %+v", folder)
	}

	// The stub is the generated client code, and the module ids in the manifest
	// are the ones it exports.
	stub, err := opened.ReadFile(bundle.StubName)
	if err != nil {
		t.Fatal(err)
	}
	for _, module := range []string{"Notes$folder", "Notes$folder$client"} {
		if !strings.Contains(string(stub), module) {
			t.Errorf("the stub does not export %q", module)
		}
	}

	// The script travels transpiled, with its imports resolved out of it.
	script, err := opened.ReadFile(bundle.ScriptName)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(script), "import ") {
		t.Errorf("the script still holds an import:\n%s", script)
	}
	if !strings.Contains(string(script), "Folder.ListFiles") {
		t.Errorf("the script lost its body:\n%s", script)
	}

	// The proto surface is in the bundle, where the app's own configuration now
	// says it is.
	if _, err := opened.ReadFile("apps/Notes/proto/folder.proto"); err != nil {
		t.Errorf("the proto surface is not in the bundle: %v", err)
	}
}

// A variable's value is what must not travel. A "${secret}" is a name and an
// environment variable to read it from, and nothing else; a value kaja.json
// writes in the clear is already in the clear.
func TestExportCarriesVariableNamesNotValues(t *testing.T) {
	script := `import { kaja } from "kaja";
import { Folder } from "Notes/folder";
kaja.text(kaja.variables.TOKEN);
await Folder.ListFiles({});
`
	t.Setenv("KAJA_TOKEN", "sk-live-do-not-export-me")
	result, opened := exportWorkspace(t, script)

	if len(result.Manifest.Variables) != 1 {
		t.Fatalf("variables = %+v", result.Manifest.Variables)
	}
	variable := result.Manifest.Variables[0]
	if variable.Name != "TOKEN" || variable.Source != bundle.SourceSecret || variable.Env != "KAJA_TOKEN" {
		t.Errorf("variable = %+v", variable)
	}
	if variable.Value != "" {
		t.Errorf("a secret's value travelled: %q", variable.Value)
	}

	content, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(content), "sk-live-do-not-export-me") {
		t.Error("the resolved value is somewhere in the bundle")
	}

	manifest, err := opened.ReadFile(bundle.ManifestName)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(manifest), "sk-live-do-not-export-me") {
		t.Error("the resolved value is in the manifest")
	}

	// It is worth saying so while the export is still being made, since where it
	// runs is the one place nobody can ask.
	if !strings.Contains(strings.Join(result.Warnings, "\n"), "KAJA_TOKEN") {
		t.Errorf("warnings = %+v", result.Warnings)
	}
}

// A script that holds a call back for approval is a script that writes, and
// running one the moment a page opens would answer the question the block exists
// to ask.
func TestExportLeavesAWritingScriptToBePressed(t *testing.T) {
	script := `import { kaja } from "kaja";
import { Folder } from "Notes/folder";
await kaja.approve(Folder.CreateFile({ name: "note.md", content: "hello" }));
`
	result, _ := exportWorkspace(t, script)
	if result.Manifest.RunOnLoad {
		t.Error("a script holding kaja.approve should not run on load")
	}
}

func TestExportNamesAnAppItCannotFind(t *testing.T) {
	script := `import { Missing } from "Nowhere/service";
Missing.Anything({});
`
	workspace := t.TempDir()
	configurationPath := filepath.Join(workspace, "kaja.json")
	if err := os.WriteFile(configurationPath, []byte(`{"apps": []}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(workspace, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "scripts", "x.ts"), []byte(script), 0o644); err != nil {
		t.Fatal(err)
	}

	service := NewApiService(configurationPath, false, "", "", nil)
	_, err := service.ExportScript(&ExportRequest{Script: "x.ts", Out: filepath.Join(t.TempDir(), "x.kaja")})
	if err == nil {
		t.Fatal("want an error")
	}
	if !strings.Contains(err.Error(), "Nowhere") {
		t.Errorf("the error should name the app, got %v", err)
	}
}

// The runner reads the app back through protojson, so what the exporter writes
// has to be the shape kaja.json is.
func TestExportedConfigurationIsTheAppItCameFrom(t *testing.T) {
	result, _ := exportWorkspace(t, notesScript)

	content, err := json.Marshal(result.Manifest.Apps[0].Configuration)
	if err != nil {
		t.Fatal(err)
	}
	app := &ConfigurationApp{}
	if err := protojson.Unmarshal(content, app); err != nil {
		t.Fatalf("the exported app does not read back: %v", err)
	}
	if app.Name != "Notes" {
		t.Errorf("name = %q", app.Name)
	}
	if appType, _ := flattenApp(app); appType != "folder" {
		t.Errorf("type = %q", appType)
	}
}

// Everything an export writes is named after the script, and the script's name
// arrives from outside — a request field, an argument on a command line. It is
// reduced to a name at the one place it is established, so nothing downstream
// has to be careful about joining it onto a directory.
func TestOneSegment(t *testing.T) {
	for name, want := range map[string]string{
		"movies.ts":               "movies",
		"billing/report.ts":       "report",
		"../../../etc/passwd":     "passwd",
		"..":                      "script",
		".":                       "script",
		"":                        "script",
		"/":                       "script",
		"/absolute/path/thing.ts": "thing",
		"a-night-out.ts":          "a-night-out",
	} {
		if got := oneSegment(name); got != want {
			t.Errorf("oneSegment(%q) = %q, want %q", name, got, want)
		}
	}
}

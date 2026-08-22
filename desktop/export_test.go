package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wham/kaja/v2/pkg/api"
)

// The whole of the button, minus the sentence that asks where the file goes.
// A folder app is local, so this exports and then runs a real app without
// asking anything of the network.
func TestWriteExportedApp(t *testing.T) {
	if !hasRunner() {
		t.Skip("no runner in this build; scripts/desktop builds one into build/runner")
	}

	workspace := t.TempDir()
	for _, dir := range []string{"notes", "scripts"} {
		if err := os.MkdirAll(filepath.Join(workspace, dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(workspace, "notes", "hello.md"), []byte("# hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	configurationPath := filepath.Join(workspace, "kaja.json")
	configuration := `{"apps": [{"name": "Notes", "folder": {"path": "` + filepath.Join(workspace, "notes") + `"}}]}`
	if err := os.WriteFile(configurationPath, []byte(configuration), 0o644); err != nil {
		t.Fatal(err)
	}

	script := `import { kaja } from "kaja";
import { Folder } from "Notes/folder";

const listing = await Folder.ListFolder({ folder: "." });
kaja.table(["name"], listing.files.map((file) => [file]));
`
	if err := os.WriteFile(filepath.Join(workspace, "scripts", "notes.ts"), []byte(script), 0o644); err != nil {
		t.Fatal(err)
	}

	service := api.NewApiService(configurationPath, true, "test", "", nil)
	destination := filepath.Join(t.TempDir(), "notes"+appExtension())

	exported, err := writeExportedApp(service, "notes.ts", destination)
	if err != nil {
		t.Fatalf("writeExportedApp: %v", err)
	}

	if exported.Name != filepath.Base(destination) {
		t.Errorf("name = %q", exported.Name)
	}
	if exported.Platform == "" {
		t.Error("an exported app should say where it runs")
	}
	// A folder app is local, so there is nothing to warn about.
	if len(exported.Warnings) != 0 {
		t.Errorf("warnings = %v", exported.Warnings)
	}

	info, err := os.Stat(destination)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Errorf("the exported app is not executable: %v", info.Mode())
	}
	if info.Size() < 1<<20 {
		t.Errorf("size = %d — that is not a runner with a bundle on it", info.Size())
	}

	// The point of the file: it runs, and what it serves is this script's app.
	assertRuns(t, destination)
}

// assertRuns starts the exported app and reads back what it says it is. It is
// the one check that covers the whole chain at once — the runner found the
// bundle appended to itself, unpacked the app, opened it, and served the player
// the script it was exported from.
func assertRuns(t *testing.T, path string) {
	t.Helper()

	port, err := freePort()
	if err != nil {
		t.Fatal(err)
	}
	address := fmt.Sprintf("127.0.0.1:%d", port)

	command := exec.Command(path, "-listen", address, "-open=false")
	output := &strings.Builder{}
	command.Stdout = output
	command.Stderr = output
	if err := command.Start(); err != nil {
		t.Fatalf("starting the exported app: %v", err)
	}
	t.Cleanup(func() {
		_ = command.Process.Kill()
		_, _ = command.Process.Wait()
	})

	state := map[string]any{}
	deadline := time.Now().Add(60 * time.Second)
	for {
		response, err := http.Get("http://" + address + "/bundle/state.json")
		if err == nil {
			defer response.Body.Close()
			if err := json.NewDecoder(response.Body).Decode(&state); err != nil {
				t.Fatalf("reading the app's state: %v", err)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the exported app never answered on %s:\n%s", address, output.String())
		}
		time.Sleep(200 * time.Millisecond)
	}

	manifest, _ := state["manifest"].(map[string]any)
	if manifest["name"] != "notes" {
		t.Errorf("manifest = %v", manifest)
	}
	apps, _ := state["apps"].([]any)
	if len(apps) != 1 {
		t.Fatalf("apps = %v (logs:\n%s)", apps, output.String())
	}
	app, _ := apps[0].(map[string]any)
	if app["error"] != nil && app["error"] != "" {
		t.Errorf("the app did not open: %v", app["error"])
	}

	// The screen it draws on is in the file too.
	page, err := http.Get("http://" + address + "/")
	if err != nil {
		t.Fatalf("the exported app served no page: %v", err)
	}
	defer page.Body.Close()
	if page.StatusCode != http.StatusOK {
		t.Errorf("page status = %d", page.StatusCode)
	}
}

func freePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

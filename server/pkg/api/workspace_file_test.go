package api

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
)

func TestLoadGetWorkspaceResponse_ConfigFileNotExists(t *testing.T) {
	getWorkspaceResponse := LoadGetWorkspaceResponse("non_existent_config.json")

	if getWorkspaceResponse == nil {
		t.Fatal("expected non-nil response")
	}

	if getWorkspaceResponse.Workspace == nil {
		t.Fatal("expected non-nil workspace")
	}

	if len(getWorkspaceResponse.Workspace.Apps) != 0 {
		t.Errorf("expected empty apps list, got %d apps", len(getWorkspaceResponse.Workspace.Apps))
	}

	foundInfo := false
	for _, log := range getWorkspaceResponse.Logs {
		if log.Level == LogLevel_LEVEL_INFO && log.Message == "Workspace file non_existent_config.json not found." {
			foundInfo = true
			break
		}
	}
	if !foundInfo {
		t.Error("expected to find info log about missing config file")
	}
}

func TestLoadGetWorkspaceResponse_AppsScenario(t *testing.T) {
	configContent := `{
		"apps": [
			{
				"name": "test-app",
				"grpc": {
					"url": "http://localhost:8080",
					"proto_dir": "test-protoDir"
				}
			}
		],
		"pathPrefix": "test-prefix"
	}`

	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(configContent)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	getWorkspaceResponse := LoadGetWorkspaceResponse(tmpfile.Name())

	if getWorkspaceResponse == nil {
		t.Fatal("expected non-nil response")
	}

	if getWorkspaceResponse.Workspace == nil {
		t.Fatal("expected non-nil workspace")
	}

	if len(getWorkspaceResponse.Workspace.Apps) != 1 {
		t.Fatalf("expected 1 app, got %d", len(getWorkspaceResponse.Workspace.Apps))
	}

	app := getWorkspaceResponse.Workspace.Apps[0]
	appType, params := flattenApp(app)
	if app.Name != "test-app" {
		t.Errorf("expected app name 'test-app', got %q", app.Name)
	}
	if appType != "grpc" {
		t.Errorf("expected type 'grpc', got %q", appType)
	}
	if params["url"] != "http://localhost:8080" {
		t.Errorf("expected url 'http://localhost:8080', got %q", params["url"])
	}
	if params["proto_dir"] != "test-protoDir" {
		t.Errorf("expected proto_dir 'test-protoDir', got %q", params["proto_dir"])
	}

	if getWorkspaceResponse.Workspace.PathPrefix != "/test-prefix" {
		t.Errorf("expected path prefix '/test-prefix', got %q", getWorkspaceResponse.Workspace.PathPrefix)
	}
}

// Legacy kaja.json files used a top-level "projects" list of gRPC/Twirp services.
// They must be migrated transparently into the unified "apps" model on load.
func TestLoadGetWorkspaceResponse_MigratesLegacyProjects(t *testing.T) {
	configContent := `{
		"projects": [
			{
				"name": "grpc-quirks",
				"protocol": "RPC_PROTOCOL_GRPC",
				"url": "dns:kaja.tools:443",
				"protoDir": "quirks/proto",
				"headers": {"X-Yolo": "kaja123"}
			},
			{
				"name": "twirp-users",
				"protocol": "RPC_PROTOCOL_TWIRP",
				"url": "https://kaja.tools/users",
				"protoDir": "users/proto"
			},
			{
				"name": "teams",
				"protocol": "RPC_PROTOCOL_GRPC",
				"url": "dns:kaja.tools:443",
				"useReflection": true
			}
		]
	}`

	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte(configContent)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	workspace := LoadGetWorkspaceResponse(tmpfile.Name()).Workspace
	if len(workspace.Apps) != 3 {
		t.Fatalf("expected 3 migrated apps, got %d", len(workspace.Apps))
	}

	grpc := workspace.Apps[0]
	grpcType, grpcParams := flattenApp(grpc)
	if grpc.Name != "grpc-quirks" || grpcType != "grpc" {
		t.Errorf("expected grpc app 'grpc-quirks', got %q/%q", grpc.Name, grpcType)
	}
	if grpcParams["url"] != "dns:kaja.tools:443" || grpcParams["proto_dir"] != "quirks/proto" {
		t.Errorf("unexpected grpc parameters: %v", grpcParams)
	}
	if grpc.GetGrpc().GetHeaders()["X-Yolo"] != "kaja123" {
		t.Errorf("expected migrated headers, got %v", grpc.GetGrpc().GetHeaders())
	}

	twirpType, twirpParams := flattenApp(workspace.Apps[1])
	if twirpType != "twirp" || twirpParams["url"] != "https://kaja.tools/users" {
		t.Errorf("unexpected twirp app: %q %v", twirpType, twirpParams)
	}

	teamsType, teamsParams := flattenApp(workspace.Apps[2])
	if teamsType != "grpc" || teamsParams["reflection"] != "true" {
		t.Errorf("expected reflection grpc app, got %q %v", teamsType, teamsParams)
	}
}

func TestLoadGetWorkspaceResponse_MigratesMarkdownApp(t *testing.T) {
	configContent := `{
		"apps": [
			{"name": "Notes", "markdown": {"folder": "/tmp/notes"}},
			{"name": "grpc-quirks", "grpc": {"url": "dns:kaja.tools:443"}}
		]
	}`

	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte(configContent)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	workspace := LoadGetWorkspaceResponse(tmpfile.Name()).Workspace
	if len(workspace.Apps) != 2 {
		t.Fatalf("expected 2 apps, got %d", len(workspace.Apps))
	}

	folderType, folderParams := flattenApp(workspace.Apps[0])
	if workspace.Apps[0].Name != "Notes" || folderType != "folder" {
		t.Errorf("expected folder app 'Notes', got %q/%q", workspace.Apps[0].Name, folderType)
	}
	if folderParams["path"] != "/tmp/notes" {
		t.Errorf("unexpected folder parameters: %v", folderParams)
	}

	if grpcType, _ := flattenApp(workspace.Apps[1]); grpcType != "grpc" {
		t.Errorf("expected the other app untouched, got %q", grpcType)
	}
}

func TestUpdateWorkspace_DeniedWhenNotAllowed(t *testing.T) {
	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte("{}")); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(tmpfile.Name(), false, "", "", nil)

	_, err = service.UpdateWorkspace(context.Background(), &UpdateWorkspaceRequest{
		Workspace: &Workspace{},
	})
	if err == nil {
		t.Fatal("expected error when canUpdateWorkspace is false")
	}

	// The file must be left untouched.
	content, readErr := os.ReadFile(tmpfile.Name())
	if readErr != nil {
		t.Fatalf("failed to read config file: %v", readErr)
	}
	if string(content) != "{}" {
		t.Errorf("expected config file to be unchanged, got %q", string(content))
	}
}

func TestUpdateWorkspace_AllowedWhenEnabled(t *testing.T) {
	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte("{}")); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(tmpfile.Name(), true, "", "", nil)

	_, err = service.UpdateWorkspace(context.Background(), &UpdateWorkspaceRequest{
		Workspace: &Workspace{
			Apps: []*WorkspaceApp{
				{Name: "test-app", App: &WorkspaceApp_Grpc{Grpc: &GrpcApp{Url: "http://localhost:8080"}}},
			},
		},
	})
	if err != nil {
		t.Fatalf("expected no error when canUpdateWorkspace is true, got %v", err)
	}

	getWorkspaceResponse := LoadGetWorkspaceResponse(tmpfile.Name())
	if len(getWorkspaceResponse.Workspace.Apps) != 1 {
		t.Fatalf("expected 1 saved app, got %d", len(getWorkspaceResponse.Workspace.Apps))
	}
}

// Earlier versions wrote a "system" block into every file they saved, so
// workspaces in the wild still carry one. It must be discarded without taking
// the rest of the file with it, and it must never unlock a server started without
// --editable.
func TestLegacySystemBlockIsDiscarded(t *testing.T) {
	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	legacy := `{"system":{"canUpdateWorkspace":true},"apps":[{"name":"test-app","grpc":{"url":"http://localhost:8080"}}]}`
	if _, err := tmpfile.Write([]byte(legacy)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(tmpfile.Name(), false, "", "", nil)

	response, err := service.GetWorkspace(context.Background(), &GetWorkspaceRequest{})
	if err != nil {
		t.Fatalf("failed to get workspace: %v", err)
	}
	if len(response.Workspace.Apps) != 1 {
		t.Fatalf("expected the rest of the file to survive the system block, got %d apps", len(response.Workspace.Apps))
	}
	if response.Runtime.CanUpdateWorkspace {
		t.Error("expected the file's system block to be ignored, got canUpdateWorkspace true")
	}

	if _, err := service.UpdateWorkspace(context.Background(), &UpdateWorkspaceRequest{
		Workspace: &Workspace{},
	}); err == nil {
		t.Fatal("expected the update to be denied")
	}
}

func TestUpdateWorkspace_PersistsVariables(t *testing.T) {
	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte("{}")); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(tmpfile.Name(), true, "", "", nil)

	_, err = service.UpdateWorkspace(context.Background(), &UpdateWorkspaceRequest{
		Workspace: &Workspace{
			Variables: map[string]string{"API_BASE_URL": "https://api.example.com", "TEAM_ID": "42"},
		},
	})
	if err != nil {
		t.Fatalf("expected no error saving variables, got %v", err)
	}

	// GetWorkspace must return the persisted variables to the UI (it rebuilds
	// the Workspace field by field, so a missing field is silently dropped).
	getResponse, err := service.GetWorkspace(context.Background(), &GetWorkspaceRequest{})
	if err != nil {
		t.Fatalf("GetWorkspace failed: %v", err)
	}
	workspace := getResponse.Workspace
	if workspace.Variables["API_BASE_URL"] != "https://api.example.com" {
		t.Errorf("expected API_BASE_URL from GetWorkspace, got %q", workspace.Variables["API_BASE_URL"])
	}
	if workspace.Variables["TEAM_ID"] != "42" {
		t.Errorf("expected TEAM_ID from GetWorkspace, got %q", workspace.Variables["TEAM_ID"])
	}
}

func TestSaveWorkspace_WritesOneLayout(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kaja.json")
	workspace := &Workspace{
		Apps: []*WorkspaceApp{{
			Name: "theatre",
			App:  &WorkspaceApp_Openapi{Openapi: &OpenApiApp{SpecUrl: "https://theatre.example.com/openapi.yaml"}},
		}},
		Variables: map[string]string{"TOKEN": "${secret}"},
	}

	if err := SaveWorkspace(path, workspace); err != nil {
		t.Fatalf("save: %v", err)
	}
	written, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	// protojson varies its own whitespace, so what is asserted here is the layout
	// a reader of the file sees: two-space indentation, one space after a colon.
	want := `{
  "apps": [
    {
      "name": "theatre",
      "openapi": {
        "spec_url": "https://theatre.example.com/openapi.yaml"
      }
    }
  ],
  "variables": {
    "TOKEN": "${secret}"
  }
}
`
	if string(written) != want {
		t.Errorf("workspace written as\n%s\nwant\n%s", written, want)
	}

	// Saving the same workspace again is the same file, which is what makes a
	// diff of one say only what changed.
	if err := SaveWorkspace(path, workspace); err != nil {
		t.Fatalf("save again: %v", err)
	}
	again, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read again: %v", err)
	}
	if string(again) != string(written) {
		t.Errorf("saving twice wrote two files:\n%s\n%s", written, again)
	}
}

func TestExpandVariables(t *testing.T) {
	variables := map[string]string{"HOST": "api.example.com", "TOKEN": "secret", "V_1": "one"}

	cases := []struct {
		value    string
		expected string
	}{
		{"https://${HOST}/twirp", "https://api.example.com/twirp"},
		{"${TOKEN}", "secret"},
		{"Bearer ${TOKEN}", "Bearer secret"},
		{"${HOST}/${V_1}", "api.example.com/one"},
		{"${UNDEFINED}", "${UNDEFINED}"},
		{"no references", "no references"},
		{"${not-a-name}", "${not-a-name}"},
		{"$HOST and {HOST}", "$HOST and {HOST}"},
		{"", ""},
	}
	for _, c := range cases {
		if got := expandVariables(c.value, variables); got != c.expected {
			t.Errorf("expandVariables(%q) = %q, expected %q", c.value, got, c.expected)
		}
	}
}

func TestOpenApp_ExpandsVariables(t *testing.T) {
	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	configContent := `{"variables": {"KAJA_HOST": "kaja.tools"}}`
	if _, err := tmpfile.Write([]byte(configContent)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(tmpfile.Name(), true, "", "", nil)

	response, err := service.OpenApp(context.Background(), &OpenAppRequest{
		App: &WorkspaceApp{
			Name: "quirks",
			App:  &WorkspaceApp_Grpc{Grpc: &GrpcApp{Url: "dns:${KAJA_HOST}:443", ProtoDir: "quirks/proto"}},
		},
	})
	if err != nil {
		t.Fatalf("OpenApp failed: %v", err)
	}
	if response.Status != OpenStatus_OPEN_STATUS_OK {
		t.Fatalf("expected OK status, got %v: %v", response.Status, response.Logs)
	}
	// The address is the app's own and never leaves this process, so the logs of the
	// open are where an expansion can be seen at all.
	if !logged(response.Logs, "dns:kaja.tools:443") {
		t.Errorf("expected the expanded address in the logs, got %v", response.Logs)
	}
}

func TestOpenApp_LogsUnresolvedVariableReference(t *testing.T) {
	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte("{}")); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(tmpfile.Name(), true, "", "", nil)

	response, err := service.OpenApp(context.Background(), &OpenAppRequest{
		App: &WorkspaceApp{
			Name: "quirks",
			App:  &WorkspaceApp_Grpc{Grpc: &GrpcApp{Url: "dns:${MISSING}:443", ProtoDir: "quirks/proto"}},
		},
	})
	if err != nil {
		t.Fatalf("OpenApp failed: %v", err)
	}

	// The reference is left as-is and the logs call it out.
	if !logged(response.Logs, "dns:${MISSING}:443") {
		t.Errorf("expected the unresolved reference to pass through, got %v", response.Logs)
	}
	found := false
	for _, log := range response.Logs {
		if strings.Contains(log.Message, "${MISSING}") {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected a log about the unresolved ${MISSING} reference, got %v", response.Logs)
	}
}

func TestLoadGetWorkspaceResponse_PathPrefixNormalization(t *testing.T) {
	configContent := `{
		"projects": [],
		"pathPrefix": "demo"
	}`

	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(configContent)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	getWorkspaceResponse := LoadGetWorkspaceResponse(tmpfile.Name())

	if getWorkspaceResponse == nil {
		t.Fatal("expected non-nil response")
	}

	if getWorkspaceResponse.Workspace == nil {
		t.Fatal("expected non-nil workspace")
	}

	if getWorkspaceResponse.Workspace.PathPrefix != "/demo" {
		t.Errorf("expected normalized path prefix '/demo', got %q", getWorkspaceResponse.Workspace.PathPrefix)
	}

	foundDebug := false
	for _, log := range getWorkspaceResponse.Logs {
		if log.Level == LogLevel_LEVEL_DEBUG && log.Message == "pathPrefix normalized from \"/demo\" to \"/demo\"" {
			foundDebug = true
			break
		}
	}
	if !foundDebug {
		t.Error("expected to find debug log about path prefix normalization")
	}
}

// logged reports whether any line of an open's logs contains text.
func logged(logs []*Log, text string) bool {
	for _, log := range logs {
		if strings.Contains(log.Message, text) {
			return true
		}
	}
	return false
}

// workspaceStream is the stream a watcher writes into, keeping the last messages
// sent. A send never blocks: the test decides how many changes it waits for, and the
// watcher's own beat decides how many it reports.
type workspaceStream struct {
	grpc.ServerStream
	ctx  context.Context
	sent chan *GetWorkspaceResponse
}

func (s *workspaceStream) Context() context.Context { return s.ctx }

func (s *workspaceStream) Send(response *GetWorkspaceResponse) error {
	select {
	case s.sent <- response:
	default:
	}
	return nil
}

// A watcher is answered with the file rather than with a notice that something
// happened, so nothing is fetched after being told - and the stream says nothing while
// the file is as it was, since whoever opened it has just read that.
func TestWatchWorkspaceSendsTheChangedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kaja.json")
	if err := os.WriteFile(path, []byte(`{"apps":[]}`), 0644); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(path, true, "", "", nil)
	defer service.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream := &workspaceStream{ctx: ctx, sent: make(chan *GetWorkspaceResponse, 1)}
	watch := make(chan error, 1)
	go func() { watch <- service.WatchWorkspace(&WatchWorkspaceRequest{}, stream) }()

	time.Sleep(300 * time.Millisecond)
	if len(stream.sent) != 0 {
		t.Fatal("the stream opened with a message, but nothing had changed")
	}

	// Written on a beat rather than once: the watcher reads the modification time it
	// starts from in a goroutine of its own, and a write that lands before that read is
	// not a change to it.
	changed := []byte(`{"apps":[{"name":"shows","grpc":{"url":"http://localhost:8080"}}]}`)
	write := time.NewTicker(200 * time.Millisecond)
	defer write.Stop()
	deadline := time.After(15 * time.Second)

	for {
		select {
		case response := <-stream.sent:
			if len(response.Workspace.Apps) != 1 {
				t.Fatalf("got %d apps, want the file as it now stands", len(response.Workspace.Apps))
			}
			if response.Runtime == nil || !response.Runtime.CanUpdateWorkspace {
				t.Error("the message carries no runtime, which is what GetWorkspace answers with")
			}
			cancel()
			if err := <-watch; err != nil {
				t.Errorf("watch ended with %v, want nil when the caller went away", err)
			}
			return
		case <-write.C:
			if err := os.WriteFile(path, changed, 0644); err != nil {
				t.Fatalf("failed to write config file: %v", err)
			}
		case <-deadline:
			t.Fatal("the change was never reported")
		}
	}
}

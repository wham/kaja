package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/mcp"
)

const token = "0123456789abcdef0123456789abcdef"

// fakeScripts is a scripts folder held in memory, keyed by name. It stands in for
// both answers a workspace gives: writable is one this kaja owns, and the zero value
// is one it only serves.
type fakeScripts struct {
	files    map[string]string
	writable bool
}

const scriptsRoot = "/w/scripts/"

func (f *fakeScripts) List() ([]mcp.ScriptInfo, error) {
	scripts := make([]mcp.ScriptInfo, 0, len(f.files))
	for name := range f.files {
		scripts = append(scripts, mcp.ScriptInfo{Path: scriptsRoot + name, Name: name})
	}
	return scripts, nil
}

func (f *fakeScripts) Read(path string) (mcp.ScriptInfo, error) {
	name := strings.TrimPrefix(path, scriptsRoot)
	content, ok := f.files[name]
	if !ok {
		return mcp.ScriptInfo{}, errors.New("no script " + path)
	}
	return mcp.ScriptInfo{Path: scriptsRoot + name, Name: name, Content: content}, nil
}

func (f *fakeScripts) Write(path, content string) (ScriptChange, error) {
	if !f.writable {
		return ScriptChange{}, api.ErrScriptsReadOnly
	}
	name := strings.TrimPrefix(path, scriptsRoot)
	f.files[name] = content
	return ScriptChange{Action: "write", Path: scriptsRoot + name, Content: content}, nil
}

func (f *fakeScripts) Create(name, content string) (ScriptChange, error) {
	if !f.writable {
		return ScriptChange{}, api.ErrScriptsReadOnly
	}
	f.files[name] = content
	return ScriptChange{Action: "create", Path: scriptsRoot + name, Name: name, Content: content}, nil
}

func (f *fakeScripts) Rename(path, newName string) (ScriptChange, error) {
	if !f.writable {
		return ScriptChange{}, api.ErrScriptsReadOnly
	}
	name := strings.TrimPrefix(path, scriptsRoot)
	f.files[newName] = f.files[name]
	delete(f.files, name)
	return ScriptChange{Action: "rename", OldPath: scriptsRoot + name, Path: scriptsRoot + newName, Name: newName}, nil
}

func (f *fakeScripts) Delete(path string) (ScriptChange, error) {
	if !f.writable {
		return ScriptChange{}, api.ErrScriptsReadOnly
	}
	name := strings.TrimPrefix(path, scriptsRoot)
	delete(f.files, name)
	return ScriptChange{Action: "delete", Path: scriptsRoot + name}, nil
}

func (f *fakeScripts) CanWrite() bool { return f.writable }

func newRegistry() *Registry {
	return NewRegistry(&fakeScripts{files: map[string]string{"seat-map.ts": "// seats"}}, Streamed)
}

// newOwnedRegistry is the desktop's half: a process that owns the workspace it opened,
// answering an agent with nothing in front of it.
func newOwnedRegistry() *Registry {
	return NewRegistry(&fakeScripts{files: map[string]string{"seat-map.ts": "// seats"}, writable: true}, Direct)
}

// next reads the next message a window is sent, failing rather than hanging.
func next(t *testing.T, stream *Stream) Message {
	t.Helper()
	select {
	case message := <-stream.Messages():
		return message
	case <-time.After(2 * time.Second):
		t.Fatal("no message reached the window")
		return Message{}
	}
}

// drain reads until a message of the given type arrives, stepping over the
// duty and activity chatter a window also receives.
func drain(t *testing.T, stream *Stream, kind string) Message {
	t.Helper()
	for i := 0; i < 10; i++ {
		if message := next(t, stream); message.Type == kind {
			return message
		}
	}
	t.Fatalf("no %q message reached the window", kind)
	return Message{}
}

func call(t *testing.T, registry *Registry, method string, params any) map[string]any {
	t.Helper()
	body := map[string]any{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		body["params"] = params
	}
	encoded, _ := json.Marshal(body)
	request := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(encoded))
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	registry.ServeMCP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("%s: status = %d, body = %s", method, recorder.Code, recorder.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("%s: decode: %v (%s)", method, err, recorder.Body.String())
	}
	return response
}

// toolText is the text a tool answered with, and whether it was a failure.
func toolText(t *testing.T, response map[string]any) (string, bool) {
	t.Helper()
	result, ok := response["result"].(map[string]any)
	if !ok {
		t.Fatalf("no result in %v", response)
	}
	content, ok := result["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatalf("no content in %v", result)
	}
	first, _ := content[0].(map[string]any)
	text, _ := first["text"].(string)
	isError, _ := result["isError"].(bool)
	return text, isError
}

// A token is the address of a browser, so one no window has attached with is not
// a session at all — there is nothing for it to name.
func TestAnUnattachedTokenIsNotASession(t *testing.T) {
	registry := newRegistry()
	request := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`))
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	registry.ServeMCP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a token nothing is attached under, got %d", recorder.Code)
	}
}

func TestATokenMustLookLikeOne(t *testing.T) {
	registry := newRegistry()
	for _, bad := range []string{"", "short", strings.Repeat("x", 200), "has spaces in it and is long enough"} {
		if _, err := registry.Attach(bad); err == nil {
			t.Errorf("expected %q to be refused", bad)
		}
	}
}

// The window is where a script runs, so with none attached run_script says so
// rather than waiting out a timeout the agent can do nothing with.
func TestRunWithNoWindowSaysSo(t *testing.T) {
	registry := newRegistry()
	stream, err := registry.Attach(token)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	stream.Detach()

	text, isError := toolText(t, call(t, registry, "tools/call", map[string]any{
		"name":      "run_script",
		"arguments": map[string]string{"code": "1 + 1"},
	}))
	if !isError {
		t.Error("expected a tool failure")
	}
	if !strings.Contains(text, "no Kaja window is attached") {
		t.Errorf("expected the sentence that says what to do, got %q", text)
	}
}

// A run is forwarded to the window and its answer forwarded back: the server is
// a switchboard, and this is the whole of what it switches.
func TestARunIsForwardedToTheWindow(t *testing.T) {
	registry := newRegistry()
	stream, err := registry.Attach(token)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	defer stream.Detach()

	session, _ := registry.Session(token)
	go func() {
		message := drain(t, stream, "run")
		session.Result(message.RunID, mcp.RunResult{Console: []string{"[INFO] 2 seats"}})
	}()

	text, isError := toolText(t, call(t, registry, "tools/call", map[string]any{
		"name":      "run_script",
		"arguments": map[string]string{"code": "kaja.text('hi')"},
	}))
	if isError {
		t.Fatalf("expected the run to be reported, got a failure: %s", text)
	}
	if !strings.Contains(text, "2 seats") {
		t.Errorf("expected the window's console in the report, got %q", text)
	}
}

// The server owns the disk, so a saved script is read here and the window is
// handed source — but the path still travels, because that is what the run lands
// under in the console.
func TestASavedScriptIsReadByTheServer(t *testing.T) {
	registry := newRegistry()
	stream, err := registry.Attach(token)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	defer stream.Detach()

	session, _ := registry.Session(token)
	sent := make(chan Message, 1)
	go func() {
		message := drain(t, stream, "run")
		sent <- message
		session.Result(message.RunID, mcp.RunResult{})
	}()

	call(t, registry, "tools/call", map[string]any{
		"name":      "run_script",
		"arguments": map[string]string{"path": "/w/scripts/seat-map.ts"},
	})

	message := <-sent
	if message.Code != "// seats" {
		t.Errorf("expected the file's contents to reach the window, got %q", message.Code)
	}
	if message.Path != "/w/scripts/seat-map.ts" {
		t.Errorf("expected the path to travel with it, got %q", message.Path)
	}
}

// The console of a run is in memory in the window that ran it, so a run must
// land in the window being looked at.
func TestTheMostRecentlyFocusedWindowIsOnDuty(t *testing.T) {
	registry := newRegistry()
	first, _ := registry.Attach(token)
	defer first.Detach()
	second, _ := registry.Attach(token)
	defer second.Detach()

	session, _ := registry.Session(token)
	session.Focus(first.ID)

	go func() {
		message := drain(t, first, "run")
		session.Result(message.RunID, mcp.RunResult{Console: []string{"first"}})
	}()

	text, _ := toolText(t, call(t, registry, "tools/call", map[string]any{
		"name":      "run_script",
		"arguments": map[string]string{"code": "1"},
	}))
	if !strings.Contains(text, "first") {
		t.Errorf("expected the focused window to answer, got %q", text)
	}
}

// A stream drops constantly — a laptop sleeps, a proxy restarts. The run waiting
// on it must fail then and there rather than wait out the two minutes.
func TestAWindowClosingFailsItsRun(t *testing.T) {
	registry := newRegistry()
	stream, err := registry.Attach(token)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	session, _ := registry.Session(token)

	go func() {
		drain(t, stream, "run")
		stream.Detach()
	}()

	done := make(chan error, 1)
	go func() {
		_, err := session.Run(context.Background(), "", "1", "Claude Code")
		done <- err
	}()

	select {
	case err := <-done:
		if !errors.Is(err, ErrWindowClosed) {
			t.Errorf("expected the run to fail with the window, got %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the run did not fail when its window went away")
	}
}

// Discovery is the half that does not need a live window, so it keeps answering
// across a reload — only run_script actually needs one.
func TestTheCatalogSurvivesTheWindow(t *testing.T) {
	registry := newRegistry()
	stream, err := registry.Attach(token)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	session, _ := registry.Session(token)
	session.SetCatalog(mcp.Catalog{Apps: []mcp.CatalogApp{{
		Name: "seating",
		Type: "grpc",
		Services: []mcp.CatalogService{{
			Name:       "Seating",
			ImportPath: "seating/proto/seating",
			Methods:    []mcp.CatalogMethod{{Name: "GetSeatMap", Signature: "GetSeatMap(input: GetSeatMapRequest): Promise<SeatMap>"}},
		}},
	}}})
	stream.Detach()

	text, isError := toolText(t, call(t, registry, "tools/call", map[string]any{"name": "list_services"}))
	if isError {
		t.Fatalf("expected the catalog to answer, got a failure: %s", text)
	}
	if !strings.Contains(text, "GetSeatMap") {
		t.Errorf("expected the catalog the window pushed, got %q", text)
	}
}

// Disconnect is what answers "I pasted that token during a screenshare", so it
// has to take effect now rather than when the session would have expired.
func TestDisconnectingForgetsTheToken(t *testing.T) {
	registry := newRegistry()
	stream, err := registry.Attach(token)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	session, _ := registry.Session(token)
	session.SetCatalog(mcp.Catalog{Apps: []mcp.CatalogApp{{Name: "seating"}}})
	stream.Detach()

	request := httptest.NewRequest(http.MethodPost, "/agent-session/detach", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	registry.ServeDetach(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("detach: status = %d", recorder.Code)
	}

	// Not even discovery, which is what would otherwise go on answering out of
	// the catalog the session was still holding.
	mcpRequest := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	mcpRequest.Header.Set("Authorization", "Bearer "+token)
	mcpRecorder := httptest.NewRecorder()
	registry.ServeMCP(mcpRecorder, mcpRequest)
	if mcpRecorder.Code != http.StatusUnauthorized {
		t.Errorf("expected the token to name nothing after a disconnect, got %d", mcpRecorder.Code)
	}
}

// A workspace this kaja does not own has no verbs that write it, so the tools
// that write a file are absent rather than offered and then refused.
func TestNoToolWritesAFile(t *testing.T) {
	registry := newRegistry()
	stream, err := registry.Attach(token)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	defer stream.Detach()

	response := call(t, registry, "tools/list", nil)
	result, _ := response["result"].(map[string]any)
	tools, _ := result["tools"].([]any)
	names := map[string]bool{}
	for _, tool := range tools {
		entry, _ := tool.(map[string]any)
		name, _ := entry["name"].(string)
		names[name] = true
	}
	for _, write := range []string{"write_script", "create_script", "rename_script", "delete_script"} {
		if names[write] {
			t.Errorf("%s is listed on a workspace nothing may write", write)
		}
	}
	for _, read := range []string{"list_scripts", "read_script", "run_script", "list_services"} {
		if !names[read] {
			t.Errorf("%s should still be listed", read)
		}
	}

	text, isError := toolText(t, call(t, registry, "tools/call", map[string]any{
		"name":      "create_script",
		"arguments": map[string]string{"name": "x", "content": "1"},
	}))
	if !isError || !strings.Contains(text, "does not own") {
		t.Errorf("expected the refusal to say why, got %q", text)
	}
}

// The plug in the sidebar is the one thing that reports an agent working in a
// window nobody is watching, so every window of the browser hears about it.
func TestActivityReachesEveryWindow(t *testing.T) {
	registry := newRegistry()
	first, _ := registry.Attach(token)
	defer first.Detach()
	second, _ := registry.Attach(token)
	defer second.Detach()

	call(t, registry, "tools/list", nil)

	for _, stream := range []*Stream{first, second} {
		message := drain(t, stream, "activity")
		if message.InFlight != 1 {
			t.Errorf("expected the request to be reported as in flight, got %d", message.InFlight)
		}
	}
}

// A ping is a keepalive rather than use, so it does not light the plug.
func TestPingIsNotActivity(t *testing.T) {
	registry := newRegistry()
	stream, _ := registry.Attach(token)
	defer stream.Detach()
	drain(t, stream, "duty")

	call(t, registry, "ping", nil)

	select {
	case message := <-stream.Messages():
		if message.Type == "activity" {
			t.Error("a ping lit the plug")
		}
	case <-time.After(100 * time.Millisecond):
	}
}

// The stream is held open by the window; the handler writes what the session
// sends down it, starting with the window's own id.
func TestAttachStreamsTheWindowsIdentity(t *testing.T) {
	registry := newRegistry()
	request := httptest.NewRequest(http.MethodPost, "/agent-session/attach", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	ctx, cancel := context.WithCancel(request.Context())
	request = request.WithContext(ctx)
	recorder := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		registry.ServeAttach(recorder, request)
		close(done)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && !strings.Contains(recorder.Body.String(), "hello") {
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done

	if !strings.Contains(recorder.Body.String(), `"type":"hello"`) {
		t.Errorf("expected the window to be told its id, got %q", recorder.Body.String())
	}
}

// A file an agent wrote is a file nobody in the window wrote, so every window is told
// down the same stream a run goes down. This is what the desktop's Wails event was.
func TestAWriteReachesEveryWindow(t *testing.T) {
	registry := newOwnedRegistry()
	first, err := registry.Attach(token)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	defer first.Detach()
	second, _ := registry.Attach(token)
	defer second.Detach()

	call(t, registry, "tools/call", map[string]any{
		"name":      "create_script",
		"arguments": map[string]string{"name": "usage.ts", "content": "// usage"},
	})

	for _, stream := range []*Stream{first, second} {
		message := drain(t, stream, "scripts")
		if message.Change == nil {
			t.Fatal("a scripts message reached a window with nothing in it")
		}
		if message.Change.Action != "create" || message.Change.Path != "/w/scripts/usage.ts" {
			t.Errorf("change = %+v", *message.Change)
		}
		// The content travels so a window can tell the agent's own draft being saved.
		if message.Change.Content != "// usage" {
			t.Errorf("expected the content to travel with a create, got %q", message.Change.Content)
		}
	}
}

// The desktop opens its session on the token it persists, so an agent pointed at that
// token before the window has offered itself is answered rather than told the token is
// wrong. The window then joins that same session.
func TestAProcessMayOpenItsOwnSession(t *testing.T) {
	registry := newOwnedRegistry()
	opened, err := registry.Open(token)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if opened.Attached() {
		t.Error("a session opened by the process has no window yet")
	}

	// Discovery answers with no window; only a run needs one.
	call(t, registry, "tools/list", nil)

	stream, err := registry.Attach(token)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	defer stream.Detach()
	if session, _ := registry.Session(token); session != opened {
		t.Error("the window opened a second session rather than joining the one that was there")
	}
}

// Every door is registered in one place, so the desktop's webview reaches the same
// switchboard a browser does.
func TestMountRegistersTheDoors(t *testing.T) {
	mux := http.NewServeMux()
	Mount(mux, newRegistry())
	for _, path := range []string{"/agent-session/detach", "/agent-session/focus", "/agent-session/catalog", "/agent-session/result", "/mcp"} {
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{}"))
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, request)
		// No token, so every one of them refuses rather than falling through to a 404.
		if recorder.Code != http.StatusUnauthorized {
			t.Errorf("POST %s = %d, want 401", path, recorder.Code)
		}
	}
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/agent-session", nil))
	if recorder.Code != http.StatusOK {
		t.Errorf("GET /agent-session = %d, want 200", recorder.Code)
	}
}

package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeBridge struct {
	scripts  map[string]string // path -> content
	catalog  Catalog
	lastRun  string
	runErr   error
	runValue RunResult
}

func newFakeBridge() *fakeBridge {
	return &fakeBridge{
		scripts: map[string]string{"/s/hello.ts": "console.log('hi')"},
		catalog: Catalog{
			Apps: []CatalogApp{{
				Name: "users",
				Services: []CatalogService{{
					Name:       "Users",
					ImportPath: "users/proto/v1/users",
					Methods:    []CatalogMethod{{Name: "GetUser", InputType: "GetUserRequest", OutputType: "User"}},
				}},
			}},
			Sources: []CatalogSource{{Path: "users/proto/v1/users.ts", Content: "export interface User {}"}},
		},
	}
}

func (f *fakeBridge) ListScripts() ([]ScriptInfo, error) {
	out := []ScriptInfo{}
	for p := range f.scripts {
		out = append(out, ScriptInfo{Path: p, Name: p})
	}
	return out, nil
}
func (f *fakeBridge) ReadScript(path string) (string, error) {
	c, ok := f.scripts[path]
	if !ok {
		return "", &notFound{path}
	}
	return c, nil
}
func (f *fakeBridge) WriteScript(path, content string) error { f.scripts[path] = content; return nil }
func (f *fakeBridge) CreateScript(name, content string) (ScriptInfo, error) {
	path := "/s/" + name
	f.scripts[path] = content
	return ScriptInfo{Path: path, Name: name, Content: content}, nil
}
func (f *fakeBridge) RenameScript(path, newName string) (ScriptInfo, error) {
	c := f.scripts[path]
	delete(f.scripts, path)
	np := "/s/" + newName
	f.scripts[np] = c
	return ScriptInfo{Path: np, Name: newName, Content: c}, nil
}
func (f *fakeBridge) DeleteScript(path string) error { delete(f.scripts, path); return nil }
func (f *fakeBridge) RunScript(_ context.Context, path, code string) (RunResult, error) {
	if path != "" {
		f.lastRun = path
	} else {
		f.lastRun = code
	}
	return f.runValue, f.runErr
}
func (f *fakeBridge) Catalog() Catalog { return f.catalog }

type notFound struct{ path string }

func (e *notFound) Error() string { return "not found: " + e.path }

const token = "secret-token"

func call(t *testing.T, srv *Server, method string, params interface{}) rpcResponse {
	t.Helper()
	body := map[string]interface{}{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		body["params"] = params
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s: status = %d, body = %s", method, rec.Code, rec.Body.String())
	}
	var resp rpcResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("%s: decode response: %v (%s)", method, err, rec.Body.String())
	}
	return resp
}

func TestUnauthorized(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`))
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}

	// Wrong token is also rejected.
	req = httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`))
	req.Header.Set("Authorization", "Bearer nope")
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token status = %d, want 401", rec.Code)
	}
}

func TestInitialize(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	resp := call(t, srv, "initialize", nil)
	if resp.Error != nil {
		t.Fatalf("error: %+v", resp.Error)
	}
	result := resp.Result.(map[string]interface{})
	if result["protocolVersion"] != protocolVersion {
		t.Fatalf("protocolVersion = %v", result["protocolVersion"])
	}
	if instr, _ := result["instructions"].(string); !strings.Contains(instr, "kaja") {
		t.Fatalf("instructions missing guide text")
	}
}

func TestNotificationGetsNoBody(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","method":"notifications/initialized"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("expected empty body, got %q", rec.Body.String())
	}
}

func TestToolsList(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	resp := call(t, srv, "tools/list", nil)
	tools := resp.Result.(map[string]interface{})["tools"].([]interface{})
	want := map[string]bool{
		"list_services": false, "list_scripts": false, "read_script": false,
		"write_script": false, "create_script": false, "rename_script": false,
		"delete_script": false, "run_script": false,
	}
	for _, tool := range tools {
		name := tool.(map[string]interface{})["name"].(string)
		if _, ok := want[name]; ok {
			want[name] = true
		}
	}
	for name, seen := range want {
		if !seen {
			t.Errorf("tool %q missing from tools/list", name)
		}
	}
}

// toolText pulls the text content out of a tools/call result.
func toolText(t *testing.T, resp rpcResponse) string {
	t.Helper()
	if resp.Error != nil {
		t.Fatalf("rpc error: %+v", resp.Error)
	}
	content := resp.Result.(map[string]interface{})["content"].([]interface{})
	return content[0].(map[string]interface{})["text"].(string)
}

func TestCallTool_CRUDAndRun(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token)

	// create
	resp := call(t, srv, "tools/call", map[string]interface{}{
		"name":      "create_script",
		"arguments": map[string]string{"name": "new", "content": "x"},
	})
	if !strings.Contains(toolText(t, resp), "new.ts") && !strings.Contains(toolText(t, resp), "/s/new") {
		t.Fatalf("create result = %s", toolText(t, resp))
	}

	// list_services surfaces the catalog
	resp = call(t, srv, "tools/call", map[string]interface{}{"name": "list_services"})
	if !strings.Contains(toolText(t, resp), "GetUser") {
		t.Fatalf("list_services missing method: %s", toolText(t, resp))
	}

	// run_script routes the path to the bridge
	bridge.runValue = RunResult{Console: []string{"hi"}}
	resp = call(t, srv, "tools/call", map[string]interface{}{
		"name":      "run_script",
		"arguments": map[string]string{"path": "/s/hello.ts"},
	})
	if bridge.lastRun != "/s/hello.ts" {
		t.Fatalf("run did not reach bridge, lastRun = %q", bridge.lastRun)
	}
	if !strings.Contains(toolText(t, resp), "hi") {
		t.Fatalf("run result missing console: %s", toolText(t, resp))
	}

	// run with neither path nor code is a tool error
	resp = call(t, srv, "tools/call", map[string]interface{}{"name": "run_script"})
	if isErr, _ := resp.Result.(map[string]interface{})["isError"].(bool); !isErr {
		t.Fatalf("expected isError for empty run_script")
	}
}

func TestResources(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	resp := call(t, srv, "resources/list", nil)
	resources := resp.Result.(map[string]interface{})["resources"].([]interface{})
	uris := map[string]bool{}
	for _, r := range resources {
		uris[r.(map[string]interface{})["uri"].(string)] = true
	}
	if !uris[guideURI] || !uris[servicesURI] {
		t.Fatalf("missing core resources: %v", uris)
	}
	if !uris[stubScheme+"users/proto/v1/users.ts"] {
		t.Fatalf("missing stub resource: %v", uris)
	}

	resp = call(t, srv, "resources/read", map[string]string{"uri": guideURI})
	contents := resp.Result.(map[string]interface{})["contents"].([]interface{})
	if !strings.Contains(contents[0].(map[string]interface{})["text"].(string), "kaja") {
		t.Fatalf("guide read missing text")
	}
}

func TestUnknownMethod(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	resp := call(t, srv, "bogus/method", nil)
	if resp.Error == nil || resp.Error.Code != codeMethodNotFound {
		t.Fatalf("expected method-not-found, got %+v", resp.Error)
	}
}

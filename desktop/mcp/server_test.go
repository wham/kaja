package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"
)

type fakeBridge struct {
	scripts  map[string]string // path -> content
	catalog  Catalog
	lastRun  string
	runErr   error
	runValue RunResult
}

// The fake catalog is shaped like a real one: an OpenAPI app whose methods carry
// their HTTP request, a gRPC app whose don't, a required field, a nested message,
// an enum, a recursive message, and a google.protobuf.Value.
func newFakeBridge() *fakeBridge {
	return &fakeBridge{
		scripts: map[string]string{"/s/hello.ts": "console.log('hi')"},
		catalog: Catalog{
			Apps: []CatalogApp{
				{
					Name: "theatre",
					Type: "openapi",
					Services: []CatalogService{{
						Name:       "Shows",
						ImportPath: "theatre/proto/theatre",
						Methods: []CatalogMethod{
							{Name: "ListShows", Input: "theatre.ListShowsRequest", Output: "theatre.ListShowsResponse", HTTP: "GET /shows", Doc: "Lists the shows on sale."},
							{Name: "CreateShow", Input: "theatre.Show", Output: "theatre.Show", HTTP: "POST /shows"},
						},
					}},
				},
				{
					Name: "seating",
					Type: "grpc",
					Services: []CatalogService{{
						Name:        "Seating",
						PackageName: "seating.v1",
						ImportPath:  "seating/proto/seating",
						Methods: []CatalogMethod{
							{Name: "GetSeatMap", Input: "seating.v1.GetSeatMapRequest", Output: "seating.v1.SeatMap"},
							{Name: "Annotate", Input: "seating.v1.AnnotateRequest", Output: "seating.v1.AnnotateResponse"},
						},
					}},
				},
			},
			Types: map[string]CatalogType{
				"theatre.ListShowsRequest": {Name: "theatre.ListShowsRequest", TS: "ListShowsRequest", ImportPath: "theatre/proto/theatre", Fields: []CatalogField{
					{Name: "pageSize", Kind: "scalar", Type: "int32", In: "query", Doc: "How many shows to return."},
					{Name: "sort", Kind: "enum", Type: "theatre.Sort"},
				}},
				"theatre.ListShowsResponse": {Name: "theatre.ListShowsResponse", TS: "ListShowsResponse", Fields: []CatalogField{
					{Name: "items", Kind: "message", Type: "theatre.Show", Repeated: true, Envelope: true},
				}},
				"theatre.Show": {Name: "theatre.Show", TS: "Show", ImportPath: "theatre/proto/theatre", Doc: "A show in the catalog.", Fields: []CatalogField{
					{Name: "id", Kind: "scalar", Type: "string", Required: true, Doc: "Unique slug of the show."},
					{Name: "title", Kind: "scalar", Type: "string"},
					{Name: "venue", Kind: "message", Type: "theatre.Venue"},
				}},
				"theatre.Venue": {Name: "theatre.Venue", TS: "Venue", Fields: []CatalogField{
					{Name: "name", Kind: "scalar", Type: "string"},
					{Name: "parent", Kind: "message", Type: "theatre.Venue"},
				}},
				"seating.v1.GetSeatMapRequest": {Name: "seating.v1.GetSeatMapRequest", TS: "GetSeatMapRequest", Fields: []CatalogField{
					{Name: "performanceId", Kind: "scalar", Type: "string"},
				}},
				"seating.v1.SeatMap":          {Name: "seating.v1.SeatMap", TS: "SeatMap"},
				"seating.v1.AnnotateResponse": {Name: "seating.v1.AnnotateResponse", TS: "AnnotateResponse"},
				"seating.v1.AnnotateRequest": {Name: "seating.v1.AnnotateRequest", TS: "AnnotateRequest", Fields: []CatalogField{
					{Name: "note", Kind: "message", Type: "google.protobuf.Value"},
					{Name: "labels", Kind: "map", Type: "map<string, string>"},
				}},
				"google.protobuf.Value": {Name: "google.protobuf.Value", TS: "Value"},
			},
			Enums: map[string]CatalogEnum{
				"theatre.Sort": {Name: "theatre.Sort", TS: "Sort", ImportPath: "theatre/proto/theatre", Values: []string{"UNSPECIFIED", "NEWEST"}},
			},
			Sources: []CatalogSource{{Path: "theatre/proto/theatre", Content: "export interface Show {}"}},
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

// tool calls a tool and returns its text content.
func tool(t *testing.T, srv *Server, name string, args map[string]string) string {
	t.Helper()
	params := map[string]interface{}{"name": name}
	if args != nil {
		params["arguments"] = args
	}
	return toolText(t, call(t, srv, "tools/call", params))
}

func contains(t *testing.T, text string, fragments ...string) {
	t.Helper()
	for _, fragment := range fragments {
		if !strings.Contains(text, fragment) {
			t.Errorf("missing %q in:\n%s", fragment, text)
		}
	}
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
	instructions, _ := result["instructions"].(string)
	contains(t, instructions, "describe_method", "kaja.value")
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
		"list_services": false, "describe_method": false, "list_scripts": false,
		"read_script": false, "write_script": false, "create_script": false,
		"rename_script": false, "delete_script": false, "run_script": false,
	}
	descriptions := map[string]string{}
	for _, entry := range tools {
		definition := entry.(map[string]interface{})
		name := definition["name"].(string)
		if _, ok := want[name]; ok {
			want[name] = true
		}
		descriptions[name] = definition["description"].(string)
	}
	for name, seen := range want {
		if !seen {
			t.Errorf("tool %q missing from tools/list", name)
		}
	}
	// The runtime facts a caller would otherwise discover by probing ride on the
	// tool description, which no client can drop.
	contains(t, descriptions["run_script"], "top-level await", "import * as ns", "prompt")
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

func TestListServicesIsAnIndex(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	text := tool(t, srv, "list_services", nil)

	contains(t, text,
		"2 app(s), 2 service(s), 4 method(s).",
		`import { Shows } from "theatre/proto/theatre";`,
		// Each method carries what it takes, what it returns, and its effect.
		"read   ListShows(ListShowsRequest) -> ListShowsResponse  [GET /shows]",
		"write  CreateShow(Show) -> Show  [POST /shows]",
		"Lists the shows on sale.",
		// Without an HTTP verb the effect is read off the name, and says so.
		"read?  GetSeatMap(GetSeatMapRequest) -> SeatMap",
		"write? Annotate(AnnotateRequest) -> AnnotateResponse",
	)

	// The index never carries the generated sources: that is what overflowed a
	// caller's context before, and describe_method answers without them.
	if strings.Contains(text, "export interface Show {}") {
		t.Errorf("list_services leaked source text:\n%s", text)
	}
}

func TestListServicesFilters(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)

	byApp := tool(t, srv, "list_services", map[string]string{"app": "theatre"})
	contains(t, byApp, "ListShows")
	if strings.Contains(byApp, "GetSeatMap") {
		t.Errorf("app filter leaked another app:\n%s", byApp)
	}

	bySearch := tool(t, srv, "list_services", map[string]string{"search": "seat"})
	contains(t, bySearch, "GetSeatMap")
	if strings.Contains(bySearch, "ListShows") {
		t.Errorf("search leaked an unmatched method:\n%s", bySearch)
	}

	contains(t, tool(t, srv, "list_services", map[string]string{"search": "nothing-like-this"}), "Nothing matched")
}

func TestDescribeMethod(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	text := tool(t, srv, "describe_method", map[string]string{"method": "Shows.CreateShow"})

	contains(t, text,
		"theatre · Shows.CreateShow",
		"writes - calling it changes data (POST /shows)",
		"Request  Show (theatre.Show)",
		// A nested type is inlined, so no follow-up read is needed.
		"venue                  Venue",
		"name                   string",
		// A recursive type is named rather than expanded forever.
		"(recursive - see Venue above)",
		// Required-ness is stated, so a caller stops filling every field.
		"id                     string  [required]",
		"Required: id. Everything else may be left out.",
		// The example runs as written and fills only what has to be sent.
		`import { Shows } from "theatre/proto/theatre";`,
		"const response = await Shows.CreateShow({",
		`id: "",`,
		"// optional: title, venue",
		"console.log(response);",
	)
}

func TestDescribeMethodWithoutRequiredFields(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	text := tool(t, srv, "describe_method", map[string]string{"method": "ListShows"})

	contains(t, text,
		"read-only (GET /shows)",
		"pageSize               int32  [query]  How many shows to return.",
		"sort                   Sort  [Sort.UNSPECIFIED | Sort.NEWEST]",
		// proto3 has no required; saying so is what stops the defensive fill.
		"Every field is optional on the wire",
		// The enum's import comes along, so the example compiles.
		`import { Shows, Sort } from "theatre/proto/theatre";`,
		"sort: Sort.NEWEST,",
		// The response envelope is marked as one.
		"items                  Show[]  [http payload]",
	)
}

// The failure that started this: a google.protobuf.Value field is left out of a
// generated request because there is no default that would send, so the only way
// to learn about kaja.value is to be told at the point of use.
func TestDescribeMethodNamesTheKajaBuilders(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	text := tool(t, srv, "describe_method", map[string]string{"method": "Seating.Annotate"})

	contains(t, text,
		"note                   Value",
		`kaja.value("text")`,
		"note: kaja.value(null),",
		`import { kaja } from "kaja";`,
		"never hand-write the `kind` oneof",
	)
}

func TestDescribeMethodMisses(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)

	// An unknown name names the nearest things rather than only saying no.
	contains(t, tool(t, srv, "describe_method", map[string]string{"method": "Shows.ListShow"}), "Closest: Shows.ListShows")
	contains(t, tool(t, srv, "describe_method", map[string]string{"method": "Nope.Nope"}), "list_services")
	contains(t, tool(t, srv, "describe_method", nil), "provide method")
}

func TestDescribeMethodDisambiguates(t *testing.T) {
	bridge := newFakeBridge()
	// A second app exposing the same service and method name.
	bridge.catalog.Apps = append(bridge.catalog.Apps, CatalogApp{
		Name: "rehearsal", Type: "grpc",
		Services: []CatalogService{{Name: "Shows", ImportPath: "rehearsal/proto/shows", Methods: []CatalogMethod{
			{Name: "ListShows", Input: "theatre.ListShowsRequest", Output: "theatre.ListShowsResponse"},
		}}},
	})
	srv := NewServer(bridge, token)

	contains(t, tool(t, srv, "describe_method", map[string]string{"method": "Shows.ListShows"}),
		"more than one app", "rehearsal/Shows.ListShows", "theatre/Shows.ListShows")
	// Naming the app settles it.
	contains(t, tool(t, srv, "describe_method", map[string]string{"method": "theatre/Shows.ListShows"}), "read-only (GET /shows)")
}

func TestCallTool_CRUD(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token)

	created := tool(t, srv, "create_script", map[string]string{"name": "new", "content": "x"})
	if !strings.Contains(created, "new") {
		t.Fatalf("create result = %s", created)
	}
	contains(t, tool(t, srv, "read_script", map[string]string{"path": "/s/new"}), "x")
	tool(t, srv, "delete_script", map[string]string{"path": "/s/new"})
	if _, ok := bridge.scripts["/s/new"]; ok {
		t.Errorf("script was not deleted")
	}
}

func TestRunScriptReport(t *testing.T) {
	bridge := newFakeBridge()
	bridge.runValue = RunResult{
		Console: []string{"hi"},
		MethodCalls: []MethodCallLog{
			{Service: "Shows", Method: "ListShows", DurationMs: 120, Input: json.RawMessage(`{"pageSize": 1}`), Output: json.RawMessage(`{"items":[]}`)},
			{Service: "Shows", Method: "GetShow", Failure: &CallFailure{Kind: "TRANSPORT", Message: "decoding response JSON: proto: syntax error"}},
		},
		Error: "decoding response JSON: proto: syntax error",
	}
	srv := NewServer(bridge, token)
	text := tool(t, srv, "run_script", map[string]string{"path": "/s/hello.ts"})

	if bridge.lastRun != "/s/hello.ts" {
		t.Fatalf("run did not reach bridge, lastRun = %q", bridge.lastRun)
	}
	contains(t, text,
		"2 call(s), 1 failed",
		"hi",
		"1. Shows.ListShows  ok  120 ms",
		// The failure kind is what tells a caller not to retry with other values.
		"2. Shows.GetShow  TRANSPORT",
		"Sending different parameters will not help.",
		// A script that stopped says so, rather than looking like it finished.
		"the script stopped here",
		"Wrap a call in try/catch",
		// The request payload stays on one line.
		`request  {"pageSize":1}`,
	)

	// run with neither path nor code is a tool error
	resp := call(t, srv, "tools/call", map[string]interface{}{"name": "run_script"})
	if isErr, _ := resp.Result.(map[string]interface{})["isError"].(bool); !isErr {
		t.Fatalf("expected isError for empty run_script")
	}
}

func TestEmptyCatalog(t *testing.T) {
	bridge := newFakeBridge()
	bridge.catalog = Catalog{}
	srv := NewServer(bridge, token)
	contains(t, tool(t, srv, "list_services", nil), "No services yet")
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
	if !uris[stubScheme+"theatre/proto/theatre"] {
		t.Fatalf("missing stub resource: %v", uris)
	}

	resp = call(t, srv, "resources/read", map[string]string{"uri": guideURI})
	contents := resp.Result.(map[string]interface{})["contents"].([]interface{})
	contains(t, contents[0].(map[string]interface{})["text"].(string), "Kaja for agents")
}

func TestUnknownMethod(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	resp := call(t, srv, "bogus/method", nil)
	if resp.Error == nil || resp.Error.Code != codeMethodNotFound {
		t.Fatalf("expected method-not-found, got %+v", resp.Error)
	}
}

func TestReadOnlyFromName(t *testing.T) {
	cases := map[string]bool{
		"GetShow": true, "ListShows": true, "SearchShows": true, "Get": true,
		"Generate": false, "IngestEvents": false, "Islands": false, "Delete": false,
	}
	for name, want := range cases {
		if got := readingName(name); got != want {
			t.Errorf("readingName(%q) = %v, want %v", name, got, want)
		}
	}
}

// A big API must not be able to turn one answer into a context dump: a wide type
// is cut off with a pointer to where the rest lives, and a long payload keeps its
// character boundaries.
func TestAnswersAreBounded(t *testing.T) {
	bridge := newFakeBridge()
	wide := CatalogType{Name: "big.Wide", TS: "Wide"}
	for i := 0; i < 400; i++ {
		wide.Fields = append(wide.Fields, CatalogField{Name: fmt.Sprintf("field%d", i), Kind: "scalar", Type: "string"})
	}
	bridge.catalog.Types["big.Wide"] = wide
	bridge.catalog.Apps[0].Services[0].Methods[0].Output = "big.Wide"
	srv := NewServer(bridge, token)

	text := tool(t, srv, "describe_method", map[string]string{"method": "ListShows"})
	contains(t, text, "the rest is cut off here")
	if lines := strings.Count(text, "\n"); lines > 320 {
		t.Errorf("describe_method returned %d lines; the budget should have stopped it", lines)
	}

	bridge.runValue = RunResult{MethodCalls: []MethodCallLog{
		{Service: "Shows", Method: "ListShows", Output: json.RawMessage(`"` + strings.Repeat("é", 4000) + `"`)},
	}}
	report := tool(t, srv, "run_script", map[string]string{"code": "x"})
	contains(t, report, "truncated,")
	if !utf8.ValidString(report) {
		t.Errorf("truncation cut a payload mid-character")
	}
}

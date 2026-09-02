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
	scripts    map[string]string // path -> content
	catalog    Catalog
	lastRun    string
	lastClient string
	runErr     error
	runValue   RunResult
	activity   []int // in-flight counts, in the order they were reported
	readOnly   bool  // a workspace this kaja does not own, so nothing may write it
}

// The fake catalog is shaped like a real one: an OpenAPI app whose methods carry
// the HTTP request behind them, a gRPC app whose don't, and the declarations a
// script writes against - a required field, a nested type, an enum, a recursive
// type, and a field holding arbitrary JSON.
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
							{
								Name:      "ListShows",
								Signature: "ListShows(input: ListShowsRequest): Promise<ListShowsResponse>",
								Input:     "ListShowsRequest",
								Output:    "ListShowsResponse",
								HTTP:      "GET /shows",
								Doc:       "Lists the shows on sale.",
								Example:   "import { Shows } from \"theatre/proto/theatre\";\n\nShows.ListShows({\n  pageSize: 0,\n});",
							},
							{
								Name:      "CreateShow",
								Signature: "CreateShow(input: Show): Promise<Show>",
								Input:     "Show",
								Output:    "Show",
								HTTP:      "POST /shows",
								Example:   "import { Shows } from \"theatre/proto/theatre\";\n\nShows.CreateShow({\n  id: \"\",\n});",
							},
						},
					}},
					Declarations: map[string]Declaration{
						"ListShowsRequest": {Name: "ListShowsRequest", Text: "export interface ListShowsRequest {\n    /** How many shows to return. [query parameter] */\n    pageSize: number;\n}"},
						"ListShowsResponse": {
							Name:       "ListShowsResponse",
							Text:       "export interface ListShowsResponse {\n    /** [carries the HTTP payload] */\n    items: Show[];\n}",
							References: []string{"Show"},
						},
						"Show": {
							Name:       "Show",
							Text:       "/** A show in the catalog. */\nexport interface Show {\n    /** Unique slug of the show. [required] */\n    id: string;\n    venue?: Venue;\n}",
							References: []string{"Venue"},
						},
						// Venue reaches itself; the closure has to terminate on it.
						"Venue": {Name: "Venue", Text: "export interface Venue {\n    name: string;\n    parent?: Venue;\n}", References: []string{"Venue"}},
					},
				},
				{
					Name: "seating",
					Type: "grpc",
					Services: []CatalogService{{
						Name:       "Seating",
						ImportPath: "seating/proto/seating",
						Methods: []CatalogMethod{
							{Name: "GetSeatMap", Signature: "GetSeatMap(input: GetSeatMapRequest): Promise<SeatMap>", Input: "GetSeatMapRequest", Output: "SeatMap"},
							{
								Name:      "Annotate",
								Signature: "Annotate(input: AnnotateRequest): Promise<AnnotateResponse>",
								Input:     "AnnotateRequest",
								Output:    "AnnotateResponse",
								Example:   "import { kaja } from \"kaja\";\nimport { Seating } from \"seating/proto/seating\";\n\nSeating.Annotate({\n  note: kaja.value(null),\n});",
							},
						},
					}},
					Declarations: map[string]Declaration{
						"GetSeatMapRequest": {Name: "GetSeatMapRequest", Text: "export interface GetSeatMapRequest {\n    performanceId: string;\n}"},
						"SeatMap":           {Name: "SeatMap", Text: "export interface SeatMap {\n}"},
						"AnnotateRequest":   {Name: "AnnotateRequest", Text: "export interface AnnotateRequest {\n    note?: Value;\n}", References: []string{"Value"}},
						"AnnotateResponse":  {Name: "AnnotateResponse", Text: "export interface AnnotateResponse {\n}"},
						"Value":             {Name: "Value", Text: "export interface Value {\n}"},
					},
				},
			},
			// The kaja module, as the UI hands it over: the same declaration the
			// editor backs the import with, this workspace's variables and all.
			Runtime: "// The Kaja runtime, imported as: import { kaja } from \"kaja\";\n" +
				"export declare const kaja: {\n" +
				"  variables: {\n    \"API_BASE_URL\": string;\n  };\n" +
				"  table(columns: string[], rows?: unknown[][]): Table;\n};",
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
func (f *fakeBridge) RunScript(_ context.Context, path, code, client string) (RunResult, error) {
	if path != "" {
		f.lastRun = path
	} else {
		f.lastRun = code
	}
	f.lastClient = client
	return f.runValue, f.runErr
}
func (f *fakeBridge) Catalog() Catalog      { return f.catalog }
func (f *fakeBridge) CanWriteScripts() bool { return !f.readOnly }
func (f *fakeBridge) Activity(inFlight int) {
	f.activity = append(f.activity, inFlight)
}

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

// The plug's activity mark is driven from here: a request lands and the count
// goes up, and it comes back down once the request has been answered.
func TestActivity(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token)

	call(t, srv, "tools/list", nil)
	if got := bridge.activity; len(got) != 2 || got[0] != 1 || got[1] != 0 {
		t.Fatalf("activity = %v, want [1 0]", got)
	}

	// A notification carries no id and is answered with no body, but it is still
	// an agent talking to the server.
	bridge.activity = nil
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","method":"notifications/initialized"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	srv.ServeHTTP(httptest.NewRecorder(), req)
	if got := bridge.activity; len(got) != 2 || got[0] != 1 || got[1] != 0 {
		t.Fatalf("notification activity = %v, want [1 0]", got)
	}

	// A ping is a keepalive rather than use, so it lights nothing up.
	bridge.activity = nil
	call(t, srv, "ping", nil)
	if len(bridge.activity) != 0 {
		t.Fatalf("ping reported activity: %v", bridge.activity)
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
		"list_services": false, "describe_method": false, "describe_type": false,
		"list_scripts": false, "read_script": false, "write_script": false,
		"create_script": false, "rename_script": false, "delete_script": false,
		"run_script": false,
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
		// Each method is listed as the TypeScript a script writes, plus its effect.
		"read   ListShows(input: ListShowsRequest): Promise<ListShowsResponse>  [GET /shows]",
		"write  CreateShow(input: Show): Promise<Show>  [POST /shows]",
		"Lists the shows on sale.",
		// Without an HTTP verb the effect is read off the name, and says so.
		"read?  GetSeatMap(input: GetSeatMapRequest): Promise<SeatMap>",
		"write? Annotate(input: AnnotateRequest): Promise<AnnotateResponse>",
	)

	// The index never carries declarations: that is what overflowed a caller's
	// context before, and describe_method answers without dumping the module.
	if strings.Contains(text, "export interface") {
		t.Errorf("list_services leaked declarations:\n%s", text)
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
		// The import line and the signature are the two things a call needs.
		`import { Shows } from "theatre/proto/theatre";`,
		"Shows.CreateShow(input: Show): Promise<Show>",
		// The declaration itself, as the script is checked against it.
		"export interface Show {",
		"/** Unique slug of the show. [required] */",
		"    id: string;",
		// A type the request reaches is declared too, so nothing needs a second call.
		"export interface Venue {",
		// And a call to start from.
		"Shows.CreateShow({",
	)

	// Nothing about the wire format reaches a reader: a script is TypeScript.
	if strings.Contains(strings.ToLower(text), "protobuf") {
		t.Errorf("describe_method mentions protobuf:\n%s", text)
	}
}

func TestDescribeMethodReadOnly(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	text := tool(t, srv, "describe_method", map[string]string{"method": "ListShows"})

	contains(t, text,
		"read-only (GET /shows)",
		"Lists the shows on sale.",
		"/** How many shows to return. [query parameter] */",
		// The response envelope says it is one.
		"[carries the HTTP payload]",
		"pageSize: 0,",
	)
}

// The failure that started this: a field holding arbitrary JSON is unwritable by
// hand, so the builder has to be named where the field is met.
func TestDescribeMethodNamesTheKajaBuilders(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	text := tool(t, srv, "describe_method", map[string]string{"method": "Seating.Annotate"})

	contains(t, text,
		"note?: Value;",
		"kaja.value(json)",
		"note: kaja.value(null),",
		`import { kaja } from "kaja";`,
		"Never write the `kind` oneof by hand.",
	)
	// ListValue and Struct aren't in this request, so they aren't offered.
	if strings.Contains(text, "kaja.listValue(json)") {
		t.Errorf("named a builder the request has no field for:\n%s", text)
	}
}

// A type that reaches itself must not send the closure round forever.
func TestDescribeMethodClosesOverRecursiveTypes(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)
	text := tool(t, srv, "describe_method", map[string]string{"method": "CreateShow"})
	if got := strings.Count(text, "export interface Venue {"); got != 1 {
		t.Errorf("Venue declared %d times, want once:\n%s", got, text)
	}
}

func TestDescribeType(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)

	contains(t, tool(t, srv, "describe_type", map[string]string{"name": "Show"}),
		"theatre · Show", "export interface Show {", "export interface Venue {")

	// A miss names the nearest thing rather than only saying no.
	contains(t, tool(t, srv, "describe_type", map[string]string{"name": "Shw"}), "no type")
	contains(t, tool(t, srv, "describe_type", map[string]string{"name": "Venu"}), "Closest: Venue")
	contains(t, tool(t, srv, "describe_type", nil), "provide name")
}

// The kaja object is half of what a script is written against and no app
// declares it, so it is answered by name rather than searched for - including
// when the agent has a member in hand rather than the module.
func TestDescribeTypeAnswersTheRuntime(t *testing.T) {
	srv := NewServer(newFakeBridge(), token)

	for _, name := range []string{"kaja", "Kaja", "kaja.table"} {
		contains(t, tool(t, srv, "describe_type", map[string]string{"name": name}),
			"export declare const kaja: {", "table(columns: string[]", `"API_BASE_URL": string;`)
	}

	// The index says it is there, since nothing else in the listing would.
	contains(t, tool(t, srv, "list_services", nil), `describe_type "kaja"`)
}

// A workspace whose catalog predates the runtime (or arrived without one) still
// gets the ordinary miss rather than an empty answer.
func TestDescribeTypeWithoutARuntime(t *testing.T) {
	bridge := newFakeBridge()
	bridge.catalog.Runtime = ""
	srv := NewServer(bridge, token)

	contains(t, tool(t, srv, "describe_type", map[string]string{"name": "kaja"}), "no type")
	if strings.Contains(tool(t, srv, "list_services", nil), "describe_type \"kaja\"") {
		t.Errorf("the index pointed at a runtime declaration it does not have")
	}
}

func TestDescribeTypeDisambiguates(t *testing.T) {
	bridge := newFakeBridge()
	bridge.catalog.Apps[1].Declarations["Show"] = Declaration{Name: "Show", Text: "export interface Show {\n}"}
	srv := NewServer(bridge, token)

	contains(t, tool(t, srv, "describe_type", map[string]string{"name": "Show"}), "more than one app", "theatre", "seating")
	contains(t, tool(t, srv, "describe_type", map[string]string{"name": "Show", "app": "seating"}), "seating · Show")
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
			{Name: "ListShows", Signature: "ListShows(input: ListShowsRequest): Promise<ListShowsResponse>", Input: "ListShowsRequest", Output: "ListShowsResponse"},
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

// The draft an inline run lands in is labelled with the agent that ran it, so
// the name it announced at the handshake has to reach the run.
func TestRunScriptCarriesTheClientName(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token)

	// Before any handshake there is still a row to label.
	tool(t, srv, "run_script", map[string]string{"code": "1"})
	if bridge.lastClient != "Agent" {
		t.Errorf("client = %q, want the fallback", bridge.lastClient)
	}

	// A title is what a person reads; the identifier is the fallback.
	call(t, srv, "initialize", map[string]interface{}{"clientInfo": map[string]string{"name": "claude-code", "title": "Claude Code"}})
	tool(t, srv, "run_script", map[string]string{"code": "1"})
	if bridge.lastClient != "Claude Code" {
		t.Errorf("client = %q, want Claude Code", bridge.lastClient)
	}

	call(t, srv, "initialize", map[string]interface{}{"clientInfo": map[string]string{"name": "cursor-vscode"}})
	tool(t, srv, "run_script", map[string]string{"code": "1"})
	if bridge.lastClient != "cursor-vscode" {
		t.Errorf("client = %q, want cursor-vscode", bridge.lastClient)
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
		"This is the script failing, not a call being rejected",
		// The request payload stays on one line.
		`request  {"pageSize":1}`,
	)

	// run with neither path nor code is a tool error
	resp := call(t, srv, "tools/call", map[string]interface{}{"name": "run_script"})
	if isErr, _ := resp.Result.(map[string]interface{})["isError"].(bool); !isErr {
		t.Fatalf("expected isError for empty run_script")
	}
}

// What a script drew is the receipt that its output landed - an agent's run has
// a canvas but nobody looking at it.
func TestRunScriptReportsWhatItDrew(t *testing.T) {
	bridge := newFakeBridge()
	bridge.runValue = RunResult{
		Blocks: []BlockLog{
			{Kind: "text", Label: "Reconciling 12 accounts"},
			{Kind: "table", Label: "42 rows", Columns: []string{"id", "name", "status"}, Rows: 42},
		},
	}
	srv := NewServer(bridge, token)

	contains(t, tool(t, srv, "run_script", map[string]string{"code": "kaja.text('x')"}),
		"canvas",
		"1. text  Reconciling 12 accounts",
		"2. table  3 column(s) × 42 row(s)  [id, name, status]",
	)
}

// The transpiler that runs a script does not type-check, so a script full of type
// errors runs and every other part of this report reads as a clean run. The section
// is what says otherwise.
func TestRunScriptReportsTypeErrors(t *testing.T) {
	bridge := newFakeBridge()
	bridge.runValue = RunResult{
		Diagnostics: []Diagnostic{
			{Line: 4, Column: 3, Message: "Object literal may only specify known properties, but 'pagesize' does not exist in type 'Input<ListShowsRequest>'. Did you mean to write 'pageSize'?"},
		},
		MethodCalls: []MethodCallLog{{Service: "Shows", Method: "ListShows", Output: json.RawMessage(`{"items":[]}`)}},
	}
	srv := NewServer(bridge, token)

	contains(t, tool(t, srv, "run_script", map[string]string{"code": "Shows.ListShows({ pagesize: 1 })"}),
		"type errors",
		"4:3  Object literal may only specify known properties",
		// The run happened, so the section has to say the errors are not why anything
		// failed - and that the file is red all the same.
		"These did not stop the run",
		"red in the window it is opened in",
	)
}

// One mistyped import puts an error on every line that uses it, and the tail of
// that list says nothing the head didn't.
func TestTypeErrorsAreBounded(t *testing.T) {
	bridge := newFakeBridge()
	for i := 0; i < maxDiagnostics+5; i++ {
		bridge.runValue.Diagnostics = append(bridge.runValue.Diagnostics, Diagnostic{Line: i + 1, Column: 1, Message: fmt.Sprintf("Cannot find name 'Shows' (%d)", i)})
	}
	srv := NewServer(bridge, token)

	text := tool(t, srv, "run_script", map[string]string{"code": "x"})
	contains(t, text, "Cannot find name 'Shows' (19)", "… 5 more")
	if strings.Contains(text, "Cannot find name 'Shows' (20)") {
		t.Errorf("listed past the cap:\n%s", text)
	}
}

// A returned value is carried this far only so the report can correct it: the
// app refuses to run a script with a top-level return, so a script that answers
// by returning works here and is a dead file the moment a person opens it.
func TestRunScriptCorrectsAReturnedValue(t *testing.T) {
	bridge := newFakeBridge()
	bridge.runValue = RunResult{Result: json.RawMessage(`"| id | name |\n| -- | ---- |"`)}
	srv := NewServer(bridge, token)

	contains(t, tool(t, srv, "run_script", map[string]string{"code": "return table"}),
		"returned a value, which does nothing",
		"will not run one with a top-level `return`",
		"kaja.table(columns).row(...)",
	)
}

// A method's streaming direction is only worth saying for what it costs the caller:
// one direction is called like any other method, the other two not at all.
func TestStreamingIsMarkedByWhatItCosts(t *testing.T) {
	bridge := newFakeBridge()
	bridge.catalog = Catalog{Apps: []CatalogApp{{
		Name: "feed",
		Type: "grpc",
		Services: []CatalogService{{
			Name:       "Feed",
			ImportPath: "feed/proto/feed",
			Methods: []CatalogMethod{
				{Name: "Watch", Signature: "Watch(input: Input<WatchRequest>): Call<Event>", Input: "WatchRequest", Output: "Event", Streaming: "server"},
				{Name: "Upload", Signature: "Upload(input: Input<Chunk>): Call<UploadResult>", Input: "Chunk", Output: "UploadResult", Streaming: "client"},
			},
		}},
		Declarations: map[string]Declaration{
			"WatchRequest": {Name: "WatchRequest", Text: "export interface WatchRequest {\n    topic: string;\n}"},
			"Event":        {Name: "Event", Text: "export interface Event {\n    at: string;\n}"},
			"Chunk":        {Name: "Chunk", Text: "export interface Chunk {\n    bytes: string;\n}"},
			"UploadResult": {Name: "UploadResult", Text: "export interface UploadResult {\n    ok: boolean;\n}"},
		},
	}}}
	srv := NewServer(bridge, token)

	index := tool(t, srv, "list_services", nil)
	contains(t, index, "[server stream]", "[not supported yet]")

	// The method is described all the same - it is part of the app's surface - but
	// the note says no request will make the call go.
	contains(t, tool(t, srv, "describe_method", map[string]string{"method": "Feed.Upload"}),
		"streaming: client streaming is not supported by Kaja yet - calling this method is refused, whatever the request")
	contains(t, tool(t, srv, "describe_method", map[string]string{"method": "Feed.Watch"}),
		"streaming: server streaming; the call hands back the last message, and all of them are in the run's log")
}

// A deprecated method is listed and described like any other - Kaja still calls it -
// with the API's own note on it, so an agent about to write a script sees it before
// the call rather than after.
func TestDeprecatedMethodIsMarkedAndStillDescribed(t *testing.T) {
	bridge := newFakeBridge()
	bridge.catalog = Catalog{Apps: []CatalogApp{{
		Name: "pets",
		Type: "openapi",
		Services: []CatalogService{{
			Name:       "Pet",
			ImportPath: "pets",
			Methods: []CatalogMethod{
				{Name: "FindByTags", Signature: "FindByTags(input: Input<FindByTagsRequest>): Call<FindByTagsResponse>", Input: "FindByTagsRequest", Output: "FindByTagsResponse", HTTP: "GET /pet/findByTags", Deprecated: true},
				{Name: "FindByStatus", Signature: "FindByStatus(input: Input<FindByStatusRequest>): Call<FindByStatusResponse>", Input: "FindByStatusRequest", Output: "FindByStatusResponse", HTTP: "GET /pet/findByStatus"},
			},
		}},
		Declarations: map[string]Declaration{
			"FindByTagsRequest":    {Name: "FindByTagsRequest", Text: "export interface FindByTagsRequest {\n    tags: string[];\n}"},
			"FindByTagsResponse":   {Name: "FindByTagsResponse", Text: "export interface FindByTagsResponse {\n    items: string[];\n}"},
			"FindByStatusRequest":  {Name: "FindByStatusRequest", Text: "export interface FindByStatusRequest {\n    status: string;\n}"},
			"FindByStatusResponse": {Name: "FindByStatusResponse", Text: "export interface FindByStatusResponse {\n    items: string[];\n}"},
		},
	}}}
	srv := NewServer(bridge, token)

	index := tool(t, srv, "list_services", nil)
	contains(t, index, "GET /pet/findByTags, deprecated", "FindByStatus")
	if strings.Count(index, "deprecated") != 1 {
		t.Errorf("only the deprecated method should be marked:\n%s", index)
	}

	contains(t, tool(t, srv, "describe_method", map[string]string{"method": "Pet.FindByTags"}),
		"deprecated: the API asks callers to move off this method",
		"FindByTags(input: Input<FindByTagsRequest>)")
	if described := tool(t, srv, "describe_method", map[string]string{"method": "Pet.FindByStatus"}); strings.Contains(described, "deprecated") {
		t.Errorf("a method the API says nothing about should carry no note:\n%s", described)
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
	// The generated modules are not offered: describe_method and describe_type
	// hand back the declarations, and a module's full text is what overflowed a
	// caller's context.
	for uri := range uris {
		if strings.HasPrefix(uri, "kaja://stub") {
			t.Errorf("stub resource still advertised: %s", uri)
		}
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
	var wide strings.Builder
	wide.WriteString("export interface Wide {\n")
	for i := 0; i < 400; i++ {
		fmt.Fprintf(&wide, "    field%d: string;\n", i)
	}
	wide.WriteString("}")
	theatre := bridge.catalog.Apps[0]
	theatre.Declarations["Wide"] = Declaration{Name: "Wide", Text: wide.String()}
	theatre.Declarations["ListShowsResponse"] = Declaration{Name: "ListShowsResponse", Text: "export interface ListShowsResponse {\n    wide: Wide;\n}", References: []string{"Wide"}}
	srv := NewServer(bridge, token)

	text := tool(t, srv, "describe_method", map[string]string{"method": "ListShows"})
	// The cut says what to ask for next rather than just stopping.
	contains(t, text, "cut off here", `describe_type "Wide"`)
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

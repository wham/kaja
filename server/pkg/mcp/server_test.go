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
	"time"
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
	// onRun is what a run does before it answers, which is where a test beats.
	onRun func(progress func(RunProgress))
	// lastProgress is what the run was handed to report itself with, nil where the
	// caller asked to hear nothing.
	lastProgress func(RunProgress)
	hadProgress  bool
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
func (f *fakeBridge) RunScript(_ context.Context, path, code, client string, progress func(RunProgress)) (RunResult, error) {
	if path != "" {
		f.lastRun = path
	} else {
		f.lastRun = code
	}
	f.lastClient = client
	f.lastProgress, f.hadProgress = progress, progress != nil
	if f.onRun != nil {
		f.onRun(progress)
	}
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

const version = "1.2.3"

func call(t *testing.T, srv *Server, method string, params interface{}) rpcResponse {
	t.Helper()
	return request(t, srv, method, params, nil)
}

func request(t *testing.T, srv *Server, method string, params interface{}, headers map[string]string) rpcResponse {
	t.Helper()
	rec := post(t, srv, method, params, headers)
	var resp rpcResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("%s: decode response: %v (%s)", method, err, rec.Body.String())
	}
	return resp
}

func post(t *testing.T, srv *Server, method string, params interface{}, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	rec := rawPost(t, srv, method, params, headers)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s: status = %d, body = %s", method, rec.Code, rec.Body.String())
	}
	return rec
}

// rawPost sends one request and hands back whatever came, status included, which is
// what the doors that answer with something other than 200 are read through.
func rawPost(t *testing.T, srv *Server, method string, params interface{}, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	body := map[string]interface{}{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		body["params"] = params
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+token)
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

// modernParams is a request written in the revision that dropped the handshake: it
// carries its own version, so nothing about it is state the server holds.
func modernParams(params map[string]interface{}) map[string]interface{} {
	if params == nil {
		params = map[string]interface{}{}
	}
	params["_meta"] = map[string]interface{}{metaProtocolVersion: ProtocolVersion}
	return params
}

// modernResult reads a modern answer, checking the framing every one of them carries.
func modernResult(t *testing.T, srv *Server, method string, params map[string]interface{}) map[string]interface{} {
	t.Helper()
	resp := call(t, srv, method, modernParams(params))
	if resp.Error != nil {
		t.Fatalf("%s: %+v", method, resp.Error)
	}
	result, ok := resp.Result.(map[string]interface{})
	if !ok {
		t.Fatalf("%s: result is %T", method, resp.Result)
	}
	if result["resultType"] != "complete" {
		t.Errorf("%s: resultType = %v, want complete", method, result["resultType"])
	}
	meta, _ := result["_meta"].(map[string]interface{})
	info, _ := meta[metaServerInfo].(map[string]interface{})
	if info["name"] != serverName || info["version"] != version {
		t.Errorf("%s: serverInfo = %v", method, info)
	}
	return result
}

// cached asserts the cache directives a listing has to carry, since a caller has no
// other way to know how long the answer it is holding is good for.
func cached(t *testing.T, result map[string]interface{}, ttl time.Duration) {
	t.Helper()
	if got := result["ttlMs"]; got != float64(ttl.Milliseconds()) {
		t.Errorf("ttlMs = %v, want %v", got, ttl.Milliseconds())
	}
	if got := result["cacheScope"]; got != cacheScope {
		t.Errorf("cacheScope = %v, want %v", got, cacheScope)
	}
}

// tool calls a tool and returns its text content.
func tool(t *testing.T, srv *Server, name string, args map[string]string) string {
	t.Helper()
	return toolAs(t, srv, "", name, args)
}

// toolAs calls a tool as the client holding a session, which is how one endpoint
// serving two agents is written in a test.
func toolAs(t *testing.T, srv *Server, session, name string, args map[string]string) string {
	t.Helper()
	params := map[string]interface{}{"name": name}
	if args != nil {
		params["arguments"] = args
	}
	headers := map[string]string{}
	if session != "" {
		headers[sessionHeader] = session
	}
	return toolText(t, request(t, srv, "tools/call", params, headers))
}

// handshake introduces a client and answers with the session it was pinned.
func handshake(t *testing.T, srv *Server, info map[string]string) string {
	t.Helper()
	rec := post(t, srv, "initialize", map[string]interface{}{"clientInfo": info}, nil)
	return rec.Header().Get(sessionHeader)
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
	srv := NewServer(newFakeBridge(), token, version)
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
	srv := NewServer(bridge, token, version)

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
	srv := NewServer(newFakeBridge(), token, version)
	resp := call(t, srv, "initialize", nil)
	if resp.Error != nil {
		t.Fatalf("error: %+v", resp.Error)
	}
	result := resp.Result.(map[string]interface{})
	if result["protocolVersion"] != legacyProtocolVersion {
		t.Fatalf("protocolVersion = %v", result["protocolVersion"])
	}
	instructions, _ := result["instructions"].(string)
	contains(t, instructions, "describe_method", "kaja.value")
}

func TestNotificationGetsNoBody(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
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
	srv := NewServer(newFakeBridge(), token, version)
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
	srv := NewServer(newFakeBridge(), token, version)
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
	srv := NewServer(newFakeBridge(), token, version)

	// The header counts what the list holds, not what the catalog does: naming the
	// whole catalog over a filtered list said the app had five times what follows.
	byApp := tool(t, srv, "list_services", map[string]string{"app": "theatre"})
	contains(t, byApp, "ListShows", "1 app(s), 1 service(s), 2 method(s).")
	if strings.Contains(byApp, "GetSeatMap") {
		t.Errorf("app filter leaked another app:\n%s", byApp)
	}

	bySearch := tool(t, srv, "list_services", map[string]string{"search": "seat"})
	contains(t, bySearch, "GetSeatMap", "1 app(s), 1 service(s), 2 method(s).")
	if strings.Contains(bySearch, "ListShows") {
		t.Errorf("search leaked an unmatched method:\n%s", bySearch)
	}

	contains(t, tool(t, srv, "list_services", map[string]string{"search": "nothing-like-this"}), "Nothing matched")
}

func TestDescribeMethod(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
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
	srv := NewServer(newFakeBridge(), token, version)
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
	srv := NewServer(newFakeBridge(), token, version)
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
	srv := NewServer(newFakeBridge(), token, version)
	text := tool(t, srv, "describe_method", map[string]string{"method": "CreateShow"})
	if got := strings.Count(text, "export interface Venue {"); got != 1 {
		t.Errorf("Venue declared %d times, want once:\n%s", got, text)
	}
}

func TestDescribeType(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)

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
	srv := NewServer(newFakeBridge(), token, version)

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
	srv := NewServer(bridge, token, version)

	contains(t, tool(t, srv, "describe_type", map[string]string{"name": "kaja"}), "no type")
	if strings.Contains(tool(t, srv, "list_services", nil), "describe_type \"kaja\"") {
		t.Errorf("the index pointed at a runtime declaration it does not have")
	}
}

func TestDescribeTypeDisambiguates(t *testing.T) {
	bridge := newFakeBridge()
	bridge.catalog.Apps[1].Declarations["Show"] = Declaration{Name: "Show", Text: "export interface Show {\n}"}
	srv := NewServer(bridge, token, version)

	contains(t, tool(t, srv, "describe_type", map[string]string{"name": "Show"}), "more than one app", "theatre", "seating")
	contains(t, tool(t, srv, "describe_type", map[string]string{"name": "Show", "app": "seating"}), "seating · Show")
}

func TestDescribeMethodMisses(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)

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
	srv := NewServer(bridge, token, version)

	contains(t, tool(t, srv, "describe_method", map[string]string{"method": "Shows.ListShows"}),
		"more than one app", "rehearsal/Shows.ListShows", "theatre/Shows.ListShows")
	// Naming the app settles it.
	contains(t, tool(t, srv, "describe_method", map[string]string{"method": "theatre/Shows.ListShows"}), "read-only (GET /shows)")
}

func TestCallTool_CRUD(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token, version)

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
// the name it announced has to reach the run.
func TestRunScriptCarriesTheClientName(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token, version)

	// Before any handshake there is still a row to label.
	tool(t, srv, "run_script", map[string]string{"code": "1"})
	if bridge.lastClient != "Agent" {
		t.Errorf("client = %q, want the fallback", bridge.lastClient)
	}

	// A title is what a person reads; the identifier is the fallback.
	handshake(t, srv, map[string]string{"name": "claude-code", "title": "Claude Code"})
	tool(t, srv, "run_script", map[string]string{"code": "1"})
	if bridge.lastClient != "Claude Code" {
		t.Errorf("client = %q, want Claude Code", bridge.lastClient)
	}

	handshake(t, srv, map[string]string{"name": "cursor-vscode"})
	tool(t, srv, "run_script", map[string]string{"code": "1"})
	if bridge.lastClient != "cursor-vscode" {
		t.Errorf("client = %q, want cursor-vscode", bridge.lastClient)
	}
}

// Two agents on one endpoint each get their own draft, so a run has to be read as
// the client that made it rather than as whoever handshook last.
func TestTwoClientsAreToldApartByTheirSession(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token, version)

	code := handshake(t, srv, map[string]string{"name": "claude-code", "title": "Claude Code"})
	codex := handshake(t, srv, map[string]string{"name": "codex"})
	if code == "" || codex == "" {
		t.Fatalf("handshakes pinned no session (%q, %q)", code, codex)
	}
	if code == codex {
		t.Fatalf("both clients were pinned the same session %q", code)
	}

	// Interleaved, and the later handshake is the one the fallback would have named.
	toolAs(t, srv, code, "run_script", map[string]string{"code": "1"})
	if bridge.lastClient != "Claude Code" {
		t.Errorf("client = %q, want Claude Code", bridge.lastClient)
	}
	toolAs(t, srv, codex, "run_script", map[string]string{"code": "1"})
	if bridge.lastClient != "codex" {
		t.Errorf("client = %q, want codex", bridge.lastClient)
	}

	// A client that handshakes again is the same client, so it keeps its session and
	// the map is bounded by how many agents there are.
	if again := handshake(t, srv, map[string]string{"name": "claude-code", "title": "Claude Code"}); again != code {
		t.Errorf("session = %q, want the one already pinned (%q)", again, code)
	}
}

// The revision that dropped the handshake carries the identity on every request,
// where it outranks any session at all.
func TestClientInfoInMetaNamesTheCaller(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token, version)

	handshake(t, srv, map[string]string{"name": "claude-code", "title": "Claude Code"})
	call(t, srv, "tools/call", map[string]interface{}{
		"name":      "run_script",
		"arguments": map[string]string{"code": "1"},
		"_meta":     map[string]interface{}{metaClientInfo: map[string]string{"name": "codex"}},
	})
	if bridge.lastClient != "codex" {
		t.Errorf("client = %q, want codex", bridge.lastClient)
	}
}

// A session nothing pinned is a client kaja has never met, which is the one case
// left for the last handshake to answer.
func TestUnknownSessionFallsBackToTheLastHandshake(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token, version)

	handshake(t, srv, map[string]string{"name": "codex"})
	toolAs(t, srv, "nothing-pinned-this", "run_script", map[string]string{"code": "1"})
	if bridge.lastClient != "codex" {
		t.Errorf("client = %q, want codex", bridge.lastClient)
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
	srv := NewServer(bridge, token, version)
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
	srv := NewServer(bridge, token, version)

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
	srv := NewServer(bridge, token, version)

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
	srv := NewServer(bridge, token, version)

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
	srv := NewServer(bridge, token, version)

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
	srv := NewServer(bridge, token, version)

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
	srv := NewServer(bridge, token, version)

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
	srv := NewServer(bridge, token, version)
	contains(t, tool(t, srv, "list_services", nil), "No services yet")
}

func TestResources(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
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

// A method this server does not answer is a 404 as well as a JSON-RPC error, which is
// what lets a client tell "no such method" from "the call failed" without reading the
// body.
func TestUnknownMethod(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	rec := rawPost(t, srv, "bogus/method", nil, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	var resp rpcResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
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
	srv := NewServer(bridge, token, version)

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

// The modern era's opening replaces the handshake rather than preceding one: it names
// every revision this server speaks, so a client that reached it with the wrong one
// has the answer without a second round trip.
func TestDiscover(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	result := modernResult(t, srv, "server/discover", nil)
	cached(t, result, staticTTL)

	versions, _ := result["supportedVersions"].([]interface{})
	if len(versions) == 0 || versions[0] != ProtocolVersion {
		t.Fatalf("supportedVersions = %v", versions)
	}
	capabilities, _ := result["capabilities"].(map[string]interface{})
	if _, ok := capabilities["tools"]; !ok {
		t.Errorf("capabilities = %v, want tools", capabilities)
	}
	contains(t, result["instructions"].(string), "describe_method")
}

// Discovery is the one method only the modern era defines, so it is answered in that
// era whatever a client puts in the request.
func TestDiscoverIsModernWithoutMeta(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	result := call(t, srv, "server/discover", nil).Result.(map[string]interface{})
	if result["resultType"] != "complete" {
		t.Fatalf("resultType = %v", result["resultType"])
	}
}

// A version this server does not speak is refused with the ones it does: a client that
// cannot tell why it was refused has nothing to retry with.
func TestUnsupportedProtocolVersion(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	params := map[string]interface{}{"_meta": map[string]interface{}{metaProtocolVersion: "1999-01-01"}}
	resp := call(t, srv, "tools/list", params)
	if resp.Error == nil || resp.Error.Code != codeUnsupportedProtocolVersion {
		t.Fatalf("error = %+v, want %d", resp.Error, codeUnsupportedProtocolVersion)
	}
	data, _ := resp.Error.Data.(map[string]interface{})
	offered, _ := data["supported"].([]interface{})
	if len(offered) != len(supportedVersions) || offered[0] != ProtocolVersion {
		t.Fatalf("supported = %v", offered)
	}
}

// The framing belongs to the era the request was written in, not to the server: a
// handshake-era client is answered the way it has always been.
func TestLegacyResultIsUnframed(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	result := call(t, srv, "tools/list", nil).Result.(map[string]interface{})
	if _, ok := result["resultType"]; ok {
		t.Errorf("legacy result carries resultType: %v", result)
	}
	if _, ok := result["_meta"]; ok {
		t.Errorf("legacy result carries _meta: %v", result)
	}
	// The cache directives describe the answer rather than the era, so they are on it
	// either way.
	cached(t, result, workspaceTTL)
}

// Every listing says how long it is good for, because the two speeds anything here
// moves at are not something a caller can tell apart on its own.
func TestListingsAreCacheable(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	cached(t, modernResult(t, srv, "tools/list", nil), workspaceTTL)
	cached(t, modernResult(t, srv, "resources/list", nil), workspaceTTL)
	cached(t, modernResult(t, srv, "resources/read", map[string]interface{}{"uri": servicesURI}), workspaceTTL)
	cached(t, modernResult(t, srv, "resources/read", map[string]interface{}{"uri": guideURI}), staticTTL)
}

// A handshake is answered in the version it asked for where this server speaks it, since
// that is what the client is about to write its requests in.
func TestInitializeEchoesTheVersionAsked(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	for asked, want := range map[string]string{
		"2025-03-26":    "2025-03-26",
		"2025-11-25":    "2025-11-25",
		"1999-01-01":    legacyProtocolVersion,
		ProtocolVersion: legacyProtocolVersion,
	} {
		resp := call(t, srv, "initialize", map[string]interface{}{"protocolVersion": asked})
		result := resp.Result.(map[string]interface{})
		if result["protocolVersion"] != want {
			t.Errorf("asked %q, answered %v, want %v", asked, result["protocolVersion"], want)
		}
		// The handshake era names the server at the top level, and says it once.
		info, _ := result["serverInfo"].(map[string]interface{})
		if info["name"] != serverName || info["version"] != version {
			t.Errorf("serverInfo = %v", info)
		}
	}
}

// A page may not drive this endpoint just because it resolved a name to the loopback
// address an agent reaches it on. An agent is a process and sends no Origin at all.
func TestOriginIsChecked(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	allowed := map[string]bool{
		"": true,
		// httptest sends these to example.com, so this is a page on the server's own origin.
		"http://example.com":     true,
		"http://localhost:5173":  true,
		"http://127.0.0.1:41521": true,
		"http://attacker.test":   false,
		"https://evil.test":      false,
		"null":                   false,
	}
	for origin, want := range allowed {
		headers := map[string]string{}
		if origin != "" {
			headers["Origin"] = origin
		}
		rec := rawPost(t, srv, "ping", nil, headers)
		if got := rec.Code != http.StatusForbidden; got != want {
			t.Errorf("origin %q: status = %d, allowed = %v, want %v", origin, rec.Code, got, want)
		}
	}
}

// The origin is checked before the token is read, so a site that guessed the token
// still never reaches the endpoint.
func TestOriginIsCheckedBeforeTheToken(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`))
	req.Header.Set("Origin", "https://evil.test")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

// What a tool does to the workspace is stated rather than read off its name.
func TestToolsCarryTitlesAndAnnotations(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	tools := map[string]map[string]interface{}{}
	for _, entry := range call(t, srv, "tools/list", nil).Result.(map[string]interface{})["tools"].([]interface{}) {
		tool := entry.(map[string]interface{})
		tools[tool["name"].(string)] = tool
	}
	for name, tool := range tools {
		if title, _ := tool["title"].(string); title == "" {
			t.Errorf("%s has no title", name)
		}
		if _, ok := tool["annotations"].(map[string]interface{}); !ok {
			t.Errorf("%s has no annotations", name)
		}
	}
	readOnly := func(name string) bool {
		hints := tools[name]["annotations"].(map[string]interface{})
		return hints["readOnlyHint"] == true
	}
	destructive := func(name string) bool {
		hints := tools[name]["annotations"].(map[string]interface{})
		return hints["destructiveHint"] == true
	}
	for _, name := range []string{"list_services", "describe_method", "describe_type", "list_scripts", "read_script"} {
		if !readOnly(name) {
			t.Errorf("%s is not marked read-only", name)
		}
	}
	for _, name := range []string{"write_script", "delete_script", "run_script"} {
		if readOnly(name) || !destructive(name) {
			t.Errorf("%s is not marked as taking something away", name)
		}
	}
	// Filing a new script takes nothing away, which is the distinction the hint carries.
	if destructive("create_script") || destructive("rename_script") {
		t.Errorf("creating and renaming are not destructive")
	}
	if _, ok := tools["run_script"]["outputSchema"]; !ok {
		t.Errorf("run_script declares no outputSchema")
	}
}

// The run report is sent twice over: once as the text a person reads in a transcript,
// once in the shape a caller parses. They are built from the same values.
func TestRunScriptReportsStructuredContent(t *testing.T) {
	bridge := newFakeBridge()
	bridge.runValue = RunResult{
		Console: []string{"probing"},
		MethodCalls: []MethodCallLog{
			{App: "theatre", Service: "Shows", Method: "ListShows", DurationMs: 12, Input: json.RawMessage(`{"pageSize":2}`), Output: json.RawMessage(`{"items":[]}`)},
			{Http: "GET https://api.example.com/health", Failure: &CallFailure{Kind: "NOT_FOUND", Message: "no such route", Status: 404}},
		},
		Blocks:      []BlockLog{{Kind: "table", Columns: []string{"id"}, Rows: 2}},
		Diagnostics: []Diagnostic{{Line: 3, Column: 1, Message: "Type 'number' is not assignable to type 'string'."}},
		Error:       "TypeError: undefined is not an object",
	}
	srv := NewServer(bridge, token, version)

	params := modernParams(map[string]interface{}{"name": "run_script", "arguments": map[string]string{"path": "/s/hello.ts"}})
	result := call(t, srv, "tools/call", params).Result.(map[string]interface{})

	raw, err := json.Marshal(result["structuredContent"])
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var report RunReport
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatalf("the structured report does not parse: %v (%s)", err, raw)
	}
	if report.Script != "/s/hello.ts" || report.Stopped == "" {
		t.Fatalf("report = %+v", report)
	}
	if len(report.Calls) != 2 {
		t.Fatalf("calls = %d, want 2", len(report.Calls))
	}
	if report.Calls[0].Label != "theatre Shows.ListShows" || string(report.Calls[0].Response) != `{"items":[]}` {
		t.Errorf("first call = %+v", report.Calls[0])
	}
	// A fetch is named by the request it made, and a failure carries what to do about it.
	second := report.Calls[1]
	if second.Label != "GET https://api.example.com/health" || second.Failure == nil {
		t.Fatalf("second call = %+v", second)
	}
	if second.Failure.Status != 404 || second.Failure.Advice != failureAdvice["NOT_FOUND"] {
		t.Errorf("failure = %+v", second.Failure)
	}
	if len(report.Blocks) != 1 || len(report.Diagnostics) != 1 || len(report.Console) != 1 {
		t.Errorf("report = %+v", report)
	}
	// The text half is unchanged by any of it.
	contains(t, toolText(t, call(t, srv, "tools/call", params)), "Ran /s/hello.ts", "the script stopped here")
}

// A payload past the cap is replaced rather than cut: JSON sliced in half is not JSON,
// and a caller that cannot parse the report has lost the calls under it too.
func TestStructuredPayloadsStayParseable(t *testing.T) {
	bridge := newFakeBridge()
	bridge.runValue = RunResult{MethodCalls: []MethodCallLog{{
		Service: "Shows", Method: "ListShows",
		Output: json.RawMessage(`{"items":"` + strings.Repeat("x", maxPayload) + `"}`),
	}}}
	srv := NewServer(bridge, token, version)
	result := call(t, srv, "tools/call", map[string]interface{}{
		"name": "run_script", "arguments": map[string]string{"code": "// hi"},
	}).Result.(map[string]interface{})

	raw, _ := json.Marshal(result["structuredContent"])
	var report RunReport
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatalf("does not parse: %v", err)
	}
	var note string
	if err := json.Unmarshal(report.Calls[0].Response, &note); err != nil {
		t.Fatalf("an oversized payload is not a JSON string: %s", report.Calls[0].Response)
	}
	contains(t, note, "too large to report")
}

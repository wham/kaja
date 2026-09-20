package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wham/kaja/v2/pkg/apps"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/dynamicpb"
)

// fakeServer is an MCP server that answers from a table of canned results, and
// records what it was asked.
type fakeServer struct {
	// era is "modern" (server/discover, per-request _meta) or "legacy"
	// (initialize handshake).
	era string
	// results are the results returned per method, as JSON.
	results map[string]string
	// sse makes the server answer with an event stream rather than a JSON object.
	sse bool
	// session, when set, is the Mcp-Session-Id a legacy server pins.
	session string

	requests []recorded
}

type recorded struct {
	Method  string
	Params  map[string]json.RawMessage
	Headers http.Header
}

func (f *fakeServer) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var message struct {
			ID     json.RawMessage            `json:"id"`
			Method string                     `json:"method"`
			Params map[string]json.RawMessage `json:"params"`
		}
		if err := json.Unmarshal(body, &message); err != nil {
			http.Error(w, "not JSON", http.StatusBadRequest)
			return
		}
		f.requests = append(f.requests, recorded{Method: message.Method, Params: message.Params, Headers: r.Header.Clone()})

		if len(message.ID) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}

		if f.era == "legacy" && message.Method == "server/discover" {
			// What a handshake-era server does with a method it doesn't know.
			f.write(w, string(message.ID), "", `{"code":-32601,"message":"Method not found"}`)
			return
		}
		if f.era == "legacy" && message.Method == "initialize" && f.session != "" {
			w.Header().Set("Mcp-Session-Id", f.session)
		}

		result, ok := f.results[message.Method]
		if !ok {
			f.write(w, string(message.ID), "", `{"code":-32601,"message":"Method not found"}`)
			return
		}
		f.write(w, string(message.ID), result, "")
	}
}

func (f *fakeServer) write(w http.ResponseWriter, id, result, rpcError string) {
	payload := `{"jsonrpc":"2.0","id":` + id
	if rpcError != "" {
		payload += `,"error":` + rpcError + `}`
	} else {
		payload += `,"result":` + result + `}`
	}
	if f.sse {
		// SSE frames a message per line, so the payload must hold no newlines of
		// its own.
		var compact bytes.Buffer
		if json.Compact(&compact, []byte(payload)) == nil {
			payload = compact.String()
		}
		w.Header().Set("Content-Type", "text/event-stream")
		// A notification ahead of the response, which the client must step over.
		fmt.Fprint(w, ":\r\n\r\n")
		fmt.Fprint(w, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\","+
			"\"params\":{\"progressToken\":1,\"progress\":1,\"total\":2,\"message\":\"Reading\"}}\n\n")
		fmt.Fprint(w, "event: message\ndata: "+payload+"\n\n")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, payload)
}

func (f *fakeServer) asked(method string) *recorded {
	for i := range f.requests {
		if f.requests[i].Method == method {
			return &f.requests[i]
		}
	}
	return nil
}

const weatherTools = `{
  "resultType": "complete",
  "tools": [
    {
      "name": "get_weather",
      "title": "Weather Information Provider",
      "description": "Get current weather information for a location",
      "inputSchema": {
        "type": "object",
        "properties": {
          "location": {"type": "string", "description": "City name or zip code"},
          "units": {"type": "string", "enum": ["metric", "imperial"]},
          "days": {"type": "integer"}
        },
        "required": ["location"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "temperature": {"type": "number"},
          "conditions": {"type": "string"}
        },
        "required": ["temperature", "conditions"]
      }
    }
  ]
}`

const weatherResult = `{
  "resultType": "complete",
  "content": [{"type": "text", "text": "72°F, partly cloudy"}],
  "structuredContent": {"temperature": 22.5, "conditions": "Partly cloudy"},
  "isError": false
}`

func modernServer(t *testing.T, extra map[string]string) (*fakeServer, string) {
	t.Helper()
	results := map[string]string{
		"server/discover": `{"resultType":"complete","supportedVersions":["2026-07-28"],"capabilities":{"tools":{}},` +
			`"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"WeatherServer","version":"1.2.0"}},` +
			`"instructions":"Ask about the weather."}`,
		"tools/list": weatherTools,
		"tools/call": weatherResult,
	}
	for method, result := range extra {
		results[method] = result
	}
	fake := &fakeServer{era: "modern", results: results}
	server := httptest.NewServer(fake.handler())
	t.Cleanup(server.Close)
	return fake, server.URL + "/mcp"
}

func openApp(t *testing.T, endpoint string, parameters map[string]string) (*instance, *fakeApp) {
	t.Helper()
	if parameters == nil {
		parameters = map[string]string{}
	}
	parameters["url"] = endpoint
	logs := &fakeApp{}
	opened, err := New().Open(parameters, t.TempDir(), logs.log)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	in, ok := opened.Instance.(*instance)
	if !ok {
		t.Fatalf("expected an in-process instance, got %T", opened.Instance)
	}
	return in, logs
}

type fakeApp struct{ lines []string }

func (f *fakeApp) log(message string) { f.lines = append(f.lines, message) }

func TestOpenModernServer(t *testing.T) {
	fake, endpoint := modernServer(t, nil)
	in, logs := openApp(t, endpoint, nil)

	if len(in.methods) != 1 {
		t.Fatalf("expected one generated method, got %d", len(in.methods))
	}
	bound, ok := in.methods["mcp.Tools/GetWeather"]
	if !ok {
		t.Fatalf("expected mcp.Tools/GetWeather, got %v", methodPaths(in))
	}
	if bound.binding.name != "get_weather" || bound.binding.method != "tools/call" {
		t.Errorf("unexpected binding: %+v", bound.binding)
	}
	if !strings.Contains(strings.Join(logs.lines, "\n"), "WeatherServer") {
		t.Errorf("expected the server's name in the log, got %v", logs.lines)
	}

	// Every modern request carries its own protocol metadata, in the body and
	// mirrored into the headers.
	asked := fake.asked("tools/list")
	if asked == nil {
		t.Fatal("expected tools/list to have been asked")
	}
	var meta map[string]json.RawMessage
	if err := json.Unmarshal(asked.Params["_meta"], &meta); err != nil {
		t.Fatalf("expected _meta on the request: %v", err)
	}
	if got := string(meta[metaProtocolVersion]); got != `"`+ProtocolVersion+`"` {
		t.Errorf("protocol version = %s, want %q", got, ProtocolVersion)
	}
	if _, ok := meta[metaClientCapabilities]; !ok {
		t.Error("expected client capabilities in _meta")
	}
	if got := asked.Headers.Get("MCP-Protocol-Version"); got != ProtocolVersion {
		t.Errorf("MCP-Protocol-Version header = %q, want %q", got, ProtocolVersion)
	}
	if got := asked.Headers.Get("Mcp-Method"); got != "tools/list" {
		t.Errorf("Mcp-Method header = %q", got)
	}
	if !strings.Contains(asked.Headers.Get("Accept"), "text/event-stream") {
		t.Errorf("Accept = %q, want both JSON and the event stream", asked.Headers.Get("Accept"))
	}
}

func TestInvokeTool(t *testing.T) {
	fake, endpoint := modernServer(t, nil)
	in, _ := openApp(t, endpoint, nil)
	bound := in.methods["mcp.Tools/GetWeather"]

	request := encodeRequest(t, bound, `{"location":"Seattle","units":"metric","days":3}`)
	result, err := invoke(in, "mcp.Tools/GetWeather", request, map[string]string{"X-Tenant": "acme"})
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}

	call := fake.asked("tools/call")
	if call == nil {
		t.Fatal("expected tools/call")
	}
	if got := string(call.Params["name"]); got != `"get_weather"` {
		t.Errorf("tool name = %s", got)
	}
	// The request message is the tool's arguments, under the property names the
	// schema declared.
	var arguments map[string]any
	if err := json.Unmarshal(call.Params["arguments"], &arguments); err != nil {
		t.Fatalf("arguments: %v", err)
	}
	if arguments["location"] != "Seattle" || arguments["units"] != "metric" || arguments["days"] != float64(3) {
		t.Errorf("arguments = %v", arguments)
	}
	// The name the call addresses is mirrored into the routed header.
	if got := call.Headers.Get("Mcp-Name"); got != "get_weather" {
		t.Errorf("Mcp-Name = %q", got)
	}
	// The app's own headers ride along.
	if got := call.Headers.Get("X-Tenant"); got != "acme" {
		t.Errorf("X-Tenant = %q", got)
	}

	response := decodeResponseJSON(t, bound, result.Body)
	if !strings.Contains(response, "72°F, partly cloudy") {
		t.Errorf("response = %s", response)
	}
	if !strings.Contains(response, `"temperature":22.5`) {
		t.Errorf("expected the structured content in the response, got %s", response)
	}
	if result.ResponseHeaders == nil {
		t.Error("expected the exchanged headers to be surfaced")
	}
}

// A tool that fails is a result, not a transport failure: the run has to show
// what the tool said about it.
func TestInvokeToolExecutionError(t *testing.T) {
	_, endpoint := modernServer(t, map[string]string{
		"tools/call": `{"resultType":"complete","content":[{"type":"text","text":"Unknown city"}],"isError":true}`,
	})
	in, _ := openApp(t, endpoint, nil)
	bound := in.methods["mcp.Tools/GetWeather"]

	result, err := invoke(in, "mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Atlantis"}`), nil)
	if err != nil {
		t.Fatalf("a failing tool is a result, not an error: %v", err)
	}
	response := decodeResponseJSON(t, bound, result.Body)
	if !strings.Contains(response, `"isError":true`) || !strings.Contains(response, "Unknown city") {
		t.Errorf("response = %s", response)
	}
}

// A server that needs something back from the client can't be answered, so the
// call says so rather than reporting an empty result.
func TestInvokeInputRequired(t *testing.T) {
	_, endpoint := modernServer(t, map[string]string{
		"tools/call": `{"resultType":"input_required","inputRequests":{"login":{"method":"elicitation/create","params":{}}}}`,
	})
	in, _ := openApp(t, endpoint, nil)
	bound := in.methods["mcp.Tools/GetWeather"]

	_, err := invoke(in, "mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Seattle"}`), nil)
	if err == nil || !strings.Contains(err.Error(), "asked for input") {
		t.Fatalf("expected an input-required error, got %v", err)
	}
}

// The handshake era is what nearly every deployed server speaks today: the
// client falls back to it, and carries the session the server pins.
func TestLegacyHandshake(t *testing.T) {
	fake := &fakeServer{
		era:     "legacy",
		session: "sess-42",
		results: map[string]string{
			"initialize": `{"protocolVersion":"2025-06-18","capabilities":{"tools":{},"prompts":{}},` +
				`"serverInfo":{"name":"legacy-server","version":"0.1.0"}}`,
			"tools/list":   weatherTools,
			"tools/call":   weatherResult,
			"prompts/list": `{"prompts":[{"name":"review_code","description":"Review a diff","arguments":[{"name":"diff","required":true}]}]}`,
			"prompts/get":  `{"description":"Review","messages":[{"role":"user","content":{"type":"text","text":"Review this"}}]}`,
		},
	}
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	in, _ := openApp(t, server.URL+"/mcp", nil)

	if fake.asked("initialize") == nil {
		t.Fatal("expected the handshake")
	}
	if fake.asked("notifications/initialized") == nil {
		t.Error("expected the initialized notification")
	}
	// The version the server named is what every later request declares.
	if got := fake.asked("tools/list").Headers.Get("MCP-Protocol-Version"); got != "2025-06-18" {
		t.Errorf("MCP-Protocol-Version = %q, want the negotiated 2025-06-18", got)
	}
	if got := fake.asked("tools/list").Headers.Get("Mcp-Session-Id"); got != "sess-42" {
		t.Errorf("Mcp-Session-Id = %q, want the pinned session", got)
	}
	// The handshake era has no per-request metadata.
	if _, ok := fake.asked("tools/list").Params["_meta"]; ok {
		t.Error("a handshake-era request should carry no _meta")
	}

	// A prompt is a method too, with the arguments it declares.
	bound, ok := in.methods["mcp.Prompts/ReviewCode"]
	if !ok {
		t.Fatalf("expected mcp.Prompts/ReviewCode, got %v", methodPaths(in))
	}
	if _, err := invoke(in, "mcp.Prompts/ReviewCode", encodeRequest(t, bound, `{"diff":"-a +b"}`), nil); err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	get := fake.asked("prompts/get")
	var arguments map[string]string
	if err := json.Unmarshal(get.Params["arguments"], &arguments); err != nil {
		t.Fatalf("arguments: %v", err)
	}
	if arguments["diff"] != "-a +b" {
		t.Errorf("prompt arguments = %v", arguments)
	}
}

// A response may arrive as an event stream, with notifications ahead of it.
func TestStreamedResponse(t *testing.T) {
	fake, endpoint := modernServer(t, nil)
	fake.sse = true
	in, _ := openApp(t, endpoint, nil)
	bound := in.methods["mcp.Tools/GetWeather"]

	result, err := invoke(in, "mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Seattle"}`), nil)
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if !strings.Contains(decodeResponseJSON(t, bound, result.Body), "partly cloudy") {
		t.Error("expected the response carried on the event stream")
	}
}

func TestCredential(t *testing.T) {
	tests := []struct {
		name       string
		parameters map[string]string
		want       map[string]string
	}{
		{"bearer by default", map[string]string{"token": "t"}, map[string]string{"Authorization": "Bearer t"}},
		{"explicit bearer", map[string]string{"auth": "bearer", "token": "t"}, map[string]string{"Authorization": "Bearer t"}},
		{"api key", map[string]string{"auth": "apikey", "token": "k", "api_key_name": "X-Key"}, map[string]string{"X-Key": "k"}},
		{"api key default name", map[string]string{"auth": "apikey", "token": "k"}, map[string]string{"X-API-Key": "k"}},
		{"none", map[string]string{"auth": "none", "token": "t"}, nil},
		{"no token", map[string]string{"auth": "bearer"}, nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := Credential(test.parameters)
			if len(got) != len(test.want) {
				t.Fatalf("Credential() = %v, want %v", got, test.want)
			}
			for name, value := range test.want {
				if got[name] != value {
					t.Errorf("Credential()[%q] = %q, want %q", name, got[name], value)
				}
			}
		})
	}
}

func TestInspectClassifiesFailures(t *testing.T) {
	t.Run("wants a credential", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		}))
		defer server.Close()
		if _, problem := Inspect(map[string]string{"url": server.URL + "/mcp"}, nil); problem == nil || problem.Kind != ProblemUnauthorized {
			t.Fatalf("problem = %v, want unauthorized", problem)
		}
	})

	t.Run("not an MCP server", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprint(w, "<html><body>hello</body></html>")
		}))
		defer server.Close()
		if _, problem := Inspect(map[string]string{"url": server.URL}, nil); problem == nil || problem.Kind != ProblemNotMCP {
			t.Fatalf("problem = %v, want notMcp", problem)
		}
	})

	t.Run("nothing to explore", func(t *testing.T) {
		fake := &fakeServer{era: "modern", results: map[string]string{
			"server/discover": `{"resultType":"complete","capabilities":{"tools":{}},"_meta":{}}`,
			"tools/list":      `{"resultType":"complete","tools":[]}`,
		}}
		server := httptest.NewServer(fake.handler())
		defer server.Close()
		if _, problem := Inspect(map[string]string{"url": server.URL + "/mcp"}, nil); problem == nil || problem.Kind != ProblemEmpty {
			t.Fatalf("problem = %v, want empty", problem)
		}
	})

	t.Run("no endpoint", func(t *testing.T) {
		if _, problem := Inspect(map[string]string{"url": "  "}, nil); problem == nil || problem.Kind != ProblemTarget {
			t.Fatalf("problem = %v, want target", problem)
		}
	})
}

func TestInspectAsksForTheSignInBeforeReading(t *testing.T) {
	reached := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
	}))
	defer server.Close()

	parameters := map[string]string{"url": server.URL + "/mcp", "auth": AuthOAuth}
	_, problem := Inspect(parameters, testAuthorizer(t))
	if problem == nil || problem.Kind != ProblemSignIn {
		t.Fatalf("problem = %v, want signIn", problem)
	}
	if problem.Detail != "" {
		t.Errorf("detail = %q, want the step to say nothing more", problem.Detail)
	}
	if reached {
		t.Error("expected no request to a server kaja has no token for")
	}
}

func TestInspectReadsTheSurface(t *testing.T) {
	_, endpoint := modernServer(t, nil)
	surface, problem := Inspect(map[string]string{"url": endpoint}, nil)
	if problem != nil {
		t.Fatalf("Inspect: %v", problem)
	}
	if surface.ServerInfo.Name != "WeatherServer" || surface.ServerInfo.Version != "1.2.0" {
		t.Errorf("serverInfo = %+v", surface.ServerInfo)
	}
	if surface.Legacy {
		t.Error("a modern server should not report the handshake")
	}
	if len(surface.Tools) != 1 || surface.Instructions == "" {
		t.Errorf("surface = %+v", surface)
	}
}

// A call that fails at the HTTP layer is an HTTP failure, and the headers it
// exchanged are what a 401 is read through.
func TestInvokeUpstreamFailure(t *testing.T) {
	var opened bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if !opened {
			fake := &fakeServer{era: "modern", results: map[string]string{
				"server/discover": `{"resultType":"complete","capabilities":{"tools":{}},"_meta":{}}`,
				"tools/list":      weatherTools,
			}}
			var message struct {
				Method string `json:"method"`
			}
			_ = json.Unmarshal(body, &message)
			if message.Method != "tools/call" {
				r.Body = io.NopCloser(strings.NewReader(string(body)))
				fake.handler()(w, r)
				return
			}
		}
		http.Error(w, `{"message":"the token expired"}`, http.StatusUnauthorized)
	}))
	defer server.Close()

	in, _ := openApp(t, server.URL+"/mcp", nil)
	opened = true
	bound := in.methods["mcp.Tools/GetWeather"]

	_, err := invoke(in, "mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Seattle"}`), nil)
	var upstream *apps.UpstreamError
	if !asUpstream(err, &upstream) {
		t.Fatalf("expected an upstream error, got %v", err)
	}
	if upstream.Status != http.StatusUnauthorized || upstream.Message != "the token expired" {
		t.Errorf("upstream = %+v", upstream)
	}
	if upstream.RequestHeaders == nil {
		t.Error("expected the request headers on the failure")
	}
}

func methodPaths(in *instance) []string {
	paths := make([]string, 0, len(in.methods))
	for path := range in.methods {
		paths = append(paths, path)
	}
	return paths
}

// encodeRequest builds the protobuf request body a client would send, from the
// JSON shape of the generated request message.
func encodeRequest(t *testing.T, bound *boundMethod, requestJSON string) []byte {
	t.Helper()
	message := dynamicpb.NewMessage(bound.input)
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal([]byte(requestJSON), message); err != nil {
		t.Fatalf("encoding request %s: %v", requestJSON, err)
	}
	encoded, err := proto.Marshal(message)
	if err != nil {
		t.Fatalf("marshalling request: %v", err)
	}
	return encoded
}

func decodeResponseJSON(t *testing.T, bound *boundMethod, body []byte) string {
	t.Helper()
	message := dynamicpb.NewMessage(bound.output)
	if err := proto.Unmarshal(body, message); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	encoded, err := protojson.Marshal(message)
	if err != nil {
		t.Fatalf("encoding response: %v", err)
	}
	// protojson inserts non-breaking spaces at random to discourage exact
	// comparison; the tests only ever look for substrings.
	return strings.ReplaceAll(string(encoded), " ", " ")
}

// invoked is one call as these tests read it. Every app here answers with one message,
// so the stream a call hands back is collapsed to that message and the report beside it.
type invoked struct {
	Body            []byte
	RequestHeaders  map[string]string
	ResponseHeaders map[string]string
	Notices         []string
}

func invoke(in *instance, method string, request []byte, headers map[string]string) (*invoked, error) {
	stream, err := in.Invoke(context.Background(), &apps.Call{Method: method, Request: request, Headers: headers})
	if err != nil {
		return nil, err
	}
	body, err := stream.Recv()
	if err != nil {
		return nil, err
	}
	result := &invoked{Body: body}
	if report := stream.Report(); report != nil {
		result.RequestHeaders = report.RequestHeaders
		result.ResponseHeaders = report.ResponseHeaders
		result.Notices = report.Notices
	}
	return result, nil
}

// annotatedTools is a listing where one tool mirrors two of its parameters into
// headers and another mis-annotates one of its own.
const annotatedTools = `{
  "resultType": "complete",
  "tools": [
    {
      "name": "get_weather",
      "inputSchema": {
        "type": "object",
        "properties": {
          "location": {"type": "string"},
          "region": {"type": "string", "x-mcp-header": "Region"},
          "days": {"type": "integer", "x-mcp-header": "Days"}
        },
        "required": ["location"]
      }
    },
    {
      "name": "execute_sql",
      "inputSchema": {
        "type": "object",
        "properties": {
          "ratio": {"type": "number", "x-mcp-header": "Ratio"}
        }
      }
    }
  ]
}`

func TestMirrorsAnnotatedParametersIntoHeaders(t *testing.T) {
	fake, endpoint := modernServer(t, map[string]string{"tools/list": annotatedTools})
	in, _ := openApp(t, endpoint, nil)
	bound := in.methods["mcp.Tools/GetWeather"]

	request := encodeRequest(t, bound, `{"location":"Seattle","region":"us-west1","days":3}`)
	if _, err := invoke(in, "mcp.Tools/GetWeather", request, nil); err != nil {
		t.Fatalf("Invoke: %v", err)
	}

	call := fake.asked("tools/call")
	if call == nil {
		t.Fatal("expected tools/call")
	}
	if got := call.Headers.Get("Mcp-Param-Region"); got != "us-west1" {
		t.Errorf("Mcp-Param-Region = %q", got)
	}
	if got := call.Headers.Get("Mcp-Param-Days"); got != "3" {
		t.Errorf("Mcp-Param-Days = %q", got)
	}
}

// A parameter the call leaves out is a header the call leaves out, which is what
// a server validating the two against each other expects.
func TestOmitsHeadersForParametersNotGiven(t *testing.T) {
	fake, endpoint := modernServer(t, map[string]string{"tools/list": annotatedTools})
	in, _ := openApp(t, endpoint, nil)
	bound := in.methods["mcp.Tools/GetWeather"]

	request := encodeRequest(t, bound, `{"location":"Seattle"}`)
	if _, err := invoke(in, "mcp.Tools/GetWeather", request, nil); err != nil {
		t.Fatalf("Invoke: %v", err)
	}

	call := fake.asked("tools/call")
	if _, ok := call.Headers["Mcp-Param-Region"]; ok {
		t.Error("expected no Mcp-Param-Region header")
	}
	if _, ok := call.Headers["Mcp-Param-Days"]; ok {
		t.Error("expected no Mcp-Param-Days header")
	}
}

// A tool whose annotations break the rules is left out of the listing rather
// than taking the rest of the server's tools with it.
func TestDropsToolsWithInvalidAnnotations(t *testing.T) {
	_, endpoint := modernServer(t, map[string]string{"tools/list": annotatedTools})
	in, logs := openApp(t, endpoint, nil)

	if _, ok := in.methods["mcp.Tools/GetWeather"]; !ok {
		t.Error("expected the valid tool to be offered")
	}
	if _, ok := in.methods["mcp.Tools/ExecuteSql"]; ok {
		t.Error("expected the mis-annotated tool to be left out")
	}
	said := strings.Join(logs.lines, "\n")
	if !strings.Contains(said, `Left out the tool "execute_sql"`) {
		t.Errorf("expected the log to name the tool it left out, got %s", said)
	}
}

// The mirrored headers are the modern transport's. A handshake-era server never
// declared them, so nothing is sent it would have to validate.
func TestLegacyServerIsSentNoMirroredHeaders(t *testing.T) {
	fake := &fakeServer{
		era: "legacy",
		results: map[string]string{
			"initialize": `{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},` +
				`"serverInfo":{"name":"legacy-server","version":"0.1.0"}}`,
			"tools/list": annotatedTools,
			"tools/call": weatherResult,
		},
	}
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	in, _ := openApp(t, server.URL+"/mcp", nil)
	bound := in.methods["mcp.Tools/GetWeather"]
	request := encodeRequest(t, bound, `{"location":"Seattle","region":"us-west1"}`)
	if _, err := invoke(in, "mcp.Tools/GetWeather", request, nil); err != nil {
		t.Fatalf("Invoke: %v", err)
	}

	call := fake.asked("tools/call")
	if _, ok := call.Headers["Mcp-Param-Region"]; ok {
		t.Error("expected no Mcp-Param-Region header")
	}
}

// A server that streams its answer may say something on the way there. A call
// that reports nothing for a minute is indistinguishable from one that failed,
// so what it said rides back with the exchange that carried it.
func TestReportsWhatTheServerSaidWhileWorking(t *testing.T) {
	fake, endpoint := modernServer(t, nil)
	fake.sse = true
	in, _ := openApp(t, endpoint, nil)
	bound := in.methods["mcp.Tools/GetWeather"]

	result, err := invoke(in, "mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Seattle"}`), nil)
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if len(result.Notices) == 0 {
		t.Fatal("expected the call to report what the server said")
	}
}

// A legacy server that has forgotten the session refuses the next request. The
// specification says so with a 404; the reference server says so with a 400 that
// names the session; and both put a JSON-RPC error under the status. The client
// handshakes again and repeats the request, once.
func TestRecoversALostSession(t *testing.T) {
	for _, refusal := range []struct {
		name   string
		status int
		body   string
	}{
		{"404 with the specification's error", http.StatusNotFound, `{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"Session not found"}}`},
		{"400 naming the session", http.StatusBadRequest, `{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"Bad Request: No valid session ID provided"}}`},
		{"404 with no body", http.StatusNotFound, ""},
	} {
		t.Run(refusal.name, func(t *testing.T) {
			fake := &fakeServer{era: "legacy", session: "first", results: map[string]string{
				"initialize": `{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"Legacy","version":"1"}}`,
				"tools/list": weatherTools,
				"tools/call": weatherResult,
			}}
			forgotten := false
			handshakes := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				r.Body = io.NopCloser(bytes.NewReader(body))
				if strings.Contains(string(body), `"initialize"`) {
					handshakes++
					fake.session = fmt.Sprintf("session-%d", handshakes)
				}
				if forgotten && r.Header.Get("Mcp-Session-Id") == "session-1" {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(refusal.status)
					fmt.Fprint(w, refusal.body)
					return
				}
				fake.handler()(w, r)
			}))
			defer server.Close()

			in, _ := openApp(t, server.URL+"/mcp", nil)
			bound := in.methods["mcp.Tools/GetWeather"]
			forgotten = true

			result, err := invoke(in, "mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Seattle"}`), nil)
			if err != nil {
				t.Fatalf("expected the call to be repeated on a fresh session, got %v", err)
			}
			if !strings.Contains(decodeResponseJSON(t, bound, result.Body), "Partly cloudy") {
				t.Errorf("response = %s", result.Body)
			}
			if handshakes != 2 {
				t.Errorf("handshakes = %d, want 2", handshakes)
			}
			if got := fake.requests[len(fake.requests)-1].Headers.Get("Mcp-Session-Id"); got != "session-2" {
				t.Errorf("the repeated call was sent under session %q", got)
			}
		})
	}
}

// A server that keeps the stream open after answering, sending keep-alives, must
// not hold the call until it times out: the response is the end of what is read.
func TestStopsReadingAtTheResponse(t *testing.T) {
	fake := &fakeServer{era: "modern", sse: true, results: map[string]string{
		"server/discover": `{"resultType":"complete","supportedVersions":["2026-07-28"],"capabilities":{"tools":{}},"_meta":{}}`,
		"tools/list":      weatherTools,
		"tools/call":      weatherResult,
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.handler()(w, r)
		flusher, _ := w.(http.Flusher)
		for {
			select {
			case <-r.Context().Done():
				return
			case <-time.After(50 * time.Millisecond):
				fmt.Fprint(w, ": keepalive\n\n")
				if flusher != nil {
					flusher.Flush()
				}
			}
		}
	}))
	defer server.Close()

	started := time.Now()
	in, _ := openApp(t, server.URL+"/mcp", nil)
	bound := in.methods["mcp.Tools/GetWeather"]
	result, err := invoke(in, "mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Seattle"}`), nil)
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if !strings.Contains(decodeResponseJSON(t, bound, result.Body), "Partly cloudy") {
		t.Errorf("response = %s", result.Body)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Errorf("opening and calling took %s: the client waited for a stream that never ends", elapsed)
	}
}

// A server reports progress only to a caller that asked, and a call is what asks:
// a listing has nothing to report on.
func TestAsksForProgressOnACall(t *testing.T) {
	fake, endpoint := modernServer(t, nil)
	in, _ := openApp(t, endpoint, nil)
	bound := in.methods["mcp.Tools/GetWeather"]
	if _, err := invoke(in, "mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Seattle"}`), nil); err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	token := func(method string) string {
		var meta map[string]json.RawMessage
		_ = json.Unmarshal(fake.asked(method).Params["_meta"], &meta)
		return string(meta["progressToken"])
	}
	if token("tools/call") == "" {
		t.Error("expected tools/call to carry a progress token")
	}
	if token("tools/list") != "" {
		t.Error("expected tools/list to carry no progress token")
	}
}

// A JSON-RPC error is the server's own refusal of a call it received: the exchange
// succeeded, and what the client is shown is the server's code and message, with
// the error object as the body.
func TestRefusalIsTheServersOwn(t *testing.T) {
	_, endpoint := modernServer(t, nil)
	in, _ := openApp(t, endpoint, nil)
	bound := in.methods["mcp.Tools/GetWeather"]

	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Unknown location","data":{"field":"location"}}}`)
	}))
	defer refusing.Close()
	in.client.endpoint = refusing.URL + "/mcp"

	_, err := invoke(in, "mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Atlantis"}`), nil)
	var upstream *apps.UpstreamError
	if !asUpstream(err, &upstream) {
		t.Fatalf("expected the refusal as an upstream error, got %v", err)
	}
	if upstream.Code != "INVALID_PARAMS" || upstream.Message != "Unknown location" || upstream.Status != http.StatusOK || !upstream.Unreadable {
		t.Errorf("upstream = %+v", upstream)
	}
	if !strings.Contains(string(upstream.Body), `"field":"location"`) {
		t.Errorf("body = %s", upstream.Body)
	}
	if upstream.RequestHeaders == nil {
		t.Error("expected the request headers on the refusal")
	}
}

// A variable this kaja doesn't define leaves the endpoint unreadable here, which
// is not the server's fault and not a reason to refuse the app.
func TestInspectNamesAnUnresolvedVariable(t *testing.T) {
	_, problem := Inspect(map[string]string{"url": "${MCP_URL}/mcp"}, nil)
	if problem == nil || problem.Kind != ProblemUnresolved || !strings.Contains(problem.Message, "MCP_URL") {
		t.Fatalf("problem = %+v", problem)
	}
}

// An endpoint of the older transport refuses the POST and answers a GET with the
// event naming its message endpoint, which is how it is told from a path nothing
// serves.
func TestInspectRecognisesTheLegacyTransport(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "<!DOCTYPE html><html><body><pre>Cannot POST /sse</pre></body></html>", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "event: endpoint\ndata: /message?sessionId=abc\n\n")
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-r.Context().Done()
	}))
	defer server.Close()

	_, problem := Inspect(map[string]string{"url": server.URL + "/sse"}, nil)
	if problem == nil || problem.Kind != ProblemLegacySSE {
		t.Fatalf("problem = %+v", problem)
	}
	if strings.Contains(problem.Detail, "<") {
		t.Errorf("the detail carries the markup: %s", problem.Detail)
	}
}

package mcp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
		fmt.Fprint(w, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{}}\n\n")
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
	result, err := in.Invoke("mcp.Tools/GetWeather", request, map[string]string{"X-Tenant": "acme"})
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

	result, err := in.Invoke("mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Atlantis"}`), nil)
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

	_, err := in.Invoke("mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Seattle"}`), nil)
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
	if _, err := in.Invoke("mcp.Prompts/ReviewCode", encodeRequest(t, bound, `{"diff":"-a +b"}`), nil); err != nil {
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

	result, err := in.Invoke("mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Seattle"}`), nil)
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
		if _, problem := Inspect(map[string]string{"url": server.URL + "/mcp"}); problem == nil || problem.Kind != ProblemUnauthorized {
			t.Fatalf("problem = %v, want unauthorized", problem)
		}
	})

	t.Run("not an MCP server", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprint(w, "<html><body>hello</body></html>")
		}))
		defer server.Close()
		if _, problem := Inspect(map[string]string{"url": server.URL}); problem == nil || problem.Kind != ProblemNotMCP {
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
		if _, problem := Inspect(map[string]string{"url": server.URL + "/mcp"}); problem == nil || problem.Kind != ProblemEmpty {
			t.Fatalf("problem = %v, want empty", problem)
		}
	})

	t.Run("no endpoint", func(t *testing.T) {
		if _, problem := Inspect(map[string]string{"url": "  "}); problem == nil || problem.Kind != ProblemTarget {
			t.Fatalf("problem = %v, want target", problem)
		}
	})
}

func TestInspectReadsTheSurface(t *testing.T) {
	_, endpoint := modernServer(t, nil)
	surface, problem := Inspect(map[string]string{"url": endpoint})
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

	_, err := in.Invoke("mcp.Tools/GetWeather", encodeRequest(t, bound, `{"location":"Seattle"}`), nil)
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

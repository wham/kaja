package router

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	internalgrpc "github.com/wham/kaja/v2/internal/grpc"
	"github.com/wham/kaja/v2/pkg/api"
	googlegrpc "google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// The traces in docs/network-stack.md, run rather than read. Every case here goes the
// whole way — router.Mount, grpc.Serve, InvokeApp, a real app, an upstream that
// records what it was sent — so the section the doc calls "What never crosses which
// line" is a set of assertions instead of a set of claims. A layer's own test can only
// say what that layer does with what it was handed; which values reach the wire is a
// property of the lane as a whole.

const (
	// appName is the app the calls below belong to, and the only address the client
	// has: it rides as X-Kaja-App and is taken back out at the door.
	appName = "quirks"
	// method is any method — nothing in the lane reads it beyond routing the upstream
	// request, and a Twirp app posts the bytes the client framed whatever it is named.
	method = "quirks.v1.Quirks/Sum"
	// tokenValue is written nowhere in kaja.json: the workspace holds "${secret}" and
	// this machine's environment holds the value, which is the whole reason the
	// browser may never be told it.
	tokenValue = "s3cr3t-token-value"
)

// workspace is a kaja serving one Twirp app pointed at upstreamURL, with a TOKEN
// variable whose value lives outside kaja.json. It hands back the mux both builds
// mount — the web server's and the desktop webview's are this one.
func workspace(t *testing.T, upstreamURL string) *http.ServeMux {
	t.Helper()
	entry := fmt.Sprintf(`{"name": %q, "twirp": {"url": %q, "proto_dir": "proto"}}`, appName, upstreamURL)
	return workspaceWith(t, entry, appName, "twirp", map[string]string{"url": upstreamURL, "proto_dir": "proto"})
}

// workspaceWith is that workspace for any one app: the entry as kaja.json carries it,
// and the parameters the door will invoke it with. The TOKEN variable's value lives
// outside the file whatever the app is, which is the whole reason the browser may
// never be told it.
func workspaceWith(t *testing.T, entry string, name string, appType string, parameters map[string]string) *http.ServeMux {
	t.Helper()
	t.Setenv("KAJA_TOKEN", tokenValue)

	configuration := fmt.Sprintf(`{
		"variables": {"TOKEN": "${secret}"},
		"apps": [%s]
	}`, entry)
	path := t.TempDir() + "/kaja.json"
	if err := os.WriteFile(path, []byte(configuration), 0o600); err != nil {
		t.Fatalf("write configuration: %v", err)
	}

	service := api.NewApiService(path, false, "", "", nil)
	// What OpenApp does once it has flattened the app's typed parameters. Compiling
	// the proto surface is the other half of that RPC and no part of a call.
	if _, err := service.Apps().Open(name, appType, parameters, t.TempDir(), func(string) {}); err != nil {
		t.Fatalf("open app: %v", err)
	}

	mux := http.NewServeMux()
	Mount(mux, service)
	return mux
}

// exchange is one call as both ends saw it: what the upstream was asked, and what came
// back down the lane.
type exchange struct {
	upstream *http.Request
	body     []byte
	messages [][]byte
	trailers string
}

// call makes the request the client makes: gRPC-Web at /app, every header the call
// carries under an X-Header- prefix with its ${NAME} references intact, and the app's
// name among them.
func call(t *testing.T, mux *http.ServeMux, headers map[string]string) exchange {
	t.Helper()
	return callApp(t, mux, appName, method, []byte("request"), headers)
}

// callApp is that call against any app: the one the client names in the reserved
// header, the method it names in the path, and the request bytes it framed.
func callApp(t *testing.T, mux *http.ServeMux, app string, method string, message []byte, headers map[string]string) exchange {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/app/"+method, bytes.NewReader(frame(0, message)))
	request.Header.Set("Content-Type", "application/grpc-web+proto")
	request.Header.Set("X-Header-X-Kaja-App", app)
	for name, value := range headers {
		request.Header.Set("X-Header-"+name, value)
	}

	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)

	body := recorder.Body.Bytes()
	messages, trailers := parseFrames(t, body)
	return exchange{body: body, messages: messages, trailers: trailers}
}

func (e exchange) upstreamOf(t *testing.T) map[string]any {
	t.Helper()
	envelope := map[string]any{}
	if err := json.Unmarshal([]byte(e.trailer(t, internalgrpc.UpstreamTrailer)), &envelope); err != nil {
		t.Fatalf("upstream trailer: %v\ntrailers = %q", err, e.trailers)
	}
	return envelope
}

func (e exchange) trailer(t *testing.T, name string) string {
	t.Helper()
	for _, line := range strings.Split(e.trailers, "\r\n") {
		key, value, found := strings.Cut(line, ": ")
		if !found || key != name {
			continue
		}
		decoded, err := url.QueryUnescape(value)
		if err != nil {
			t.Fatalf("trailer %q is not valid percent-encoding: %v", name, err)
		}
		return decoded
	}
	t.Fatalf("trailer %q missing from %q", name, e.trailers)
	return ""
}

func headersOf(t *testing.T, envelope map[string]any, key string) map[string]any {
	t.Helper()
	headers, ok := envelope[key].(map[string]any)
	if !ok {
		t.Fatalf("%s = %#v, want a header set", key, envelope[key])
	}
	return headers
}

var traces = []struct {
	// name is the line in docs/network-stack.md this case makes executable.
	name   string
	answer func(w http.ResponseWriter)
	check  func(t *testing.T, e exchange)
}{
	{
		name: "X-Kaja-App never reaches an upstream",
		answer: func(w http.ResponseWriter) {
			w.Write([]byte("response"))
		},
		check: func(t *testing.T, e exchange) {
			for name := range e.upstream.Header {
				if strings.Contains(strings.ToLower(name), "kaja") {
					t.Errorf("upstream was sent %q, and the app's name is the browser's whole address", name)
				}
			}
			if len(e.messages) != 1 || string(e.messages[0]) != "response" {
				t.Errorf("messages = %q, want the one the upstream answered with", e.messages)
			}
		},
	},
	{
		name: "a ${NAME} is expanded on the way out and redacted on the way back",
		answer: func(w http.ResponseWriter) {
			w.Write([]byte("response"))
		},
		check: func(t *testing.T, e exchange) {
			if got := e.upstream.Header.Get("Authorization"); got != "Bearer "+tokenValue {
				t.Errorf("upstream Authorization = %q, want the resolved value", got)
			}
			request := headersOf(t, e.upstreamOf(t), "requestHeaders")
			if request["Authorization"] != "Bearer ${TOKEN}" {
				t.Errorf("reported Authorization = %#v, want the reference the client sent", request["Authorization"])
			}
		},
	},
	{
		name: "an upstream HTTP failure arrives as the failure it was, not as the status it was tunnelled through",
		answer: func(w http.ResponseWriter) {
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"code":"resource_exhausted","msg":"slow down"}`))
		},
		check: func(t *testing.T, e exchange) {
			if len(e.messages) != 0 {
				t.Errorf("messages = %q, want none on a failure", e.messages)
			}
			if got := e.trailer(t, "grpc-status"); got != "8" {
				t.Errorf("grpc-status = %q, want 8 (RESOURCE_EXHAUSTED)", got)
			}
			envelope := e.upstreamOf(t)
			failure, ok := envelope["error"].(map[string]any)
			if !ok {
				t.Fatalf("error = %#v, want the HTTP failure whole", envelope["error"])
			}
			if failure["status"] != float64(http.StatusTooManyRequests) {
				t.Errorf("status = %#v, want 429", failure["status"])
			}
			if failure["message"] != "slow down" {
				t.Errorf("message = %#v, want the one the API sent", failure["message"])
			}
			body, _ := failure["body"].(map[string]any)
			if body["code"] != "resource_exhausted" {
				t.Errorf("body = %#v, want the API's own answer", failure["body"])
			}
			if headersOf(t, envelope, "responseHeaders")["Retry-After"] != "30" {
				t.Errorf("responseHeaders = %#v, want what the API answered with", envelope["responseHeaders"])
			}
		},
	},
	{
		name: "the duration is the hop Kaja measured, not the trip the browser made",
		answer: func(w http.ResponseWriter) {
			time.Sleep(20 * time.Millisecond)
			w.Write([]byte("response"))
		},
		check: func(t *testing.T, e exchange) {
			duration, ok := e.upstreamOf(t)["durationMs"].(float64)
			if !ok {
				t.Fatalf("durationMs missing: %q", e.trailers)
			}
			if duration < 10 {
				t.Errorf("durationMs = %v, want the upstream exchange it timed", duration)
			}
		},
	},
}

func TestTraces(t *testing.T) {
	for _, trace := range traces {
		t.Run(trace.name, func(t *testing.T) {
			var seen *http.Request
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				io.Copy(io.Discard, r.Body)
				seen = r
				trace.answer(w)
			}))
			t.Cleanup(upstream.Close)

			e := call(t, workspace(t, upstream.URL), map[string]string{"Authorization": "Bearer ${TOKEN}"})
			e.upstream = seen
			if e.upstream == nil {
				t.Fatalf("the upstream was never called\nresponse = %q", e.body)
			}

			// Whatever else a trace asserts, the resolved value is not in what came
			// back: a variable kaja.json does not carry is one no browser is told,
			// and that holds for a failure as much as for a response.
			if bytes.Contains(e.body, []byte(tokenValue)) {
				t.Errorf("the resolved value reached the client: %q", e.body)
			}

			trace.check(t, e)
		})
	}
}

// TestForwardedServerCannotWriteIntoKajasChannel is the one invariant the forwarded
// lane owns alone: there the upstream's own metadata rides back under its own names,
// which is the one place something outside this process writes into the trailer block
// Kaja's channel is in. A server answering with kaja-upstream of its own would be a
// duration, an exchange and a failure the client reads as this process's.
func TestForwardedServerCannotWriteIntoKajasChannel(t *testing.T) {
	address := grpcUpstream(t, func(_ []byte, stream googlegrpc.ServerStream) error {
		stream.SetTrailer(metadata.Pairs(
			internalgrpc.UpstreamTrailer, `{"durationMs":1,"requestHeaders":{"Authorization":"Bearer spoofed"}}`,
			"kaja-upstream-duration-ms", "1",
			"x-ratelimit-remaining", "0",
		))
		return stream.SendMsg([]byte("response"))
	})

	path := t.TempDir() + "/kaja.json"
	if err := os.WriteFile(path, []byte(`{}`), 0o600); err != nil {
		t.Fatalf("write configuration: %v", err)
	}
	service := api.NewApiService(path, false, "", "", nil)
	if _, err := service.Apps().Open(appName, "grpc", map[string]string{"url": address, "proto_dir": "unused"}, t.TempDir(), func(string) {}); err != nil {
		t.Fatalf("open app: %v", err)
	}
	mux := http.NewServeMux()
	Mount(mux, service)

	e := call(t, mux, nil)

	if got := strings.Count(e.trailers, internalgrpc.UpstreamTrailer+":"); got != 1 {
		t.Fatalf("%d %s trailers, want only Kaja's own\ntrailers = %q", got, internalgrpc.UpstreamTrailer, e.trailers)
	}
	if strings.Contains(e.trailers, "spoofed") || strings.Contains(e.trailers, "kaja-upstream-duration-ms") {
		t.Errorf("the upstream wrote into Kaja's channel: %q", e.trailers)
	}
	if request, ok := e.upstreamOf(t)["requestHeaders"]; ok {
		t.Errorf("requestHeaders = %#v, want the forwarded call's own hop, which has none", request)
	}
	// What the server said of its own still comes through: dropping the channel's
	// names is not dropping the server's metadata.
	if got := e.trailer(t, "x-ratelimit-remaining"); got != "0" {
		t.Errorf("x-ratelimit-remaining = %q, want the server's own", got)
	}
}

// grpcUpstream runs a gRPC server answering every method with handle, and returns the
// address a grpc app reaches it at. A forwarded call is never decoded, so the codec
// carries the bytes through and no service is registered: a test answers a method no
// proto declares.
func grpcUpstream(t *testing.T, handle func(request []byte, stream googlegrpc.ServerStream) error) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := googlegrpc.NewServer(
		googlegrpc.ForceServerCodec(passthroughCodec{}),
		googlegrpc.UnknownServiceHandler(func(_ any, stream googlegrpc.ServerStream) error {
			var request []byte
			if err := stream.RecvMsg(&request); err != nil {
				return err
			}
			return handle(request, stream)
		}),
	)
	go server.Serve(listener)
	t.Cleanup(server.Stop)

	return "http://" + listener.Addr().String()
}

type passthroughCodec struct{}

func (passthroughCodec) Marshal(v any) ([]byte, error) {
	if b, ok := v.([]byte); ok {
		return b, nil
	}
	return nil, fmt.Errorf("unsupported type: %T", v)
}

func (passthroughCodec) Unmarshal(data []byte, v any) error {
	if b, ok := v.(*[]byte); ok {
		*b = append([]byte(nil), data...)
		return nil
	}
	return fmt.Errorf("unsupported type: %T", v)
}

func (passthroughCodec) Name() string { return "proto" }

// frame wraps a payload in its gRPC-Web frame header: a flag byte, then the length as
// a big-endian uint32.
func frame(flag byte, payload []byte) []byte {
	framed := []byte{flag, 0, 0, 0, 0}
	binary.BigEndian.PutUint32(framed[1:5], uint32(len(payload)))
	return append(framed, payload...)
}

// parseFrames splits a gRPC-Web response into its messages and the text of its trailer
// frame.
func parseFrames(t *testing.T, body []byte) (messages [][]byte, trailers string) {
	t.Helper()
	for len(body) >= 5 {
		flag := body[0]
		n := binary.BigEndian.Uint32(body[1:5])
		if uint32(len(body)-5) < n {
			t.Fatalf("frame says %d bytes, %d left", n, len(body)-5)
		}
		if payload := body[5 : 5+n]; flag&0x80 != 0 {
			trailers = string(payload)
		} else {
			messages = append(messages, payload)
		}
		body = body[5+n:]
	}
	return messages, trailers
}

// The traces above run on the app that forwards the bytes the client framed. The three
// tests below are the same lane with something else at the end of it — an app that
// builds its own HTTP request out of a document, one that speaks a protocol of its
// own, and one that answers in this process without an upstream at all — because the
// door's rules are the door's rather than any app's.

const ordersSpec = `
openapi: 3.0.0
info:
  title: Orders
  version: "1.0"
paths:
  /orders:
    get:
      operationId: listOrders
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  total:
                    type: integer
`

// A transcoded call is a request kaja builds rather than one it passes on, so nothing
// the client framed reaches the wire by simply being left alone: the reserved header
// has to be gone because the door took it out, and the resolved credential has to be
// there because the door put it there.
func TestATranscodedCallCarriesTheDoorsRules(t *testing.T) {
	var seen *http.Request
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"total":2}`))
	}))
	t.Cleanup(upstream.Close)

	parameters := map[string]string{"spec_content": ordersSpec, "base_url": upstream.URL}
	entry := fmt.Sprintf(`{"name": "orders", "openapi": {"spec_content": %s, "base_url": %q}}`, strconv.Quote(ordersSpec), upstream.URL)
	mux := workspaceWith(t, entry, "orders", "openapi", parameters)

	e := callApp(t, mux, "orders", "orders.Orders/ListOrders", nil, map[string]string{"Authorization": "Bearer ${TOKEN}"})

	if seen == nil {
		t.Fatalf("the upstream was never called\nresponse = %q", e.body)
	}
	if seen.URL.Path != "/orders" {
		t.Errorf("upstream path = %q, want the one the document binds the method to", seen.URL.Path)
	}
	for name := range seen.Header {
		if strings.Contains(strings.ToLower(name), "kaja") {
			t.Errorf("upstream was sent %q, and the app's name is the browser's whole address", name)
		}
	}
	if got := seen.Header.Get("Authorization"); got != "Bearer "+tokenValue {
		t.Errorf("upstream Authorization = %q, want the resolved value", got)
	}
	if bytes.Contains(e.body, []byte(tokenValue)) {
		t.Errorf("the resolved value reached the client: %q", e.body)
	}
	if request := headersOf(t, e.upstreamOf(t), "requestHeaders"); request["Authorization"] != "Bearer ${TOKEN}" {
		t.Errorf("reported Authorization = %#v, want the reference the client sent", request["Authorization"])
	}
	if len(e.messages) != 1 {
		t.Errorf("messages = %q, want the one the API answered with", e.messages)
	}
}

// An app that speaks a protocol of its own is the same call to the door: the headers
// it carries are the door's to expand and redact, whatever the app wraps them around.
func TestAnAppSpeakingItsOwnProtocolCarriesTheDoorsRules(t *testing.T) {
	var invoked *http.Request
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var message struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		json.Unmarshal(body, &message)
		if len(message.ID) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		if message.Method == "tools/call" {
			invoked = r
		}
		result, ok := mcpResults[message.Method]
		w.Header().Set("Content-Type", "application/json")
		if !ok {
			// What a server that doesn't know the method says, which for the modern
			// era's probe is what settles the client on the handshake instead.
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"Method not found"}}`, message.ID)
			return
		}
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":%s}`, message.ID, result)
	}))
	t.Cleanup(upstream.Close)

	entry := fmt.Sprintf(`{"name": "orders", "mcp": {"url": %q}}`, upstream.URL)
	mux := workspaceWith(t, entry, "orders", "mcp", map[string]string{"url": upstream.URL})

	e := callApp(t, mux, "orders", "mcp.Tools/ListOrders", nil, map[string]string{"Authorization": "Bearer ${TOKEN}"})

	if invoked == nil {
		t.Fatalf("the tool was never called\nresponse = %q", e.body)
	}
	for name := range invoked.Header {
		if strings.Contains(strings.ToLower(name), "kaja") {
			t.Errorf("upstream was sent %q, and the app's name is the browser's whole address", name)
		}
	}
	if got := invoked.Header.Get("Authorization"); got != "Bearer "+tokenValue {
		t.Errorf("upstream Authorization = %q, want the resolved value", got)
	}
	if bytes.Contains(e.body, []byte(tokenValue)) {
		t.Errorf("the resolved value reached the client: %q", e.body)
	}
	if request := headersOf(t, e.upstreamOf(t), "requestHeaders"); request["Authorization"] != "Bearer ${TOKEN}" {
		t.Errorf("reported Authorization = %#v, want the reference the client sent", request["Authorization"])
	}
}

// What a server answers the calls an mcp app opens with, and the one tool it exposes.
var mcpResults = map[string]string{
	"initialize": `{"protocolVersion":"2025-06-18","serverInfo":{"name":"orders","version":"1"},"capabilities":{"tools":{}}}`,
	"tools/list": `{"tools":[{"name":"list_orders","description":"Lists orders","inputSchema":{"type":"object","properties":{}}}]}`,
	"tools/call": `{"content":[{"type":"text","text":"two"}]}`,
}

// A local app makes no upstream call at all, and the lane says so: the door still
// times what it carried, and the exchange it reports is empty rather than invented.
func TestALocalAppReportsNoHop(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "notes.md"), []byte("x"), 0o600); err != nil {
		t.Fatalf("write file: %v", err)
	}

	entry := fmt.Sprintf(`{"name": "files", "folder": {"path": %q}}`, directory)
	mux := workspaceWith(t, entry, "files", "folder", map[string]string{"path": directory})

	e := callApp(t, mux, "files", "folder.Folder/ListFolder", nil, map[string]string{"Authorization": "Bearer ${TOKEN}"})

	if len(e.messages) != 1 || !bytes.Contains(e.messages[0], []byte("notes.md")) {
		t.Fatalf("messages = %q, want the folder it listed", e.messages)
	}
	if bytes.Contains(e.body, []byte(tokenValue)) {
		t.Errorf("the resolved value reached the client: %q", e.body)
	}
	envelope := e.upstreamOf(t)
	if _, ok := envelope["durationMs"].(float64); !ok {
		t.Errorf("durationMs missing: %q", e.trailers)
	}
	for _, key := range []string{"requestHeaders", "responseHeaders", "error"} {
		if value, ok := envelope[key]; ok {
			t.Errorf("%s = %#v, want nothing: a call that never left this process made no exchange", key, value)
		}
	}
}

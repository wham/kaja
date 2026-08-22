// Package mcp implements the Model Context Protocol server that lets an agent
// read, write, and run the user's Kaja scripts and discover the services they
// can call. It speaks JSON-RPC 2.0 over HTTP (the MCP "Streamable HTTP"
// transport) and reaches the app it serves only through the Bridge interface, so
// it is the same server in both builds: the desktop process bridges it to its
// own webview, and the web server bridges it to a browser that attached itself
// to an agent session. It has no Wails dependency and is unit-testable on its
// own.
//
// This is kaja's own MCP server — the door an agent drives kaja through. The MCP
// *app* (pkg/apps/mcp) points the other way, at somebody else's server. The two
// share the protocol's name and nothing else.
package mcp

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// protocolVersion is the MCP revision this server implements. When a client
// announces a different version we echo back our own and let it decide.
const protocolVersion = "2025-06-18"

//go:embed guide.md
var guide string

// ScriptInfo is a script on disk. Content is populated only where it makes
// sense (reads, creates, renames).
type ScriptInfo struct {
	Path string `json:"path"`
	Name string `json:"name"`
	// The folder the script is filed in, relative to the workspace's scripts
	// root. Empty for one at the root.
	Folder  string `json:"folder,omitempty"`
	Content string `json:"content,omitempty"`
}

// MethodCallLog is a single RPC made while a script ran, mirrored from the UI so
// the agent can see what the script actually did.
type MethodCallLog struct {
	App        string          `json:"app,omitempty"`
	Service    string          `json:"service"`
	Method     string          `json:"method"`
	DurationMs float64         `json:"durationMs,omitempty"`
	Input      json.RawMessage `json:"input,omitempty"`
	Output     json.RawMessage `json:"output,omitempty"`
	Failure    *CallFailure    `json:"failure,omitempty"`
}

// CallFailure is why a call failed, in the one distinction a caller can act on:
// whether to change the request, the credentials, or nothing at all. Classified
// in the UI (callFailure.ts), where the thrown error still has its shape.
type CallFailure struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Status  int    `json:"status,omitempty"`
	Code    string `json:"code,omitempty"`
}

// BlockLog is something the script drew on the run's canvas. The agent has the
// contents already - it produced them - so this is the shape of what it made,
// which is the receipt that the drawing landed.
type BlockLog struct {
	Kind    string   `json:"kind"`
	Label   string   `json:"label,omitempty"`
	Columns []string `json:"columns,omitempty"`
	Rows    int      `json:"rows,omitempty"`
	// Cells of a table that hold no value: the ones still to be fetched, and the
	// ones that stopped. A table with holes in it must say so rather than read
	// as a table of blanks.
	Pending int `json:"pending,omitempty"`
	Failed  int `json:"failed,omitempty"`
}

// RunResult is the outcome of running a script in the webview. Result is what a
// script returned, which is nothing a script is supposed to do - it is carried
// so the report can say so rather than swallow it (see renderRun).
type RunResult struct {
	Console     []string        `json:"console,omitempty"`
	Result      json.RawMessage `json:"result,omitempty"`
	Error       string          `json:"error,omitempty"`
	MethodCalls []MethodCallLog `json:"methodCalls,omitempty"`
	Blocks      []BlockLog      `json:"blocks,omitempty"`
}

// Bridge is everything the server needs from the host app. The desktop App
// implements it; tests supply a fake.
type Bridge interface {
	ListScripts() ([]ScriptInfo, error)
	ReadScript(path string) (string, error)
	WriteScript(path, content string) error
	CreateScript(name, content string) (ScriptInfo, error)
	RenameScript(path, newName string) (ScriptInfo, error)
	DeleteScript(path string) error
	// RunScript executes a script in the webview and returns what it produced.
	// Exactly one of path or code is set. client is what the agent calls itself,
	// which is what the draft an inline snippet runs in is labelled with — an
	// actor you recognise rather than a mechanism you translate.
	RunScript(ctx context.Context, path, code, client string) (RunResult, error)
	// Catalog returns the most recent services/methods picture, possibly empty
	// if nothing has compiled yet.
	Catalog() Catalog
	// CanWriteScripts is whether this kaja owns the disk it serves. The desktop
	// app does; a server serving a workspace it does not own does not, and the
	// tools that write a file are absent from tools/list rather than offered and
	// then refused — the same rule that takes the sidebar's + away.
	CanWriteScripts() bool
	// Activity reports that a request started or finished, with the number still
	// in flight, so the host can show that an agent is using the server. It is
	// called for every request but ping, which is a keepalive rather than use.
	Activity(inFlight int)
}

// defaultClientName is what an agent is called when it announces no name of its
// own. The row it labels has to say something, and "Agent" is at least true.
const defaultClientName = "Agent"

// streamKeepalive is how often a streamed answer says it is still coming. A
// run_script that takes a minute is a request that has carried no bytes for a
// minute, which is what an idle timeout is measured on, and the timeout belongs
// to whatever proxy is in front of this server rather than to this server. Fly,
// which is what kaja is deployed on, passes a 75s one today — but 60s is the
// common default elsewhere (nginx's proxy_read_timeout among them), and a run
// cut off at the proxy is indistinguishable from one that failed.
const streamKeepalive = 15 * time.Second

// Server is the MCP HTTP handler.
type Server struct {
	bridge   Bridge
	token    string
	streamed bool

	mu       sync.Mutex
	inFlight int
	// What the last client to hand shake called itself. One buffer is shared by
	// every client, so the name on it is whichever one touched it last.
	client string
}

// NewServer builds a server. token guards every request via a bearer header;
// it must be non-empty.
func NewServer(bridge Bridge, token string) *Server {
	return &Server{bridge: bridge, token: token}
}

// Streamed answers over SSE whenever the client says it accepts one, so a slow
// answer can say it is still coming. On the desktop nothing sits between the
// agent and the server and a single JSON response is the simpler thing; a server
// reached over the internet is behind at least one proxy with an idle timeout.
func (s *Server) Streamed() *Server {
	s.streamed = true
	return s
}

// --- JSON-RPC envelope ---------------------------------------------------

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  interface{}     `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

const (
	codeParse          = -32700
	codeInvalidRequest = -32600
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
	codeInternal       = -32603
)

// ServeHTTP handles the single MCP endpoint.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		// A bare GET would be the SSE stream; we don't offer one.
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.authorized(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req rpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeRPC(w, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: codeParse, Message: "parse error"}})
		return
	}

	// An agent's calls arrive in bursts, so what the footer shows is the whole
	// burst: the request is marked from the moment it lands until it is answered,
	// and the UI holds the mark a little longer so a fast one is still seen.
	if req.Method != "ping" {
		s.activity(1)
		defer s.activity(-1)
	}

	// Notifications (no id) get acknowledged with no body.
	if len(req.ID) == 0 {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	if s.streamed && acceptsEventStream(r) {
		s.respondStreamed(w, r, req)
		return
	}

	result, rerr := s.dispatch(r.Context(), req.Method, req.Params)
	resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
	if rerr != nil {
		resp.Error = rerr
	} else {
		resp.Result = result
	}
	writeRPC(w, resp)
}

func acceptsEventStream(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Accept"), "text/event-stream")
}

// respondStreamed answers over SSE, which the Streamable HTTP transport allows
// for any request. Nothing about the answer changes — it is the same JSON-RPC
// response, in one event. What it buys is the comment line sent while the answer
// is still being produced, which is what keeps a long run from looking like an
// idle connection to whatever sits in front of this server.
func (s *Server) respondStreamed(w http.ResponseWriter, r *http.Request, req rpcRequest) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		// Nothing can be flushed, so a stream would be buffered into a single
		// write anyway. Answer as JSON rather than pretend.
		result, rerr := s.dispatch(r.Context(), req.Method, req.Params)
		resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
		if rerr != nil {
			resp.Error = rerr
		} else {
			resp.Result = result
		}
		writeRPC(w, resp)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	type answer struct {
		result interface{}
		err    *rpcError
	}
	done := make(chan answer, 1)
	go func() {
		result, rerr := s.dispatch(r.Context(), req.Method, req.Params)
		done <- answer{result: result, err: rerr}
	}()

	ticker := time.NewTicker(streamKeepalive)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		case a := <-done:
			resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
			if a.err != nil {
				resp.Error = a.err
			} else {
				resp.Result = a.result
			}
			// json.Marshal never emits a raw newline, so the response is always
			// the single data line SSE needs it to be.
			body, err := json.Marshal(resp)
			if err != nil {
				return
			}
			fmt.Fprintf(w, "event: message\ndata: %s\n\n", body)
			flusher.Flush()
			return
		}
	}
}

func (s *Server) activity(delta int) {
	s.mu.Lock()
	s.inFlight += delta
	inFlight := s.inFlight
	s.mu.Unlock()
	s.bridge.Activity(inFlight)
}

func (s *Server) authorized(r *http.Request) bool {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, prefix) {
		return false
	}
	return subtleEqual(strings.TrimPrefix(h, prefix), s.token)
}

func (s *Server) dispatch(ctx context.Context, method string, params json.RawMessage) (interface{}, *rpcError) {
	switch method {
	case "initialize":
		return s.handleInitialize(params), nil
	case "ping":
		return map[string]interface{}{}, nil
	case "tools/list":
		return map[string]interface{}{"tools": toolDefinitions(s.bridge.CanWriteScripts())}, nil
	case "tools/call":
		return s.handleToolCall(ctx, params)
	case "resources/list":
		return s.handleResourcesList()
	case "resources/read":
		return s.handleResourceRead(params)
	default:
		return nil, &rpcError{Code: codeMethodNotFound, Message: fmt.Sprintf("unknown method %q", method)}
	}
}

// handleInitialize also learns what the client calls itself. The name is only
// ever read back onto the draft an inline run lands in, so a client that never
// runs anything never names anything.
func (s *Server) handleInitialize(params json.RawMessage) interface{} {
	var announced struct {
		ClientInfo struct {
			Title string `json:"title"`
			Name  string `json:"name"`
		} `json:"clientInfo"`
	}
	if err := json.Unmarshal(params, &announced); err == nil {
		// A title is written to be read; a name is an identifier ("claude-code").
		// Prefer the one meant for a person, since that is where this ends up.
		name := strings.TrimSpace(announced.ClientInfo.Title)
		if name == "" {
			name = strings.TrimSpace(announced.ClientInfo.Name)
		}
		if name != "" {
			s.mu.Lock()
			s.client = name
			s.mu.Unlock()
		}
	}

	return map[string]interface{}{
		"protocolVersion": protocolVersion,
		"capabilities": map[string]interface{}{
			"tools":     map[string]interface{}{},
			"resources": map[string]interface{}{},
		},
		"serverInfo": map[string]interface{}{
			"name":    "kaja-scripts",
			"version": "0.1.0",
		},
		"instructions": guide,
	}
}

// clientName is what the last handshake announced, or the fallback.
func (s *Server) clientName() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client == "" {
		return defaultClientName
	}
	return s.client
}

func writeRPC(w http.ResponseWriter, resp rpcResponse) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// subtleEqual is a constant-time-ish string compare for the token. The token is
// short-lived and localhost-only, but there's no reason to leak length/prefix.
func subtleEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	return v == 0
}

// Package mcp implements the Model Context Protocol server that lets an agent read,
// write, and run the user's Kaja scripts and discover the services they can call. It
// speaks JSON-RPC 2.0 over HTTP (MCP "Streamable HTTP") and reaches the app it serves
// only through the Bridge interface, so it is the same server in both builds: the
// desktop bridges it to its own webview, a deployed Kaja to a browser that attached
// itself to an agent session. No Wails dependency, unit-testable on its own.
//
// This is kaja's own MCP server. The MCP *app* (pkg/apps/mcp) points the other way,
// at somebody else's server; the two share the protocol's name and nothing else.
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

// ScriptInfo is a script on disk. Content is populated only for reads, creates and
// renames.
type ScriptInfo struct {
	Path string `json:"path"`
	Name string `json:"name"`
	// Relative to the workspace's scripts root; empty for one at the root.
	Folder  string `json:"folder,omitempty"`
	Content string `json:"content,omitempty"`
}

// MethodCallLog is a single RPC made while a script ran, mirrored from the UI so
// the agent can see what the script actually did.
type MethodCallLog struct {
	App     string `json:"app,omitempty"`
	Service string `json:"service"`
	Method  string `json:"method"`
	// The request line of a call the script made with fetch, which has no app and no
	// service to be named by. Set instead of App, never beside it.
	Http       string          `json:"http,omitempty"`
	DurationMs float64         `json:"durationMs,omitempty"`
	Input      json.RawMessage `json:"input,omitempty"`
	Output     json.RawMessage `json:"output,omitempty"`
	Failure    *CallFailure    `json:"failure,omitempty"`
}

// CallFailure is why a call failed, in the one distinction a caller can act on:
// whether to change the request, the credentials, or nothing at all. Classified in
// the UI (callFailure.ts), where the thrown error still has its shape.
type CallFailure struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Status  int    `json:"status,omitempty"`
	Code    string `json:"code,omitempty"`
}

// BlockLog is something the script drew. The agent produced the contents already,
// so this is the shape of what it made.
type BlockLog struct {
	Kind    string   `json:"kind"`
	Label   string   `json:"label,omitempty"`
	Columns []string `json:"columns,omitempty"`
	Rows    int      `json:"rows,omitempty"`
	// Cells of a table that hold no value. A table with holes in it must say so rather
	// than read as a table of blanks.
	Pending int `json:"pending,omitempty"`
	Failed  int `json:"failed,omitempty"`
}

// Diagnostic is one type error in the script, as the editor's own checker reports
// it. A script is transpiled rather than compiled, so nothing here stopped the run.
type Diagnostic struct {
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Message string `json:"message"`
}

// RunResult is the outcome of running a script in the webview. Result is what a
// script returned, which a script is not supposed to do — carried so the report can
// correct it rather than swallow it (see renderRun).
type RunResult struct {
	Console     []string        `json:"console,omitempty"`
	Result      json.RawMessage `json:"result,omitempty"`
	Error       string          `json:"error,omitempty"`
	MethodCalls []MethodCallLog `json:"methodCalls,omitempty"`
	Blocks      []BlockLog      `json:"blocks,omitempty"`
	// What the type checker made of the script. A run that made every call it meant to
	// can still be a file with red in it, and this is the only channel that says so:
	// the transpiler that runs a script does not type-check, so a type error is
	// invisible to everything else in this report.
	Diagnostics []Diagnostic `json:"diagnostics,omitempty"`
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
	// RunScript executes a script in the webview. Exactly one of path or code is set;
	// client is what the agent calls itself, which labels the draft an inline snippet
	// runs in.
	RunScript(ctx context.Context, path, code, client string) (RunResult, error)
	// Catalog returns the most recent services/methods picture, possibly empty
	// if nothing has compiled yet.
	Catalog() Catalog
	// CanWriteScripts is whether this kaja owns the disk it serves. Where it doesn't,
	// the tools that write a file are absent from tools/list rather than offered and
	// then refused.
	CanWriteScripts() bool
	// Activity reports that a request started or finished, with the number still in
	// flight. Called for every request but ping, which is a keepalive rather than use.
	Activity(inFlight int)
}

// defaultClientName is what an agent is called when it announces no name of its own.
const defaultClientName = "Agent"

// streamKeepalive is how often a streamed answer says it is still coming. The idle
// timeout belongs to whatever proxy is in front of this server, not to this server:
// Fly passes a 75s run today, but 60s is the common default elsewhere (nginx's
// proxy_read_timeout among them), and a run cut off at the proxy is
// indistinguishable from one that failed.
const streamKeepalive = 15 * time.Second

// Server is the MCP HTTP handler.
type Server struct {
	bridge   Bridge
	token    string
	streamed bool

	mu       sync.Mutex
	inFlight int
	// What the last client to handshake called itself. One buffer is shared by every
	// client, so this is whichever touched it last.
	client string
}

// NewServer builds a server. token guards every request via a bearer header;
// it must be non-empty.
func NewServer(bridge Bridge, token string) *Server {
	return &Server{bridge: bridge, token: token}
}

// Streamed answers over SSE whenever the client says it accepts one, so a slow
// answer can say it is still coming. On the desktop nothing sits between the agent
// and the server, and a single JSON response is the simpler thing.
func (s *Server) Streamed() *Server {
	s.streamed = true
	return s
}

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

	// An agent's calls arrive in bursts, so the request is marked from the moment it
	// lands until it is answered and the UI holds the mark a little longer.
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

// respondStreamed answers over SSE, which Streamable HTTP allows for any request.
// The answer is the same JSON-RPC response in one event; what it buys is the comment
// line sent while it is still being produced.
func (s *Server) respondStreamed(w http.ResponseWriter, r *http.Request, req rpcRequest) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		// Nothing can be flushed, so a stream would be buffered into a single write anyway.
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
			// json.Marshal never emits a raw newline, so the response is always the single data
			// line SSE needs it to be.
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

// handleInitialize also learns what the client calls itself. The name is only ever
// read back onto the draft an inline run lands in.
func (s *Server) handleInitialize(params json.RawMessage) interface{} {
	var announced struct {
		ClientInfo struct {
			Title string `json:"title"`
			Name  string `json:"name"`
		} `json:"clientInfo"`
	}
	if err := json.Unmarshal(params, &announced); err == nil {
		// A title is written to be read; a name is an identifier ("claude-code"). Prefer the
		// one meant for a person, since that is where this ends up.
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

// subtleEqual is a constant-time-ish string compare for the token. There is no
// reason to leak its length or prefix.
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

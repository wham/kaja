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
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

//go:embed guide.md
var guide string

// ScriptInfo is a script on disk. Content is populated only for reads, creates and
// renames.
type ScriptInfo struct {
	// Path is the script's place in the workspace, relative to the scripts root
	// ("reports/weekly.ts"), which is a name every tool here resolves - a listing's
	// own path can be handed straight back. It is relative rather than absolute
	// because where the workspace sits on the machine serving it is the server's
	// business, and no tool needs it: the agent may be another process, or another
	// person's browser.
	Path string `json:"path"`
	Name string `json:"name"`
	// Relative to the workspace's scripts root; empty for one at the root.
	Folder  string `json:"folder,omitempty"`
	Content string `json:"content,omitempty"`
	// RunPath is the absolute path the same script is known by inside a window: its
	// console, its stored runs and its row in the sidebar are keyed on it, so a run
	// dispatched under anything else lands in a console of its own. It is the
	// window's name for the file, never the agent's, which is why it is not written.
	RunPath string `json:"-"`
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

// sessionHeader is what a handshake pins and every request after it echoes, which
// is what tells two agents on one endpoint apart. Streamable HTTP makes echoing it
// the client's job once a server has issued one.
const sessionHeader = "Mcp-Session-Id"

// Server is the MCP HTTP handler.
type Server struct {
	bridge Bridge
	token  string
	// version is what this kaja reports itself as, which is the only thing about the
	// server that the process it runs in has to supply.
	version  string
	streamed bool

	mu       sync.Mutex
	inFlight int
	// What the last client to handshake called itself, which is what a request
	// carrying neither a session nor an identity of its own is read as.
	client string
	// The name each pinned session belongs to, and the session pinned for each name.
	// A name is minted a session once, so a client that handshakes on every start is
	// one entry rather than a hundred, and the map is bounded by how many agents
	// there are rather than by how often they connect.
	sessions map[string]string
	pinned   map[string]string
}

// NewServer builds a server. token guards every request via a bearer header; it must
// be non-empty. version is the running kaja's own, reported as this server's.
func NewServer(bridge Bridge, token, version string) *Server {
	return &Server{
		bridge:   bridge,
		token:    token,
		version:  version,
		sessions: map[string]string{},
		pinned:   map[string]string{},
	}
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
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
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
	if !SameSiteOrigin(r) {
		// A page cannot be allowed to drive this endpoint just because it resolved a
		// name to the loopback address the agent reaches it on. The bearer token blunts
		// that on its own; the specification asks for the Origin to be checked anyway,
		// and it is the cheaper of the two guards.
		http.Error(w, "forbidden origin", http.StatusForbidden)
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

	caller := s.identify(w, r, req)
	modern, rerr := s.era(req)

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

	if rerr != nil {
		writeRPC(w, rpcResponse{JSONRPC: "2.0", ID: req.ID, Error: rerr})
		return
	}

	// A method this server does not answer is a 404 rather than an error under a 200,
	// which is what lets a client tell "no such method" from "the call failed" without
	// reading the body - and it is settled before anything is written, because a
	// streamed answer has already sent its status by the time a handler runs.
	handle := s.handlerFor(req.Method)
	if handle == nil {
		w.WriteHeader(http.StatusNotFound)
		writeRPC(w, rpcResponse{JSONRPC: "2.0", ID: req.ID, Error: &rpcError{
			Code:    codeMethodNotFound,
			Message: fmt.Sprintf("unknown method %q", req.Method),
		}})
		return
	}

	if s.streamed && acceptsEventStream(r) {
		s.respondStreamed(w, r, req, handle, caller, modern)
		return
	}

	writeRPC(w, s.answer(r.Context(), req, handle, caller, modern))
}

// answer runs one handler and frames what it produced for the era it was asked in.
func (s *Server) answer(ctx context.Context, req rpcRequest, handle handlerFunc, caller string, modern bool) rpcResponse {
	resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
	result, rerr := handle(ctx, req.Params, caller)
	if rerr != nil {
		resp.Error = rerr
		return resp
	}
	resp.Result = complete(result, modern, s.version)
	return resp
}

// era reads which revision this request is written in, which is the whole of what the
// modern one needs: it carries its version in `_meta`, so nothing about the client is
// held between requests. A version this server does not speak is refused with the
// ones it does, since a client that cannot tell why it was refused has nothing to
// retry with. `server/discover` is modern whatever it carries - it is the one method
// only that era defines - and `initialize` is legacy for the same reason.
func (s *Server) era(req rpcRequest) (bool, *rpcError) {
	version := metaString(req.Params, metaProtocolVersion)
	if version != "" && !supportsVersion(version) {
		return false, &rpcError{
			Code:    codeUnsupportedProtocolVersion,
			Message: fmt.Sprintf("unsupported protocol version %q", version),
			Data:    map[string]interface{}{"supported": supportedVersions},
		}
	}
	if req.Method == "initialize" {
		return false, nil
	}
	return modernVersions[version] || req.Method == "server/discover", nil
}

// SameSiteOrigin is the DNS-rebinding guard: a request with no Origin is a process
// rather than a page and is let through, and a page is let through only where it is
// this server's own or a local one.
//
// It is exported because the check has to come before the token is read, and on the
// web the token is read by the door in front of this one: refusing a bad origin only
// after the token has been looked up tells a cross-origin page which tokens are real.
func SameSiteOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	if strings.EqualFold(parsed.Host, r.Host) {
		return true
	}
	host := parsed.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func acceptsEventStream(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Accept"), "text/event-stream")
}

// respondStreamed answers over SSE, which Streamable HTTP allows for any request.
// The answer is the same JSON-RPC response in one event; what it buys is the comment
// line sent while it is still being produced.
func (s *Server) respondStreamed(w http.ResponseWriter, r *http.Request, req rpcRequest, handle handlerFunc, caller string, modern bool) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		// Nothing can be flushed, so a stream would be buffered into a single write anyway.
		writeRPC(w, s.answer(r.Context(), req, handle, caller, modern))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	done := make(chan rpcResponse, 1)
	go func() {
		done <- s.answer(r.Context(), req, handle, caller, modern)
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
		case resp := <-done:
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

// handlerFunc answers one method. Every handler takes the same three things so the
// list below can be one lookup rather than a switch that also decides the status.
type handlerFunc func(ctx context.Context, params json.RawMessage, caller string) (interface{}, *rpcError)

// handlerFor is the one list of methods this server answers. A method with no handler
// is a 404, which is why this is a lookup rather than a switch with a default in it.
func (s *Server) handlerFor(method string) handlerFunc {
	plain := func(answer func() (interface{}, *rpcError)) handlerFunc {
		return func(context.Context, json.RawMessage, string) (interface{}, *rpcError) { return answer() }
	}
	withParams := func(answer func(json.RawMessage) (interface{}, *rpcError)) handlerFunc {
		return func(_ context.Context, params json.RawMessage, _ string) (interface{}, *rpcError) {
			return answer(params)
		}
	}
	switch method {
	case "server/discover":
		return plain(func() (interface{}, *rpcError) { return s.handleDiscover(), nil })
	case "initialize":
		return withParams(func(params json.RawMessage) (interface{}, *rpcError) { return s.handleInitialize(params), nil })
	case "ping":
		return plain(func() (interface{}, *rpcError) { return map[string]interface{}{}, nil })
	case "tools/list":
		return plain(func() (interface{}, *rpcError) { return s.handleToolsList(), nil })
	case "tools/call":
		return s.handleToolCall
	case "resources/list":
		return plain(s.handleResourcesList)
	case "resources/read":
		return withParams(s.handleResourceRead)
	}
	return nil
}

// capabilities is what this server serves, in both eras: the tools and the two
// resources, and nothing that asks anything of the client.
func capabilities() map[string]interface{} {
	return map[string]interface{}{
		"tools":     map[string]interface{}{},
		"resources": map[string]interface{}{},
	}
}

// handleDiscover is the modern era's opening, and it replaces the handshake rather
// than preceding one: it names every revision this server speaks, so a client that
// reached it with the wrong one has the answer without a second round trip.
func (s *Server) handleDiscover() interface{} {
	return cacheable(map[string]interface{}{
		"supportedVersions": supportedVersions,
		"capabilities":      capabilities(),
		"instructions":      guide,
	}, staticTTL)
}

// handleInitialize answers the handshake era. The version a client asked for is
// echoed where this server speaks it, because that is what the client is about to
// write its requests in; anything else is answered with the newest one it could have
// meant, and the client decides whether to go on.
func (s *Server) handleInitialize(params json.RawMessage) interface{} {
	version := legacyProtocolVersion
	var asked struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	if json.Unmarshal(params, &asked) == nil && supportsVersion(asked.ProtocolVersion) && !modernVersions[asked.ProtocolVersion] {
		version = asked.ProtocolVersion
	}
	return map[string]interface{}{
		"protocolVersion": version,
		"capabilities":    capabilities(),
		"serverInfo":      implementation(s.version),
		"instructions":    guide,
	}
}

func (s *Server) handleToolsList() interface{} {
	return cacheable(map[string]interface{}{"tools": toolDefinitions(s.bridge.CanWriteScripts())}, workspaceTTL)
}

// identify is who this request is from, which is the whole of what gives an agent a
// draft of its own. Three ways of saying it, newest first: the revision that dropped
// the handshake carries the identity on every request, an older one announces it once
// and echoes the session pinned for it, and a client that does neither is whoever
// handshook last — which is what a single-agent endpoint was already read as.
//
// A handshake also pins the session, so the answer to `initialize` is where the
// header is set.
func (s *Server) identify(w http.ResponseWriter, r *http.Request, req rpcRequest) string {
	if name := announcedName(req.Params, metaClientInfo); name != "" {
		return name
	}
	if req.Method == "initialize" {
		name := announcedName(req.Params, "clientInfo")
		if name == "" {
			return s.lastClient()
		}
		w.Header().Set(sessionHeader, s.pin(name))
		return name
	}
	if id := r.Header.Get(sessionHeader); id != "" {
		s.mu.Lock()
		name := s.sessions[id]
		s.mu.Unlock()
		if name != "" {
			return name
		}
	}
	return s.lastClient()
}

// announcedName reads a clientInfo out of the params, either at the top level (the
// handshake) or under `_meta` (every request of the modern revision). A title is
// written to be read; a name is an identifier ("claude-code"). Prefer the one meant
// for a person, since a draft's row is where this ends up.
func announcedName(params json.RawMessage, key string) string {
	fields := map[string]json.RawMessage{}
	if key == metaClientInfo {
		fields = metaFields(params)
	} else if json.Unmarshal(params, &fields) != nil {
		return ""
	}
	var announced struct {
		Title string `json:"title"`
		Name  string `json:"name"`
	}
	if json.Unmarshal(fields[key], &announced) != nil {
		return ""
	}
	if title := strings.TrimSpace(announced.Title); title != "" {
		return title
	}
	return strings.TrimSpace(announced.Name)
}

// metaFields is the request metadata a modern request carries, which is where that
// era puts everything the handshake used to say once.
func metaFields(params json.RawMessage) map[string]json.RawMessage {
	fields := map[string]json.RawMessage{}
	if json.Unmarshal(params, &fields) != nil {
		return nil
	}
	meta := map[string]json.RawMessage{}
	if json.Unmarshal(fields["_meta"], &meta) != nil {
		return nil
	}
	return meta
}

// metaString reads one string out of the request metadata.
func metaString(params json.RawMessage, key string) string {
	var value string
	if json.Unmarshal(metaFields(params)[key], &value) != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

// pin records the handshake and answers with the session this name is known by.
func (s *Server) pin(name string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.client = name
	if id, ok := s.pinned[name]; ok {
		return id
	}
	id := newSessionID()
	s.pinned[name] = id
	s.sessions[id] = name
	return id
}

// newSessionID is the opaque handle a handshake is pinned under. It identifies a
// client rather than authorizing one — the bearer token does that — so it is short.
func newSessionID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b)
}

// lastClient is what the last handshake announced, or the fallback.
func (s *Server) lastClient() string {
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

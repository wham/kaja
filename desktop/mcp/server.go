// Package mcp implements a localhost Model Context Protocol server that lets an
// agent read, write, and run the user's saved Kaja scripts and discover the
// services they can call. It speaks JSON-RPC 2.0 over HTTP (the MCP "Streamable
// HTTP" transport, single-response flavour — no SSE) and is bridged to the
// desktop app through the Bridge interface so this package stays free of any
// Wails dependency and is unit-testable on its own.
package mcp

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// protocolVersion is the MCP revision this server implements. When a client
// announces a different version we echo back our own and let it decide.
const protocolVersion = "2025-06-18"

//go:embed guide.md
var guide string

// ScriptInfo is a script on disk. Content is populated only where it makes
// sense (reads, creates, renames).
type ScriptInfo struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Content string `json:"content,omitempty"`
}

// MethodCallLog is a single RPC made while a script ran, mirrored from the UI so
// the agent can see what the script actually did.
type MethodCallLog struct {
	Service string          `json:"service"`
	Method  string          `json:"method"`
	Input   json.RawMessage `json:"input,omitempty"`
	Output  json.RawMessage `json:"output,omitempty"`
	Error   string          `json:"error,omitempty"`
}

// RunResult is the outcome of running a script in the webview.
type RunResult struct {
	Console     []string        `json:"console,omitempty"`
	Result      json.RawMessage `json:"result,omitempty"`
	Error       string          `json:"error,omitempty"`
	MethodCalls []MethodCallLog `json:"methodCalls,omitempty"`
}

// CatalogMethod describes one callable RPC.
type CatalogMethod struct {
	Name            string `json:"name"`
	InputType       string `json:"inputType,omitempty"`
	OutputType      string `json:"outputType,omitempty"`
	ServerStreaming bool   `json:"serverStreaming,omitempty"`
	ClientStreaming bool   `json:"clientStreaming,omitempty"`
}

// CatalogService is a service exposed by an app, with the import path a
// script uses to reach it.
type CatalogService struct {
	Name        string          `json:"name"`
	PackageName string          `json:"packageName,omitempty"`
	ImportPath  string          `json:"importPath"`
	Methods     []CatalogMethod `json:"methods"`
}

// CatalogApp groups the services of one configured app.
type CatalogApp struct {
	Name     string           `json:"name"`
	Services []CatalogService `json:"services"`
}

// CatalogSource is a generated TypeScript stub, exposed as a resource so the
// agent can read precise field-level types.
type CatalogSource struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// Catalog is the live picture of what scripts can call, pushed from the UI
// after each successful compilation.
type Catalog struct {
	Apps []CatalogApp `json:"apps"`
	Sources  []CatalogSource  `json:"sources,omitempty"`
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
	// Exactly one of path or code is set.
	RunScript(ctx context.Context, path, code string) (RunResult, error)
	// Catalog returns the most recent services/methods picture, possibly empty
	// if nothing has compiled yet.
	Catalog() Catalog
}

// Server is the localhost MCP HTTP handler.
type Server struct {
	bridge Bridge
	token  string
}

// NewServer builds a server. token guards every request via a bearer header;
// it must be non-empty.
func NewServer(bridge Bridge, token string) *Server {
	return &Server{bridge: bridge, token: token}
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

	// Notifications (no id) get acknowledged with no body.
	if len(req.ID) == 0 {
		w.WriteHeader(http.StatusAccepted)
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
		return s.handleInitialize(), nil
	case "ping":
		return map[string]interface{}{}, nil
	case "tools/list":
		return map[string]interface{}{"tools": toolDefinitions()}, nil
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

func (s *Server) handleInitialize() interface{} {
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

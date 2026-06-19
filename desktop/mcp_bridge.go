package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/wham/kaja/desktop/mcp"
)

// MCP wiring. The experimental MCP server lets an agent read, write, and run the
// user's saved scripts and discover the services those scripts can call. It runs
// inside this desktop process, bound to localhost and guarded by a per-session
// token. Editing is plain file I/O; running a script has to round-trip into the
// webview, which is the only place the script runtime and service clients live.

// MCPInfo is reported to the UI so it can show the connection command.
type MCPInfo struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
	Token   string `json:"token"`
}

// MCPSetEnabled starts or stops the MCP server. The UI calls this when the
// feature preview is toggled and on load to reflect the persisted state.
func (a *App) MCPSetEnabled(enabled bool) MCPInfo {
	if enabled {
		a.startMCPServer()
	} else {
		a.stopMCPServer()
	}
	return a.MCPServerInfo()
}

// MCPServerInfo returns the current connection details for the UI footer.
func (a *App) MCPServerInfo() MCPInfo {
	a.mcpMu.Lock()
	defer a.mcpMu.Unlock()
	return MCPInfo{Enabled: a.mcpServer != nil, URL: a.mcpURL, Token: a.mcpToken}
}

// MCPSetCatalog receives the live services/methods picture from the UI after
// each successful compilation, so list_services and the stub resources reflect
// what is actually callable.
func (a *App) MCPSetCatalog(catalogJSON string) error {
	var catalog mcp.Catalog
	if err := json.Unmarshal([]byte(catalogJSON), &catalog); err != nil {
		return err
	}
	a.mcpMu.Lock()
	a.mcpCatalog = catalog
	a.mcpMu.Unlock()
	return nil
}

// MCPScriptResult is called by the UI to deliver the outcome of a run started by
// the run_script tool. id correlates with the pending RunScript call.
func (a *App) MCPScriptResult(id string, resultJSON string) error {
	var result mcp.RunResult
	if err := json.Unmarshal([]byte(resultJSON), &result); err != nil {
		return err
	}
	a.mcpMu.Lock()
	ch := a.mcpPending[id]
	a.mcpMu.Unlock()
	if ch != nil {
		ch <- result
	}
	return nil
}

func (a *App) startMCPServer() {
	a.mcpMu.Lock()
	defer a.mcpMu.Unlock()
	if a.mcpServer != nil {
		return
	}
	if a.mcpToken == "" {
		a.mcpToken = randomToken(24)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		slog.Error("Failed to start MCP server", "error", err)
		return
	}
	mux := http.NewServeMux()
	mux.Handle("/mcp", mcp.NewServer(mcpBridge{a}, a.mcpToken))
	srv := &http.Server{Handler: mux}
	a.mcpServer = srv
	a.mcpURL = fmt.Sprintf("http://%s/mcp", ln.Addr().String())
	slog.Info("MCP server started", "url", a.mcpURL)
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			slog.Error("MCP server stopped", "error", err)
		}
	}()
}

func (a *App) stopMCPServer() {
	a.mcpMu.Lock()
	srv := a.mcpServer
	a.mcpServer = nil
	a.mcpURL = ""
	a.mcpMu.Unlock()
	if srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	slog.Info("MCP server stopped")
}

// runScript asks the webview to run a script and waits for the result.
func (a *App) runScript(ctx context.Context, path, code string) (mcp.RunResult, error) {
	id := randomToken(8)
	ch := make(chan mcp.RunResult, 1)
	a.mcpMu.Lock()
	a.mcpPending[id] = ch
	a.mcpMu.Unlock()
	defer func() {
		a.mcpMu.Lock()
		delete(a.mcpPending, id)
		a.mcpMu.Unlock()
	}()

	runtime.EventsEmit(a.ctx, "mcp:runScript", map[string]string{"id": id, "path": path, "code": code})

	select {
	case result := <-ch:
		return result, nil
	case <-ctx.Done():
		return mcp.RunResult{}, ctx.Err()
	case <-time.After(2 * time.Minute):
		return mcp.RunResult{}, fmt.Errorf("script run timed out")
	}
}

func (a *App) catalog() mcp.Catalog {
	a.mcpMu.Lock()
	defer a.mcpMu.Unlock()
	return a.mcpCatalog
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand should never fail; fall back to a time-based value.
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b)
}

// mcpBridge adapts the App's file methods to the mcp.Bridge interface. It exists
// because the App already exposes a ListScripts/CreateScript with Wails-shaped
// return types; the adapter converts those to the MCP shapes without colliding.
type mcpBridge struct{ app *App }

func (b mcpBridge) ListScripts() ([]mcp.ScriptInfo, error) {
	files, err := b.app.ListScripts()
	if err != nil {
		return nil, err
	}
	out := make([]mcp.ScriptInfo, 0, len(files))
	for _, f := range files {
		out = append(out, mcp.ScriptInfo{Path: f.Path, Name: f.Name})
	}
	return out, nil
}

func (b mcpBridge) ReadScript(path string) (string, error) {
	f, err := b.app.ReadScriptFile(path)
	if err != nil {
		return "", err
	}
	return f.Content, nil
}

func (b mcpBridge) WriteScript(path, content string) error {
	return b.app.WriteScriptFile(path, content)
}

func (b mcpBridge) CreateScript(name, content string) (mcp.ScriptInfo, error) {
	f, err := b.app.CreateScript(name, content)
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	return mcp.ScriptInfo{Path: f.Path, Name: f.Name, Content: f.Content}, nil
}

func (b mcpBridge) RenameScript(path, newName string) (mcp.ScriptInfo, error) {
	f, err := b.app.RenameScript(path, newName)
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	return mcp.ScriptInfo{Path: f.Path, Name: f.Name, Content: f.Content}, nil
}

func (b mcpBridge) DeleteScript(path string) error {
	return b.app.DeleteScript(path)
}

func (b mcpBridge) RunScript(ctx context.Context, path, code string) (mcp.RunResult, error) {
	return b.app.runScript(ctx, path, code)
}

func (b mcpBridge) Catalog() mcp.Catalog {
	return b.app.catalog()
}

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
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/wham/kaja/desktop/mcp"
)

// MCP wiring. The experimental MCP server lets an agent read, write, and run the
// user's saved scripts and discover the services those scripts can call. It runs
// inside this desktop process, bound to localhost and guarded by a per-session
// token. Editing is plain file I/O; running a script has to round-trip into the
// webview, which is the only place the script runtime and service clients live.

// mcpPort is the fixed loopback port the MCP server binds to. It is fixed rather
// than OS-assigned so the connection command shown to the user stays valid across
// restarts. It sits next to kaja's web port (41520) in the registered range, so
// the OS won't hand it out as an ephemeral port.
const mcpPort = 41521

// MCPInfo is reported to the UI so it can show the connection command. Error is
// set when the server couldn't start (e.g. the fixed port was already in use) so
// the footer can explain it instead of silently hiding the connection command.
type MCPInfo struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
	Token   string `json:"token"`
	Error   string `json:"error"`
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
	return MCPInfo{Enabled: a.mcpServer != nil, URL: a.mcpURL, Token: a.mcpToken, Error: a.mcpError}
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
	a.mcpError = ""
	if a.mcpToken == "" {
		a.mcpToken = a.loadOrCreateMCPToken()
	}
	addr := fmt.Sprintf("127.0.0.1:%d", mcpPort)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		// The fixed port is taken. Don't fall back to a random port — that would
		// silently break the static connection command the user has configured.
		// Surface it so they can free the port and toggle the preview again.
		a.mcpError = fmt.Sprintf("Port %d is in use. Free it, then toggle the MCP preview off and on.", mcpPort)
		slog.Error("Failed to start MCP server", "addr", addr, "error", err)
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
	a.mcpError = ""
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

// loadOrCreateMCPToken returns the bearer token persisted next to kaja.json,
// generating and saving a new one the first time (or if the stored file is
// missing, empty, or unreadable). Persisting it keeps the connection command
// stable across restarts. Must be called with mcpMu held.
func (a *App) loadOrCreateMCPToken() string {
	path := filepath.Join(a.workspaceDir, "mcp-token")
	if data, err := os.ReadFile(path); err == nil {
		if token := strings.TrimSpace(string(data)); token != "" {
			return token
		}
	}
	token := randomToken(24)
	if err := os.WriteFile(path, []byte(token), 0600); err != nil {
		slog.Warn("Failed to persist MCP token", "error", err)
	}
	return token
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand should never fail; fall back to a time-based value.
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b)
}

// guardScriptPath confines an MCP-supplied path or name to a single file
// directly inside the flat scripts directory, defeating path traversal from the
// (untrusted) MCP endpoint. The directory is flat, so only the base name can
// ever matter; the cleaned result is additionally checked to stay within the
// root before any filesystem use.
func (a *App) guardScriptPath(p string) (string, error) {
	if strings.TrimSpace(p) == "" {
		return "", fmt.Errorf("empty script path")
	}
	root := filepath.Clean(a.scriptsDir())
	resolved := filepath.Clean(filepath.Join(root, filepath.Base(p)))
	if resolved == root || !strings.HasPrefix(resolved, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("invalid script path %q", p)
	}
	return resolved, nil
}

// mcpBridge adapts the App's file methods to the mcp.Bridge interface. It exists
// because the App already exposes a ListScripts/CreateScript with Wails-shaped
// return types; the adapter converts those to the MCP shapes without colliding.
// Every path or name crossing this boundary is run through guardScriptPath so an
// agent can only touch files inside the scripts directory.
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
	safePath, err := b.app.guardScriptPath(path)
	if err != nil {
		return "", err
	}
	f, err := b.app.ReadScriptFile(safePath)
	if err != nil {
		return "", err
	}
	return f.Content, nil
}

func (b mcpBridge) WriteScript(path, content string) error {
	safePath, err := b.app.guardScriptPath(path)
	if err != nil {
		return err
	}
	return b.app.WriteScriptFile(safePath, content)
}

func (b mcpBridge) CreateScript(name, content string) (mcp.ScriptInfo, error) {
	safePath, err := b.app.guardScriptPath(name)
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	f, err := b.app.CreateScript(filepath.Base(safePath), content)
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	return mcp.ScriptInfo{Path: f.Path, Name: f.Name, Content: f.Content}, nil
}

func (b mcpBridge) RenameScript(path, newName string) (mcp.ScriptInfo, error) {
	safePath, err := b.app.guardScriptPath(path)
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	safeNewPath, err := b.app.guardScriptPath(newName)
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	f, err := b.app.RenameScript(safePath, filepath.Base(safeNewPath))
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	return mcp.ScriptInfo{Path: f.Path, Name: f.Name, Content: f.Content}, nil
}

func (b mcpBridge) DeleteScript(path string) error {
	safePath, err := b.app.guardScriptPath(path)
	if err != nil {
		return err
	}
	return b.app.DeleteScript(safePath)
}

func (b mcpBridge) RunScript(ctx context.Context, path, code string) (mcp.RunResult, error) {
	// Only a saved-script run carries a path; confine it. Inline code has none.
	if path != "" {
		safePath, err := b.app.guardScriptPath(path)
		if err != nil {
			return mcp.RunResult{}, err
		}
		path = safePath
	}
	return b.app.runScript(ctx, path, code)
}

func (b mcpBridge) Catalog() mcp.Catalog {
	return b.app.catalog()
}

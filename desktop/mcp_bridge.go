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

// MCP wiring. The MCP server lets an agent read, write, and run the user's saved
// scripts and discover the services those scripts can call. It runs inside this
// desktop process for as long as the process does, bound to localhost and guarded
// by a persisted token. Editing is plain file I/O; running a script has to
// round-trip into the webview, which is the only place the script runtime and
// service clients live.

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
	// ConfigurationPaths is where each client keeps the file its snippet goes
	// into, keyed by the client the footer shows it under.
	ConfigurationPaths map[string]string `json:"configurationPaths"`
}

// MCPServerInfo returns the current connection details for the UI footer.
func (a *App) MCPServerInfo() MCPInfo {
	a.mcpMu.Lock()
	defer a.mcpMu.Unlock()
	return MCPInfo{
		Enabled:            a.mcpServer != nil,
		URL:                a.mcpURL,
		Token:              a.mcpToken,
		Error:              a.mcpError,
		ConfigurationPaths: mcpClientConfigurationPaths(),
	}
}

// mcpClientConfigurationPaths is the file each client keeps its MCP servers in,
// so the footer can link to the one it is telling you to edit rather than only
// naming it. A client whose path this machine can't answer for is absent, and
// its snippet is shown with the file named and no link.
func mcpClientConfigurationPaths() map[string]string {
	paths := map[string]string{}
	// The three places os.UserConfigDir reports are the three Claude Desktop
	// looks in: Application Support, %AppData%, and ~/.config.
	if dir, err := os.UserConfigDir(); err == nil {
		paths["claudeDesktop"] = filepath.Join(dir, "Claude", "claude_desktop_config.json")
	}
	if home, err := os.UserHomeDir(); err == nil {
		paths["cursor"] = filepath.Join(home, ".cursor", "mcp.json")
	}
	return paths
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
		// Surface it so they can free the port and start Kaja again.
		a.mcpError = fmt.Sprintf("Port %d is in use. Free it, then restart Kaja.", mcpPort)
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
func (a *App) runScript(ctx context.Context, path, code, client string) (mcp.RunResult, error) {
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

	runtime.EventsEmit(a.ctx, "mcp:runScript", map[string]string{"id": id, "path": a.scriptPath(path), "code": code, "client": client})

	select {
	case result := <-ch:
		return result, nil
	case <-ctx.Done():
		return mcp.RunResult{}, ctx.Err()
	case <-time.After(2 * time.Minute):
		return mcp.RunResult{}, fmt.Errorf("script run timed out")
	}
}

// notifyMCPActivity tells the webview a request is being served, so the footer
// can show that an agent is using the server. inFlight is zero once the last one
// has been answered; the UI decides how long the mark lingers after that.
func (a *App) notifyMCPActivity(inFlight int) {
	runtime.EventsEmit(a.ctx, "mcp:activity", map[string]int{"inFlight": inFlight})
}

// notifyScriptsChanged tells the webview an MCP tool changed a script on disk,
// so an open tab can live-reload its content and the sidebar list stays fresh.
func (a *App) notifyScriptsChanged(payload map[string]string) {
	runtime.EventsEmit(a.ctx, "mcp:scriptsChanged", payload)
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

// mcpBridge adapts the App's file methods to the mcp.Bridge interface. It exists
// because the App already exposes a ListScripts/CreateScript with Wails-shaped
// return types; the adapter converts those to the MCP shapes without colliding.
//
// Nothing guards paths here any more: every one of those methods resolves the
// name it is given inside the scripts folder through an os.Root, which is the
// whole access boundary and is the same one the browser goes through. An agent's
// path is a name to resolve, exactly like anyone else's.
type mcpBridge struct{ app *App }

func (b mcpBridge) ListScripts() ([]mcp.ScriptInfo, error) {
	files, err := b.app.ListScripts()
	if err != nil {
		return nil, err
	}
	out := make([]mcp.ScriptInfo, 0, len(files))
	for _, f := range files {
		out = append(out, mcp.ScriptInfo{Path: f.Path, Name: f.Name, Folder: f.Folder})
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
	if err := b.app.WriteScriptFile(path, content); err != nil {
		return err
	}
	b.app.notifyScriptsChanged(map[string]string{"action": "write", "path": b.app.scriptPath(path), "content": content})
	return nil
}

func (b mcpBridge) CreateScript(name, content string) (mcp.ScriptInfo, error) {
	f, err := b.app.CreateScript(name, content)
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	// The content travels with it so the UI can tell whether this file is the
	// agent's own draft being saved, in which case the draft goes with it.
	b.app.notifyScriptsChanged(map[string]string{"action": "create", "path": f.Path, "name": f.Name, "folder": f.Folder, "content": f.Content})
	return mcp.ScriptInfo{Path: f.Path, Name: f.Name, Folder: f.Folder, Content: f.Content}, nil
}

func (b mcpBridge) RenameScript(path, newName string) (mcp.ScriptInfo, error) {
	from := b.app.scriptPath(path)
	f, err := b.app.RenameScript(path, newName)
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	b.app.notifyScriptsChanged(map[string]string{"action": "rename", "oldPath": from, "path": f.Path, "name": f.Name, "folder": f.Folder})
	return mcp.ScriptInfo{Path: f.Path, Name: f.Name, Folder: f.Folder, Content: f.Content}, nil
}

func (b mcpBridge) DeleteScript(path string) error {
	resolved := b.app.scriptPath(path)
	if err := b.app.DeleteScript(path); err != nil {
		return err
	}
	b.app.notifyScriptsChanged(map[string]string{"action": "delete", "path": resolved})
	return nil
}

func (b mcpBridge) RunScript(ctx context.Context, path, code, client string) (mcp.RunResult, error) {
	return b.app.runScript(ctx, path, code, client)
}

func (b mcpBridge) Catalog() mcp.Catalog {
	return b.app.catalog()
}

func (b mcpBridge) Activity(inFlight int) {
	b.app.notifyMCPActivity(inFlight)
}

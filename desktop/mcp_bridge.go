package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// MCP wiring. The switchboard is pkg/agent's, the same one a deployed kaja answers an
// agent with, and the desktop is its degenerate case: one session on the token this
// process persists, with one window attached while the server is on over the mux the
// webview already fetches its calls on. What is left here is the one thing only this
// process can do: a loopback listener, because an agent lives in another process and
// cannot reach a wails:// URL.

// mcpPort is the fixed loopback port the MCP server binds to. Fixed rather than
// OS-assigned so the connection command shown to the user stays valid across restarts.
// It sits next to kaja's web port (41520) in the registered range, so the OS won't
// hand it out as an ephemeral port.
const mcpPort = 41521

// MCPInfo is reported to the UI so it can show and control the MCP server and attach
// its window to the session that server reaches. Error is set when the server couldn't
// start (e.g. the fixed port was already in use).
type MCPInfo struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
	Token   string `json:"token"`
	Error   string `json:"error"`
	// ConfigurationPaths is where each client keeps the file its snippet goes
	// into, keyed by the client the MCP page shows it under.
	ConfigurationPaths map[string]string `json:"configurationPaths"`
}

// MCPServerInfo returns the current connection details for the UI's MCP page.
func (a *App) MCPServerInfo() MCPInfo {
	a.mcpMu.Lock()
	defer a.mcpMu.Unlock()
	return a.mcpInfoLocked()
}

// SetMCPServerEnabled starts or stops the loopback server and returns its new state.
func (a *App) SetMCPServerEnabled(enabled bool) MCPInfo {
	if enabled {
		a.startMCPServer()
	} else {
		a.stopMCPServer()
	}
	return a.MCPServerInfo()
}

// RegenerateMCPToken mints a new bearer token and moves a running session onto it.
// Every configuration already pasted names the old one, which is what the page warns
// about before it asks for this.
func (a *App) RegenerateMCPToken() MCPInfo {
	a.mcpMu.Lock()
	defer a.mcpMu.Unlock()

	token := randomToken(24)
	if err := a.writeMCPToken(token); err != nil {
		a.mcpError = fmt.Sprintf("Failed to store the new MCP token: %s", err)
		slog.Error("Failed to persist MCP token", "error", err)
		return a.mcpInfoLocked()
	}
	previous := a.mcpToken
	a.mcpToken = token
	if a.mcpServer == nil {
		return a.mcpInfoLocked()
	}
	// Opened before the old one is dropped, so the window has somewhere to reattach.
	if _, err := a.agents.Open(token); err != nil {
		a.mcpError = fmt.Sprintf("The MCP token is unusable: %s. Delete mcp-token and restart Kaja.", err)
		slog.Error("Failed to open the agent session", "error", err)
		return a.mcpInfoLocked()
	}
	if previous != "" {
		a.agents.Drop(previous)
	}
	a.mcpError = ""
	slog.Info("MCP token regenerated")
	return a.mcpInfoLocked()
}

// The token is reported whether or not the server is running: it is the workspace's,
// not the listener's, so a stopped server still has the one every pasted configuration
// names — and the page's snippets stay copyable. Startup mints it, which is why a
// workspace whose server has never been turned on has one too.
// Must be called with mcpMu held.
func (a *App) mcpInfoLocked() MCPInfo {
	return MCPInfo{
		Enabled:            a.mcpServer != nil,
		URL:                a.mcpURL,
		Token:              a.readMCPToken(),
		Error:              a.mcpError,
		ConfigurationPaths: mcpClientConfigurationPaths(),
	}
}

// mcpClientConfigurationPaths is the file each client keeps its MCP servers in, so
// the page can link to the one it is telling you to edit. A client whose path this
// machine can't answer for is absent, and its snippet names the file without a link.
func mcpClientConfigurationPaths() map[string]string {
	paths := map[string]string{}
	// The three places os.UserConfigDir reports are the three Claude Desktop looks in:
	// Application Support, %AppData%, and ~/.config. Cline files itself under the same
	// root, inside the VS Code extension that hosts it.
	if dir, err := os.UserConfigDir(); err == nil {
		paths["claudeDesktop"] = filepath.Join(dir, "Claude", "claude_desktop_config.json")
		paths["cline"] = filepath.Join(dir, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
	}
	if home, err := os.UserHomeDir(); err == nil {
		paths["cursor"] = filepath.Join(home, ".cursor", "mcp.json")
		paths["windsurf"] = filepath.Join(home, ".codeium", "windsurf", "mcp_config.json")
		paths["codex"] = filepath.Join(home, ".codex", "config.toml")
		paths["gemini"] = filepath.Join(home, ".gemini", "settings.json")
		// Zed and Goose read ~/.config on every platform, macOS included, so these two
		// don't go through os.UserConfigDir.
		paths["zed"] = filepath.Join(home, ".config", "zed", "settings.json")
		paths["goose"] = filepath.Join(home, ".config", "goose", "config.yaml")
	}
	return paths
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
	// Opened rather than waited for: the window attaches under this token a moment from
	// now, and an agent pointed at it before then must not be told the token is wrong.
	if _, err := a.agents.Open(a.mcpToken); err != nil {
		a.mcpError = fmt.Sprintf("The MCP token is unusable: %s. Delete mcp-token and restart Kaja.", err)
		slog.Error("Failed to open the agent session", "error", err)
		return
	}
	addr := fmt.Sprintf("127.0.0.1:%d", mcpPort)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		// Don't fall back to a random port — that would silently break the static connection
		// command the user has configured.
		a.mcpError = fmt.Sprintf("Port %d is in use. Free it, then restart Kaja.", mcpPort)
		slog.Error("Failed to start MCP server", "addr", addr, "error", err)
		return
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/mcp", a.agents.ServeMCP)
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
	defer a.mcpMu.Unlock()
	srv := a.mcpServer
	a.mcpError = ""
	if srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		_ = srv.Close()
	}
	a.agents.Drop(a.mcpToken)
	a.mcpServer = nil
	a.mcpURL = ""
	slog.Info("MCP server stopped")
}

// loadOrCreateMCPToken returns the bearer token persisted next to kaja.json,
// generating one the first time (or if the stored file is missing, empty or
// unreadable). Persisting it keeps an installed client working when the server is
// turned on again. Startup is what calls it: minting is a thing kaja does, never a
// thing reporting the state of the server does.
// Must be called with mcpMu held.
func (a *App) loadOrCreateMCPToken() string {
	if token := a.readMCPToken(); token != "" {
		return token
	}
	token := randomToken(24)
	if err := a.writeMCPToken(token); err != nil {
		slog.Warn("Failed to persist MCP token", "error", err)
	}
	return token
}

// readMCPToken returns the token this workspace is reached under, or "" where none has
// been written yet. It never writes one: reporting the state of the server must not be
// what creates its credential.
// Must be called with mcpMu held.
func (a *App) readMCPToken() string {
	if a.mcpToken != "" {
		return a.mcpToken
	}
	data, err := os.ReadFile(a.mcpTokenPath())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// Must be called with mcpMu held.
func (a *App) writeMCPToken(token string) error {
	return os.WriteFile(a.mcpTokenPath(), []byte(token), 0600)
}

func (a *App) mcpTokenPath() string {
	return filepath.Join(a.workspaceDir, "mcp-token")
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand should never fail; fall back to a time-based value.
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b)
}

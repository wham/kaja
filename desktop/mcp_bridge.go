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

	"github.com/wham/kaja/v2/pkg/agent"
	"github.com/wham/kaja/v2/pkg/mcp"
)

// MCP wiring. The switchboard is pkg/agent's, the same one a deployed kaja answers an
// agent with, and the desktop is its degenerate case: one session on the token this
// process persists, with one window permanently attached over the mux the webview
// already fetches its calls on. What is left here is what only this process can do —
// the disk under the scripts folder, and a loopback listener, because an agent lives
// in another process and cannot reach a wails:// URL.

// mcpPort is the fixed loopback port the MCP server binds to. Fixed rather than
// OS-assigned so the connection command shown to the user stays valid across restarts.
// It sits next to kaja's web port (41520) in the registered range, so the OS won't
// hand it out as an ephemeral port.
const mcpPort = 41521

// MCPInfo is reported to the UI so it can show the connection command and attach its
// window to the session that command reaches. Error is set when the server couldn't
// start (e.g. the fixed port was already in use).
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

// mcpClientConfigurationPaths is the file each client keeps its MCP servers in, so
// the footer can link to the one it is telling you to edit. A client whose path this
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

// loadOrCreateMCPToken returns the bearer token persisted next to kaja.json,
// generating one the first time (or if the stored file is missing, empty or
// unreadable). Persisting it keeps the connection command stable across restarts.
// Must be called with mcpMu held.
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

// desktopScripts is the scripts folder as the process that owns it reads and writes
// it, which is the whole of what the desktop's half of the switchboard is.
//
// Nothing guards paths here: every one of the App's methods resolves the name it is
// given inside the scripts folder through an os.Root, which is the whole access
// boundary and the same one the browser goes through.
type desktopScripts struct{ app *App }

func (s desktopScripts) List() ([]mcp.ScriptInfo, error) {
	files, err := s.app.ListScripts()
	if err != nil {
		return nil, err
	}
	out := make([]mcp.ScriptInfo, 0, len(files))
	for _, f := range files {
		out = append(out, mcp.ScriptInfo{Path: f.Path, Name: f.Name, Folder: f.Folder})
	}
	return out, nil
}

func (s desktopScripts) Read(path string) (mcp.ScriptInfo, error) {
	f, err := s.app.ReadScriptFile(path)
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	return mcp.ScriptInfo{Path: f.Path, Name: f.Name, Folder: f.Folder, Content: f.Content}, nil
}

func (s desktopScripts) Write(path, content string) (agent.ScriptChange, error) {
	if err := s.app.WriteScriptFile(path, content); err != nil {
		return agent.ScriptChange{}, err
	}
	return agent.ScriptChange{Action: "write", Path: s.app.scriptPath(path), Content: content}, nil
}

func (s desktopScripts) Create(name, content string) (agent.ScriptChange, error) {
	f, err := s.app.CreateScript(name, content)
	if err != nil {
		return agent.ScriptChange{}, err
	}
	return agent.ScriptChange{Action: "create", Path: f.Path, Name: f.Name, Folder: f.Folder, Content: f.Content}, nil
}

func (s desktopScripts) Rename(path, newName string) (agent.ScriptChange, error) {
	from := s.app.scriptPath(path)
	f, err := s.app.RenameScript(path, newName)
	if err != nil {
		return agent.ScriptChange{}, err
	}
	return agent.ScriptChange{Action: "rename", OldPath: from, Path: f.Path, Name: f.Name, Folder: f.Folder, Content: f.Content}, nil
}

func (s desktopScripts) Delete(path string) (agent.ScriptChange, error) {
	resolved := s.app.scriptPath(path)
	if err := s.app.DeleteScript(path); err != nil {
		return agent.ScriptChange{}, err
	}
	return agent.ScriptChange{Action: "delete", Path: resolved}, nil
}

// CanWrite is the desktop's answer to the question a deployed kaja answers the other
// way: this process owns the workspace it opened.
func (s desktopScripts) CanWrite() bool { return true }

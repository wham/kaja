package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/kaja/v2/pkg/grpc"

	"github.com/wham/kaja/desktop/mcp"
)

// GitRef is the git commit hash or tag, set at build time via ldflags
var GitRef string

//go:embed all:frontend/dist
var assets embed.FS

//go:embed wails.json
var wailsJSON []byte

// WailsConfig represents the wails.json configuration
type WailsConfig struct {
	Info struct {
		ProductName    string `json:"productName"`
		ProductVersion string `json:"productVersion"`
		Copyright      string `json:"copyright"`
	} `json:"info"`
}

var config WailsConfig

func init() {
	if err := json.Unmarshal(wailsJSON, &config); err != nil {
		slog.Error("Failed to parse wails.json", "error", err)
	}
}

var cfBundleVersionRe = regexp.MustCompile(`(?s)<key>CFBundleVersion</key>\s*<string>([^<]*)</string>`)

// buildNumber returns the TestFlight/App Store build number stamped into the
// bundle's Info.plist (CFBundleVersion). The testflight script overrides
// CFBundleVersion with the build number; a plain `wails build` leaves it equal
// to the product version, so we only report it when the two differ.
func buildNumber() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	// macOS bundle layout: <App>.app/Contents/MacOS/<exe>, Info.plist one level up.
	plistPath := filepath.Join(filepath.Dir(filepath.Dir(exe)), "Info.plist")
	data, err := os.ReadFile(plistPath)
	if err != nil {
		return ""
	}
	match := cfBundleVersionRe.FindSubmatch(data)
	if match == nil {
		return ""
	}
	version := strings.TrimSpace(string(match[1]))
	if version == config.Info.ProductVersion {
		return ""
	}
	return version
}

// App struct
type App struct {
	ctx                  context.Context
	twirpHandler         api.TwirpServer
	apps                 *apps.Manager
	configurationWatcher *api.ConfigurationWatcher
	bookmarkStore        *BookmarkStore
	workspaceDir         string   // base for resolving relative protoDir; also holds the global scripts dir
	activeStreams        sync.Map // streamID -> context.CancelFunc

	// MCP server state (experimental). Guarded by mcpMu.
	mcpMu      sync.Mutex
	mcpServer  *http.Server
	mcpURL     string
	mcpToken   string
	mcpError   string
	mcpCatalog mcp.Catalog
	mcpPending map[string]chan mcp.RunResult
}

// NewApp creates a new App application struct
func NewApp(twirpHandler api.TwirpServer, appManager *apps.Manager, configurationWatcher *api.ConfigurationWatcher, bookmarkStore *BookmarkStore, workspaceDir string) *App {
	return &App{
		twirpHandler:         twirpHandler,
		apps:                 appManager,
		configurationWatcher: configurationWatcher,
		bookmarkStore:        bookmarkStore,
		workspaceDir:         workspaceDir,
		mcpPending:           make(map[string]chan mcp.RunResult),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Register the macOS "Run Kaja Script" text service (no-op on other platforms).
	registerServices(ctx)

	// Subscribe to configuration changes and emit Wails events
	if a.configurationWatcher != nil {
		a.configurationWatcher.Subscribe(func() {
			runtime.EventsEmit(ctx, "configuration:changed")
		})
	}

	// Toggle the File → "Save as script" menu item with the Scripts feature
	// preview. The UI reports the current state on load and whenever it changes.
	runtime.EventsOn(ctx, "scripts:previewEnabled", func(optionalData ...interface{}) {
		enabled := false
		if len(optionalData) > 0 {
			if b, ok := optionalData[0].(bool); ok {
				enabled = b
			}
		}
		runtime.MenuSetApplicationMenu(ctx, a.buildAppMenu(enabled))
		runtime.MenuUpdateApplicationMenu(ctx)
	})
}

// OnShutdown hook stops the MCP server if it is running.
func (a *App) shutdown(ctx context.Context) {
	a.stopMCPServer()
}

// buildAppMenu assembles the native application menu. The File menu holds only
// the experimental "Save as script" action, so it is included only when the
// Scripts feature preview is enabled.
func (a *App) buildAppMenu(scriptsEnabled bool) *menu.Menu {
	appMenu := menu.NewMenu()
	appMenu.Append(menu.AppMenu())

	if scriptsEnabled {
		fileMenu := appMenu.AddSubmenu("File")
		fileMenu.AddText("Save as script", keys.CmdOrCtrl("s"), func(_ *menu.CallbackData) {
			runtime.EventsEmit(a.ctx, "menu:saveScript")
		})
	}

	appMenu.Append(menu.EditMenu())
	viewMenu := appMenu.AddSubmenu("View")
	viewMenu.AddText("Reload", keys.CmdOrCtrl("r"), func(_ *menu.CallbackData) {
		runtime.WindowReloadApp(a.ctx)
	})
	appMenu.Append(menu.WindowMenu())

	helpMenu := appMenu.AddSubmenu("Help")
	helpMenu.AddText("Show Logs in Finder", nil, func(_ *menu.CallbackData) {
		a.showLogsInFinder()
	})

	return appMenu
}

// showLogsInFinder reveals the logs directory (see LogFromUI) in the system
// file browser, creating it first if it doesn't exist yet.
func (a *App) showLogsInFinder() {
	dir := filepath.Join(a.workspaceDir, "logs")
	if err := os.MkdirAll(dir, 0755); err != nil {
		slog.Warn("Failed to create logs directory", "error", err)
		return
	}
	revealInFinder(dir)
}

// ScriptFile is the on-disk representation of a Kaja script.
// For ListScripts only Path and Name are populated; Content is fetched
// on demand via ReadScriptFile.
type ScriptFile struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Content string `json:"content"`
}

// scriptsDir is the single global, flat scripts folder living next to kaja.json.
func (a *App) scriptsDir() string {
	return filepath.Join(a.workspaceDir, "scripts")
}

// ListScripts returns the *.ts files in the global scripts directory.
func (a *App) ListScripts() ([]ScriptFile, error) {
	entries, err := os.ReadDir(a.scriptsDir())
	if err != nil {
		if os.IsNotExist(err) {
			return []ScriptFile{}, nil
		}
		return nil, err
	}
	scripts := make([]ScriptFile, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") || !strings.HasSuffix(e.Name(), ".ts") {
			continue
		}
		scripts = append(scripts, ScriptFile{
			Path: filepath.Join(a.scriptsDir(), e.Name()),
			Name: e.Name(),
		})
	}
	return scripts, nil
}

// ReadScriptFile reads the contents of a script file by absolute path.
func (a *App) ReadScriptFile(path string) (*ScriptFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return &ScriptFile{
		Path:    path,
		Name:    filepath.Base(path),
		Content: string(data),
	}, nil
}

// WriteScriptFile writes content back to a known script path.
func (a *App) WriteScriptFile(path string, content string) error {
	if path == "" {
		return fmt.Errorf("empty path")
	}
	return os.WriteFile(path, []byte(content), 0644)
}

// CreateScript writes a new script into the global scripts directory and
// returns it. The name is reduced to a bare filename with a .ts extension;
// it fails if a script with that name already exists.
func (a *App) CreateScript(name string, content string) (*ScriptFile, error) {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." {
		return nil, fmt.Errorf("invalid script name")
	}
	if !strings.HasSuffix(name, ".ts") {
		name += ".ts"
	}
	dir := a.scriptsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, name)
	if _, err := os.Stat(path); err == nil {
		return nil, fmt.Errorf("a script named %q already exists", name)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return nil, err
	}
	return &ScriptFile{Path: path, Name: name, Content: content}, nil
}

// DeleteScript removes a script from the global scripts directory.
func (a *App) DeleteScript(path string) error {
	if path == "" {
		return fmt.Errorf("empty path")
	}
	return os.Remove(path)
}

// RenameScript renames a script within the global scripts directory and
// returns the renamed file. newName is reduced to a bare filename with a .ts
// extension; it fails if a different script with that name already exists.
func (a *App) RenameScript(path string, newName string) (*ScriptFile, error) {
	newName = filepath.Base(strings.TrimSpace(newName))
	if newName == "" || newName == "." {
		return nil, fmt.Errorf("invalid script name")
	}
	if !strings.HasSuffix(newName, ".ts") {
		newName += ".ts"
	}
	newPath := filepath.Join(a.scriptsDir(), newName)
	if newPath != path {
		if _, err := os.Stat(newPath); err == nil {
			return nil, fmt.Errorf("a script named %q already exists", newName)
		}
		if err := os.Rename(path, newPath); err != nil {
			return nil, err
		}
	}
	data, err := os.ReadFile(newPath)
	if err != nil {
		return nil, err
	}
	return &ScriptFile{Path: newPath, Name: newName, Content: string(data)}, nil
}

// LogFromUI appends a log line from the frontend to <kajaHome>/logs/kaja.log.
// Lines are tagged "[ui]" so the file can also hold server logs later; the
// webview console is otherwise only reachable through Web Inspector, so this
// lets TestFlight users capture frontend errors and share them for debugging.
func (a *App) LogFromUI(level string, message string) error {
	dir := filepath.Join(a.workspaceDir, "logs")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	line := fmt.Sprintf("%s [ui] [%s] %s\n", time.Now().Format(time.RFC3339), level, message)
	f, err := os.OpenFile(filepath.Join(dir, "kaja.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(line)
	return err
}

// OpenDirectoryDialog opens a native directory picker dialog.
// On macOS, it saves a security-scoped bookmark so the sandbox remembers
// access across app restarts.
func (a *App) OpenDirectoryDialog() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Workspace Directory",
	})
	if err != nil || dir == "" {
		return dir, err
	}

	if a.bookmarkStore != nil {
		if err := a.bookmarkStore.Save(dir, dir); err != nil {
			slog.Warn("Failed to save bookmark", "path", dir, "error", err)
		}
	}

	return dir, nil
}

// OpenFileDialog opens a native file picker for a single file. On macOS it saves
// a security-scoped bookmark for the chosen file so a sandboxed app (e.g. the
// Markdown app) can read and append to it across restarts.
func (a *App) OpenFileDialog() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Markdown File",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown", Pattern: "*.md;*.markdown"},
		},
	})
	if err != nil || path == "" {
		return path, err
	}

	if a.bookmarkStore != nil {
		if err := a.bookmarkStore.Save(path, path); err != nil {
			slog.Warn("Failed to save bookmark", "path", path, "error", err)
		}
	}

	return path, nil
}

func (a *App) Twirp(method string, req []byte) ([]byte, error) {
	slog.Info("Twirp called", "method", method, "req_length", len(req))

	if req == nil {
		slog.Error("Received nil request")
		return nil, fmt.Errorf("nil request")
	}

	// Empty requests are valid for methods with no parameters (like GetConfiguration)
	if len(req) == 0 {
		slog.Info("Received empty request - this is valid for methods with no parameters")
	} else {
		slog.Info("Request details", "req_first_10_bytes", req[:min(len(req), 10)])
	}

	url := "/twirp/Api/" + method
	httpReq, err := http.NewRequestWithContext(context.Background(), "POST", url, bytes.NewReader(req))
	if err != nil {
		slog.Error("Failed to create HTTP request", "error", err)
		return nil, err
	}

	slog.Info("Twirp request created successfully")

	httpReq.Header.Set("Content-Type", "application/protobuf")

	recorder := httptest.NewRecorder()
	a.twirpHandler.ServeHTTP(recorder, httpReq)

	response := recorder.Body.Bytes()
	slog.Info("Twirp response", "status", recorder.Code, "response_length", len(response))

	return response, nil
}

// TargetResult holds the response from a Target call, including HTTP status for
// Twirp. RequestHeaders/ResponseHeaders, when set, are the headers an in-process
// app exchanged with its upstream service (sensitive values redacted), surfaced
// in the client's Headers view.
type TargetResult struct {
	Body            []byte            `json:"body"`
	StatusCode      int               `json:"statusCode"`
	Status          string            `json:"status"`
	RequestHeaders  map[string]string `json:"requestHeaders,omitempty"`
	ResponseHeaders map[string]string `json:"responseHeaders,omitempty"`
}

// Target proxies external API calls to configured endpoints (similar to /target/{method...} in web server)
// The protocol parameter indicates which transport to use:
// - 1 = gRPC
// - 2 = Twirp
// The headersJson parameter is a JSON-encoded map of headers to forward to the target.
func (a *App) Target(target string, method string, req []byte, protocol int, headersJson string) (*TargetResult, error) {
	slog.Info("Target called", "target", target, "method", method, "protocol", protocol, "req_length", len(req), "headers", headersJson)

	if req == nil {
		slog.Error("Received nil request")
		return nil, fmt.Errorf("nil request")
	}

	// Parse headers from JSON
	headers := make(map[string]string)
	if headersJson != "" && headersJson != "{}" {
		if err := json.Unmarshal([]byte(headersJson), &headers); err != nil {
			slog.Error("Failed to parse headers JSON", "error", err)
			return nil, fmt.Errorf("failed to parse headers: %w", err)
		}
	}

	// App targets (kaja-app://<id>) are invoked in-process by the app manager.
	if apps.IsAppTarget(target) {
		result, err := a.apps.Invoke(target, method, req, headers)
		var upstream *apps.UpstreamError
		if errors.As(err, &upstream) {
			// Hand the structured upstream failure to the transport instead of
			// rejecting the promise with a flat string.
			return &TargetResult{Body: upstream.JSON(), StatusCode: upstream.Status, Status: upstream.StatusText}, nil
		}
		if err != nil {
			return nil, err
		}
		return &TargetResult{
			Body:            result.Body,
			RequestHeaders:  result.RequestHeaders,
			ResponseHeaders: result.ResponseHeaders,
		}, nil
	}

	// Use the transport to determine which handler to use
	switch protocol {
	case 1: // gRPC
		resp, err := a.targetGRPC(target, method, req, headers)
		if err != nil {
			return nil, err
		}
		return &TargetResult{Body: resp}, nil
	case 2: // Twirp
		return a.targetTwirp(target, method, req, headers)
	default:
		return nil, fmt.Errorf("invalid protocol: %d (must be 1 for gRPC or 2 for Twirp)", protocol)
	}
}

// targetGRPC handles gRPC protocol calls using the shared gRPC client
func (a *App) targetGRPC(target string, method string, req []byte, headers map[string]string) ([]byte, error) {
	slog.Info("Invoking gRPC target", "target", target, "method", method, "headers", len(headers))

	client, err := grpc.NewClientFromString(target)
	if err != nil {
		slog.Error("Failed to create gRPC client", "target", target, "error", err)
		return nil, err
	}

	slog.Info("gRPC client created", "target", target, "tls", client.UseTLS())

	response, err := client.InvokeWithTimeout(method, req, 30*time.Second, headers)
	if err != nil {
		slog.Error("gRPC invocation failed", "target", target, "method", method, "error", err)
		return nil, err
	}

	slog.Info("gRPC response received", "target", target, "method", method, "response_length", len(response))
	return response, nil
}

// targetTwirp handles Twirp protocol calls over HTTP
func (a *App) targetTwirp(target string, method string, req []byte, headers map[string]string) (*TargetResult, error) {
	var url string
	if strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://") {
		// Already a valid HTTP URL
		url = target + "/twirp/" + method
	} else {
		// Assume it's a host:port format, add http://
		url = "http://" + target + "/twirp/" + method
	}

	httpReq, err := http.NewRequestWithContext(context.Background(), "POST", url, bytes.NewReader(req))
	if err != nil {
		slog.Error("Failed to create HTTP request", "target", target, "method", method, "error", err)
		return nil, err
	}

	// Set appropriate headers for Twirp
	httpReq.Header.Set("Content-Type", "application/protobuf")

	// Forward configured headers to target
	for name, value := range headers {
		httpReq.Header.Set(name, value)
	}

	// Create HTTP client and make the request
	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		slog.Error("Failed to make HTTP request", "target", target, "method", method, "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	// Read response body
	var responseBuffer bytes.Buffer
	_, err = responseBuffer.ReadFrom(resp.Body)
	if err != nil {
		slog.Error("Failed to read response body", "target", target, "method", method, "error", err)
		return nil, err
	}

	response := responseBuffer.Bytes()
	slog.Info("Target response", "target", target, "method", method, "status", resp.StatusCode, "response_length", len(response))

	return &TargetResult{
		Body:       response,
		StatusCode: resp.StatusCode,
		Status:     http.StatusText(resp.StatusCode),
	}, nil
}

// restoreBookmarks resolves saved security-scoped bookmarks for all directories
// referenced in the configuration, re-granting sandbox access on app restart.
func restoreBookmarks(store *BookmarkStore, configurationPath string) {
	entries, err := store.loadEntries()
	if err != nil {
		return
	}
	for _, e := range entries {
		path, err := store.Restore(e.Key)
		if err != nil {
			slog.Warn("Failed to restore bookmark", "key", e.Key, "error", err)
			continue
		}
		slog.Info("Restored sandbox access", "path", path)
	}
}

// appSupportDir returns the app's sandboxed Application Support directory.
// Under App Sandbox this resolves to ~/Library/Containers/<bundle-id>/Data/Library/Application Support/kaja.
// Outside sandbox it resolves to ~/Library/Application Support/kaja.
func appSupportDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(homeDir, "Library", "Application Support", "kaja")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

// TargetServerStream starts a server-streaming gRPC call.
// Each response message is emitted as a Wails event "stream:<streamID>" with base64-encoded body.
// When the stream ends, "stream:<streamID>:end" is emitted.
// On error, "stream:<streamID>:error" is emitted with the error message.
func (a *App) TargetServerStream(target string, method string, req []byte, headersJson string, streamID string) error {
	slog.Info("TargetServerStream called", "target", target, "method", method, "streamID", streamID)

	if req == nil {
		return fmt.Errorf("nil request")
	}

	headers := make(map[string]string)
	if headersJson != "" && headersJson != "{}" {
		if err := json.Unmarshal([]byte(headersJson), &headers); err != nil {
			return fmt.Errorf("failed to parse headers: %w", err)
		}
	}

	client, err := grpc.NewClientFromString(target)
	if err != nil {
		return fmt.Errorf("failed to create gRPC client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	a.activeStreams.Store(streamID, cancel)

	messages, errc := client.ServerStream(ctx, method, req, headers)

	go func() {
		defer cancel()
		defer a.activeStreams.Delete(streamID)

		for msg := range messages {
			encoded := base64.StdEncoding.EncodeToString(msg)
			runtime.EventsEmit(a.ctx, "stream:"+streamID, encoded)
		}

		if err := <-errc; err != nil {
			slog.Error("Server stream error", "streamID", streamID, "error", err)
			runtime.EventsEmit(a.ctx, "stream:"+streamID+":error", err.Error())
		} else {
			runtime.EventsEmit(a.ctx, "stream:"+streamID+":end")
		}
	}()

	return nil
}

// CancelStream cancels an active streaming call.
func (a *App) CancelStream(streamID string) error {
	if cancel, ok := a.activeStreams.LoadAndDelete(streamID); ok {
		cancel.(context.CancelFunc)()
		return nil
	}
	return fmt.Errorf("stream not found: %s", streamID)
}

func main() {
	kajaDir, err := appSupportDir()
	if err != nil {
		slog.Error("Failed to get application support directory", "error", err)
		println("Error:", err.Error())
		return
	}

	setupLogging(kajaDir)

	configurationPath := filepath.Join(kajaDir, "kaja.json")

	// Ensure the global scripts directory exists so it's discoverable.
	if err := os.MkdirAll(filepath.Join(kajaDir, "scripts"), 0755); err != nil {
		slog.Warn("Failed to create scripts directory", "error", err)
	}

	// Create empty kaja.json if it doesn't exist
	if _, err := os.Stat(configurationPath); os.IsNotExist(err) {
		if err := os.WriteFile(configurationPath, []byte("{}"), 0644); err != nil {
			slog.Error("Failed to create configuration file", "path", configurationPath, "error", err)
			println("Error:", err.Error())
			return
		}
	}

	// Restore sandbox bookmarks for directories referenced in the configuration
	bookmarkStore := NewBookmarkStore(filepath.Join(kajaDir, "bookmarks.json"))
	restoreBookmarks(bookmarkStore, configurationPath)

	// Create API service
	apiService := api.NewApiService(configurationPath, true, GitRef, buildNumber())
	twirpHandler := api.NewApiServer(apiService)

	// Start configuration file watcher
	configurationWatcher, err := api.NewConfigurationWatcher(configurationPath)
	if err != nil {
		slog.Warn("Failed to start configuration watcher", "error", err)
	}

	// Create application with options
	app := NewApp(twirpHandler, apiService.Apps(), configurationWatcher, bookmarkStore, kajaDir)

	// The File menu starts hidden; the UI enables it once it reports the Scripts
	// feature preview as on (see startup).
	appMenu := app.buildAppMenu(false)

	err = wails.Run(&options.App{
		Title:  "Kaja",
		Width:  1024,
		Height: 768,
		Menu:   appMenu,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown: func(ctx context.Context) {
			app.shutdown(ctx)
			if configurationWatcher != nil {
				configurationWatcher.Close()
			}
		},
		Bind: []interface{}{
			app,
		},
		LogLevel: logger.ERROR,
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHidden(),
			About: &mac.AboutInfo{
				Title:   config.Info.ProductName + " " + config.Info.ProductVersion,
				Message: config.Info.Copyright,
			},
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

package main

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"sigs.k8s.io/yaml"

	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/kaja/v2/pkg/grpc"
	"github.com/wham/kaja/v2/pkg/mcp"
)

// GitRef is the git commit hash or tag, set at build time via ldflags
var GitRef string

// headerBandHeight is the 40px row the sidebar header and the command row share
// across the seam. The window buttons are centred on it rather than on the title bar
// AppKit would measure against.
const headerBandHeight = 40

// The project's configuration, which is also the product's identity: the same
// file the wails3 CLI reads and the bundle's Info.plist is rendered from.
//
//go:embed build/config.yml
var configurationYAML []byte

type Configuration struct {
	Info struct {
		ProductName string `json:"productName"`
		Version     string `json:"version"`
		Copyright   string `json:"copyright"`
	} `json:"info"`
}

var config Configuration

func init() {
	if err := yaml.Unmarshal(configurationYAML, &config); err != nil {
		slog.Error("Failed to parse build/config.yml", "error", err)
	}
}

var cfBundleVersionRe = regexp.MustCompile(`(?s)<key>CFBundleVersion</key>\s*<string>([^<]*)</string>`)

// buildNumber returns the TestFlight/App Store build number stamped into the
// bundle's Info.plist (CFBundleVersion). The testflight script overrides it; an
// ordinary bundle leaves it equal to the product version, so it is only reported
// when the two differ.
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
	if version == config.Info.Version {
		return ""
	}
	return version
}

type App struct {
	// The application and the one window it opens. v3 has no ambient context to
	// call the runtime through: what a v2 runtime.* call took a context for is a
	// method on one of these two.
	app                  *application.App
	window               *application.WebviewWindow
	api                  *api.ApiService
	configurationWatcher *api.ConfigurationWatcher
	bookmarkStore        *BookmarkStore
	workspaceDir         string   // base for resolving relative protoDir; also holds the global scripts dir
	activeStreams        sync.Map // streamID -> context.CancelFunc

	// Inbound kaja:// links, and whether the UI is listening for them yet.
	// Guarded by linkMu.
	linkMu       sync.Mutex
	linksReady   bool
	pendingLinks []string

	// MCP server state. Guarded by mcpMu.
	mcpMu      sync.Mutex
	mcpServer  *http.Server
	mcpURL     string
	mcpToken   string
	mcpError   string
	mcpCatalog mcp.Catalog
	mcpPending map[string]chan mcp.RunResult
}

func NewApp(apiService *api.ApiService, configurationWatcher *api.ConfigurationWatcher, bookmarkStore *BookmarkStore, workspaceDir string) *App {
	return &App{
		api:                  apiService,
		configurationWatcher: configurationWatcher,
		bookmarkStore:        bookmarkStore,
		workspaceDir:         workspaceDir,
		mcpPending:           make(map[string]chan mcp.RunResult),
	}
}

// attach hands the service the application and the window it drives. Called from
// main before Run, because both exist by then and every runtime call below is a
// method on one of them.
func (a *App) attach(app *application.App, window *application.WebviewWindow) {
	a.app = app
	a.window = window
}

// ServiceStartup is the v3 startup hook. It runs once, in registration order,
// before the frontend is served.
func (a *App) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	// The UI says when it is listening, and everything held so far goes to it.
	a.app.Event.On("link:ready", func(*application.CustomEvent) { a.flushLinks() })

	// The MCP server's lifetime is the process's: the UI only reports it.
	a.startMCPServer()

	if a.configurationWatcher != nil {
		a.configurationWatcher.Subscribe(func() {
			a.app.Event.Emit("configuration:changed")
		})
	}
	return nil
}

// ServiceShutdown stops the MCP server and the configuration watcher.
func (a *App) ServiceShutdown() error {
	a.stopMCPServer()
	if a.configurationWatcher != nil {
		a.configurationWatcher.Close()
	}
	return nil
}

// openLink is what macOS hands a kaja:// link to. It is held until the UI is
// listening rather than emitted at once: a link is what launches the app as often as
// not, and on a cold launch this runs long before there is a webview to hear it.
// What the link means is the UI's to decide (scriptLink.ts).
func (a *App) openLink(link string) {
	a.linkMu.Lock()
	if !a.linksReady {
		a.pendingLinks = append(a.pendingLinks, link)
		a.linkMu.Unlock()
		return
	}
	a.linkMu.Unlock()
	a.deliverLink(link)
}

func (a *App) flushLinks() {
	a.linkMu.Lock()
	a.linksReady = true
	pending := a.pendingLinks
	a.pendingLinks = nil
	a.linkMu.Unlock()

	for _, link := range pending {
		a.deliverLink(link)
	}
}

func (a *App) deliverLink(link string) {
	a.window.UnMinimise()
	a.window.Show()
	a.app.Event.Emit("link:open", link)
}

// buildAppMenu assembles the native application menu.
func (a *App) buildAppMenu() *application.Menu {
	appMenu := a.app.Menu.New()
	appMenu.AddRole(application.AppMenu)

	fileMenu := appMenu.AddSubmenu("File")
	fileMenu.Add("Save").SetAccelerator("CmdOrCtrl+S").OnClick(func(*application.Context) {
		a.app.Event.Emit("menu:saveScript")
	})

	appMenu.AddRole(application.EditMenu)
	viewMenu := appMenu.AddSubmenu("View")
	viewMenu.Add("Reload").SetAccelerator("CmdOrCtrl+R").OnClick(func(*application.Context) {
		a.window.Reload()
	})
	appMenu.AddRole(application.WindowMenu)

	helpMenu := appMenu.AddSubmenu("Help")
	helpMenu.Add("Show Config in Finder").OnClick(func(*application.Context) {
		a.showConfigurationInFinder()
	})
	helpMenu.Add("Show Logs in Finder").OnClick(func(*application.Context) {
		a.showLogsInFinder()
	})

	return appMenu
}

// showConfigurationInFinder reveals kaja.json in the system file browser with
// the file itself selected.
func (a *App) showConfigurationInFinder() {
	revealFileInFinder(filepath.Join(a.workspaceDir, "kaja.json"))
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

// ShowFileInFinder reveals a file in the system file browser with the file selected.
// A path that isn't there yet opens the nearest directory that is, so the link always
// lands somewhere.
func (a *App) ShowFileInFinder(path string) {
	if strings.TrimSpace(path) == "" {
		return
	}
	if _, err := os.Stat(path); err == nil {
		revealFileInFinder(path)
		return
	}
	for dir := filepath.Dir(path); ; {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			revealInFinder(dir)
			return
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return
		}
		dir = parent
	}
}

// LogFromUI appends a log line from the frontend to <kajaHome>/logs/kaja.log, tagged
// "[ui]". The webview console is otherwise only reachable through Web Inspector, so
// this is how a TestFlight user captures frontend errors.
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

// ResolvedVariables returns every configured variable's value, including the ones
// kaja.json only names. Scripts read them as kaja.variables.<name>. Desktop only: its
// UI runs inside this process, so there is no remote browser being handed a value it
// shouldn't have.
func (a *App) ResolvedVariables() (map[string]string, error) {
	return a.api.Variables().Values(), nil
}

// OpenDirectoryDialog opens a native directory picker. On macOS it saves a
// security-scoped bookmark so the sandbox remembers access across app restarts.
func (a *App) OpenDirectoryDialog() (string, error) {
	dir, err := a.app.Dialog.OpenFile().
		CanChooseFiles(false).
		CanChooseDirectories(true).
		SetTitle("Select Workspace Directory").
		PromptForSingleSelection()
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

// OpenFileDialog opens a native file picker for a single file. On macOS it saves a
// security-scoped bookmark so a sandboxed app (e.g. a gRPC app reading its
// certificates) can read the file across restarts.
func (a *App) OpenFileDialog() (string, error) {
	path, err := a.app.Dialog.OpenFile().
		CanChooseFiles(true).
		CanChooseDirectories(false).
		SetTitle("Select File").
		PromptForSingleSelection()
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

// Invoke calls the internal Api service (the desktop's counterpart to /Api/{method}).
// The webview and the service are one process, so the call is a dispatch rather than a
// wire: the request and the response are the encoded protobuf, and a failed call is the
// service's own error.
func (a *App) Invoke(method string, request []byte) ([]byte, error) {
	return a.api.Invoke(context.Background(), method, request)
}

// TargetResult holds the response from a Target call, including HTTP status for
// Twirp. RequestHeaders/ResponseHeaders are what an in-process app exchanged with its
// upstream, surfaced in the Headers view. DurationMs is the upstream exchange as this
// process measured it — the call without the webview round trip — which the UI shows
// in place of its own timing.
type TargetResult struct {
	Body            []byte            `json:"body"`
	StatusCode      int               `json:"statusCode"`
	Status          string            `json:"status"`
	RequestHeaders  map[string]string `json:"requestHeaders,omitempty"`
	ResponseHeaders map[string]string `json:"responseHeaders,omitempty"`
	// What a gRPC server answered with. That lane is a bridge rather than a hop —
	// the same call is forwarded — so the metadata is the response's own, the way
	// the web proxy hands it back as gRPC-Web trailers.
	Trailers   map[string]string `json:"trailers,omitempty"`
	DurationMs int64             `json:"durationMs"`
}

// Target proxies external API calls to configured endpoints (the desktop's
// counterpart to /target/{method...}). protocol is 1 for gRPC and 2 for Twirp;
// headersJson is a JSON-encoded map of headers to forward.
func (a *App) Target(target string, method string, req []byte, protocol int, headersJson string) (*TargetResult, error) {
	slog.Info("Target called", "target", target, "method", method, "protocol", protocol, "req_length", len(req), "headers", headersJson)

	if req == nil {
		slog.Error("Received nil request")
		return nil, fmt.Errorf("nil request")
	}

	headers := make(map[string]string)
	if headersJson != "" && headersJson != "{}" {
		if err := json.Unmarshal([]byte(headersJson), &headers); err != nil {
			slog.Error("Failed to parse headers JSON", "error", err)
			return nil, fmt.Errorf("failed to parse headers: %w", err)
		}
	}

	// The reserved header names the app the call belongs to, and goes no further:
	// it is what the credential and the transport are looked up by.
	appName := apps.TakeAppName(headers)

	// App targets (kaja-app://<id>) are invoked in-process by the app manager. InvokeApp
	// expands the ${NAME} references the headers still carry and masks the resolved
	// values back out of what it reports exchanging.
	if apps.IsAppTarget(target) {
		result, err := a.api.InvokeApp(target, method, req, headers)
		var upstream *apps.UpstreamError
		if errors.As(err, &upstream) {
			// Hand the structured upstream failure to the transport instead of rejecting the
			// promise with a flat string. The exchanged headers ride along so the Headers view is
			// populated even on a failure. StatusCode is the transport's, not the report's: it is
			// the one field saying the body is a failure, and the upstream's own status travels
			// inside the JSON.
			return &TargetResult{
				Body:            upstream.JSON(),
				StatusCode:      upstream.TransportStatus(),
				Status:          http.StatusText(upstream.TransportStatus()),
				RequestHeaders:  upstream.RequestHeaders,
				ResponseHeaders: upstream.ResponseHeaders,
				DurationMs:      upstream.DurationMs,
			}, nil
		}
		if err != nil {
			return nil, err
		}
		return &TargetResult{
			Body:            result.Body,
			RequestHeaders:  result.RequestHeaders,
			ResponseHeaders: result.ResponseHeaders,
			DurationMs:      result.DurationMs,
		}, nil
	}

	headers = a.api.Variables().ExpandAll(headers)
	// The app's own credential is applied here rather than sent from the webview,
	// so a "${secret}" token stays where kaja keeps it.
	connection := a.api.AppConnection(appName)
	headers = apps.MergeMetadata(headers, connection.Metadata)
	switch protocol {
	case 1: // gRPC
		started := time.Now()
		resp, responseMetadata, err := a.targetGRPC(target, method, req, headers, connection.TLS)
		if err != nil {
			return nil, err
		}
		return &TargetResult{Body: resp, Trailers: responseMetadata, DurationMs: time.Since(started).Milliseconds()}, nil
	case 2: // Twirp
		return a.targetTwirp(target, method, req, headers)
	default:
		return nil, fmt.Errorf("invalid protocol: %d (must be 1 for gRPC or 2 for Twirp)", protocol)
	}
}

func (a *App) targetGRPC(target string, method string, req []byte, headers map[string]string, options grpc.TLSOptions) ([]byte, map[string]string, error) {
	slog.Info("Invoking gRPC target", "target", target, "method", method, "headers", len(headers))

	client, err := grpc.NewClientFromString(target, options)
	if err != nil {
		slog.Error("Failed to create gRPC client", "target", target, "error", err)
		return nil, nil, err
	}

	slog.Info("gRPC client created", "target", target, "tls", client.UseTLS())

	response, responseMetadata, err := client.InvokeWithTimeout(method, req, 30*time.Second, headers)
	if err != nil {
		slog.Error("gRPC invocation failed", "target", target, "method", method, "error", err)
		return nil, nil, err
	}

	slog.Info("gRPC response received", "target", target, "method", method, "response_length", len(response))
	return response, responseMetadata, nil
}

func (a *App) targetTwirp(target string, method string, req []byte, headers map[string]string) (*TargetResult, error) {
	var url string
	if strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://") {
		// Already a valid HTTP URL.
		url = target + "/twirp/" + method
	} else {
		// Assume host:port.
		url = "http://" + target + "/twirp/" + method
	}

	httpReq, err := http.NewRequestWithContext(context.Background(), "POST", url, bytes.NewReader(req))
	if err != nil {
		slog.Error("Failed to create HTTP request", "target", target, "method", method, "error", err)
		return nil, err
	}

	httpReq.Header.Set("Content-Type", "application/protobuf")

	for name, value := range headers {
		httpReq.Header.Set(name, value)
	}

	client := &http.Client{}
	started := time.Now()
	resp, err := client.Do(httpReq)
	if err != nil {
		slog.Error("Failed to make HTTP request", "target", target, "method", method, "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	var responseBuffer bytes.Buffer
	_, err = responseBuffer.ReadFrom(resp.Body)
	if err != nil {
		slog.Error("Failed to read response body", "target", target, "method", method, "error", err)
		return nil, err
	}
	durationMs := time.Since(started).Milliseconds()

	response := responseBuffer.Bytes()
	slog.Info("Target response", "target", target, "method", method, "status", resp.StatusCode, "response_length", len(response))

	return &TargetResult{
		Body:       response,
		StatusCode: resp.StatusCode,
		Status:     http.StatusText(resp.StatusCode),
		DurationMs: durationMs,
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

	appName := apps.TakeAppName(headers)
	headers = a.api.Variables().ExpandAll(headers)
	connection := a.api.AppConnection(appName)
	headers = apps.MergeMetadata(headers, connection.Metadata)

	client, err := grpc.NewClientFromString(target, connection.TLS)
	if err != nil {
		return fmt.Errorf("failed to create gRPC client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	a.activeStreams.Store(streamID, cancel)

	started := time.Now()

	go func() {
		defer cancel()
		defer a.activeStreams.Delete(streamID)

		fail := func(err error) {
			slog.Error("Server stream error", "streamID", streamID, "error", err)
			a.app.Event.Emit("stream:"+streamID+":error", err.Error())
		}
		// The stream's upstream duration rides the end event, mirroring the
		// kaja-upstream-duration-ms trailer of a unary call.
		end := func() {
			a.app.Event.Emit("stream:"+streamID+":end", time.Since(started).Milliseconds())
		}

		stream, err := client.OpenServerStream(ctx, method, req, headers)
		if err != nil {
			fail(err)
			return
		}

		for {
			message, err := stream.Recv()
			if err != nil {
				// A cancelled stream ended because it was asked to, which is not a
				// failure to report.
				if errors.Is(err, io.EOF) || ctx.Err() != nil {
					end()
				} else {
					fail(err)
				}
				return
			}
			a.app.Event.Emit("stream:"+streamID, base64.StdEncoding.EncodeToString(message))
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

	if _, err := os.Stat(configurationPath); os.IsNotExist(err) {
		if err := os.WriteFile(configurationPath, []byte("{}"), 0644); err != nil {
			slog.Error("Failed to create configuration file", "path", configurationPath, "error", err)
			println("Error:", err.Error())
			return
		}
	}

	bookmarkStore := NewBookmarkStore(filepath.Join(kajaDir, "bookmarks.json"))
	restoreBookmarks(bookmarkStore, configurationPath)

	// Create API service. Variable values that kaja.json only names live in the
	// OS keychain, filed under this configuration.
	apiService := api.NewApiService(configurationPath, true, GitRef, buildNumber(), NewKeychainStore(configurationPath))

	configurationWatcher, err := api.NewConfigurationWatcher(configurationPath)
	if err != nil {
		slog.Warn("Failed to start configuration watcher", "error", err)
	}

	kaja := NewApp(apiService, configurationWatcher, bookmarkStore, kajaDir)

	// Creating the application, creating the window and running are three steps in v3.
	// The About box is the application's Name and Description rather than a Mac option:
	// the AppMenu role's About item shows them.
	wailsApp := application.New(application.Options{
		Name:        config.Info.ProductName,
		Description: config.Info.Version + "\n" + config.Info.Copyright,
		Services: []application.Service{
			application.NewService(kaja),
		},
		Assets: application.AssetOptions{
			Handler: assetHandler(),
		},
		LogLevel: slog.LevelError,
		Mac: application.MacOptions{
			// v2 quit with its only window; v3 keeps the application alive unless told.
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// The window buttons are part of the same row as the sidebar header and the command
	// row. Asked for here rather than from the startup hook, which runs behind whatever
	// else that hook does: this is the window's geometry, so it is queued before the app
	// runs rather than racing the first frame.
	alignTrafficLights(headerBandHeight)

	window := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: config.Info.ProductName,
		// The size VS Code and its forks open a workspace window at, and the minimum they
		// allow. Wails centers the window on the display for us.
		Width:            1440,
		Height:           900,
		MinWidth:         400,
		MinHeight:        270,
		BackgroundColour: application.NewRGB(27, 38, 54),
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarHidden,
		},
		URL: "/",
	})

	kaja.attach(wailsApp, window)
	wailsApp.Menu.Set(kaja.buildAppMenu())

	// A kaja:// link is an application event in v3 rather than a Mac option. Registered
	// before Run so the URL a cold launch arrives with is not the one that is missed.
	wailsApp.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(event *application.ApplicationEvent) {
		kaja.openLink(event.Context().URL())
	})

	if err := wailsApp.Run(); err != nil {
		println("Error:", err.Error())
	}
}

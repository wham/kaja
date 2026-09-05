package main

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
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

	"github.com/wham/kaja/v2/pkg/agent"
	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/router"
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
	app           *application.App
	window        *application.WebviewWindow
	api           *api.ApiService
	bookmarkStore *BookmarkStore
	workspaceDir  string // base for resolving relative protoDir; also holds the global scripts dir

	// Inbound kaja:// links, and whether the UI is listening for them yet.
	// Guarded by linkMu.
	linkMu       sync.Mutex
	linksReady   bool
	pendingLinks []string

	// The switchboard an agent reaches this window through, and the optional loopback
	// listener that puts it in front of a process that is not this one. Guarded by mcpMu.
	agents    *agent.Registry
	mcpMu     sync.Mutex
	mcpServer *http.Server
	mcpURL    string
	mcpToken  string
	mcpError  string
}

func NewApp(apiService *api.ApiService, bookmarkStore *BookmarkStore, workspaceDir string) *App {
	app := &App{
		api:           apiService,
		bookmarkStore: bookmarkStore,
		workspaceDir:  workspaceDir,
	}
	// One session, one window, and no proxy between an agent and this process: the same
	// switchboard the web runs, over the same scripts folder the window's own sidebar
	// reads, and answering at once because nothing sits in front of it.
	app.agents = agent.NewRegistry(agent.NewWorkspaceScripts(apiService), agent.Direct)
	return app
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

	// The token is the workspace's address rather than the listener's, so it is minted
	// when kaja starts rather than when its server does: the MCP page names it and every
	// snippet on it is copyable before the switch has ever been turned on.
	a.mcpMu.Lock()
	a.mcpToken = a.loadOrCreateMCPToken()
	a.mcpMu.Unlock()

	return nil
}

// ServiceShutdown stops the MCP server and whatever the Api service is watching.
func (a *App) ServiceShutdown() error {
	a.stopMCPServer()
	return a.api.Close()
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
	fileMenu.Add("New Script").SetAccelerator("CmdOrCtrl+N").OnClick(func(*application.Context) {
		a.app.Event.Emit("menu:newScript")
	})
	fileMenu.Add("New App…").OnClick(func(*application.Context) {
		a.app.Event.Emit("menu:newApp")
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
	selectInFinder(filepath.Join(a.workspaceDir, "kaja.json"))
}

// showLogsInFinder reveals the logs directory (see LogFromUI) in the system
// file browser, creating it first if it doesn't exist yet.
func (a *App) showLogsInFinder() {
	dir := filepath.Join(a.workspaceDir, "logs")
	if err := os.MkdirAll(dir, 0755); err != nil {
		slog.Warn("Failed to create logs directory", "error", err)
		return
	}
	openFolderInFinder(dir)
}

// ShowFileInFinder reveals a path in the system file browser, selected in the folder
// holding it. A path that isn't there yet falls back to the nearest ancestor that is,
// so the link always lands somewhere.
//
// Everything here goes through the selecting call rather than opening the folder,
// because a sandboxed kaja is not allowed to open a folder it has no access to and an
// agent's configuration file is one such folder every time. Revealing is not gated the
// same way: Finder does it on kaja's behalf, so it works wherever the path is.
func (a *App) ShowFileInFinder(path string) {
	if target := revealTarget(path); target != "" {
		selectInFinder(target)
	}
}

// revealTarget is the path Finder is pointed at: the one asked for, or the nearest
// ancestor that answers for itself. Empty where there is nothing to reveal.
func revealTarget(path string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	for p := path; ; {
		// A stat that fails for anything but the path not being there is a question this
		// process can't answer — under the App Sandbox a path outside the container may
		// refuse its metadata — so Finder is asked about it rather than the walk climbing
		// past the folder the answer was in.
		if _, err := os.Stat(p); err == nil || !errors.Is(err, os.ErrNotExist) {
			return p
		}
		parent := filepath.Dir(p)
		if parent == p {
			return ""
		}
		p = parent
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

// webviewHandler is everything the window fetches: the UI, the two call lanes the
// web server answers on, the agent switchboard it offers itself to, and the one lane
// only the desktop has. The webview asks for all of it over HTTP the way a browser
// does — same requests, same gRPC-Web framing, same X-Kaja-App and kaja-upstream
// channels, same NDJSON stream — so the desktop has no transport of its own and
// nothing to keep in step.
func webviewHandler(apiService *api.ApiService, agents *agent.Registry, assets http.Handler) http.Handler {
	mux := http.NewServeMux()
	router.Mount(mux, apiService)
	agent.Mount(mux, agents)
	// Registered here rather than in router.Mount, which the web serves too: a script's
	// own fetch is the browser's call everywhere a browser can make it.
	mountFetch(mux, &http.Client{})
	mux.Handle("/", assets)
	return mux
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

	kaja := NewApp(apiService, bookmarkStore, kajaDir)

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
			Handler: webviewHandler(apiService, kaja.agents, assetHandler()),
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

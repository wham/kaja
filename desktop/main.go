package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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
	"github.com/wham/kaja/v2/pkg/grpc"
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

// App struct
type App struct {
	ctx                  context.Context
	twirpHandler         api.TwirpServer
	configurationWatcher *api.ConfigurationWatcher
}

// NewApp creates a new App application struct
func NewApp(twirpHandler api.TwirpServer, configurationWatcher *api.ConfigurationWatcher) *App {
	return &App{
		twirpHandler:         twirpHandler,
		configurationWatcher: configurationWatcher,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Subscribe to configuration changes and emit Wails events
	if a.configurationWatcher != nil {
		a.configurationWatcher.Subscribe(func() {
			runtime.EventsEmit(ctx, "configuration:changed")
		})
	}
}

// OpenDirectoryDialog opens a native directory picker dialog
func (a *App) OpenDirectoryDialog() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Workspace Directory",
	})
}

// UpdateInfo contains information about available updates
type UpdateInfo struct {
	UpdateAvailable bool   `json:"updateAvailable"`
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	DownloadUrl     string `json:"downloadUrl"`
	Error           string `json:"error"`
}

// CheckForUpdate checks GitHub releases for a newer version
func (a *App) CheckForUpdate() *UpdateInfo {
	currentVersion := GitRef
	result := &UpdateInfo{
		CurrentVersion: currentVersion,
	}

	if currentVersion == "" {
		result.Error = "Current version not available"
		return result
	}

	// Fetch latest release from GitHub
	req, err := http.NewRequestWithContext(a.ctx, "GET", "https://api.github.com/repos/wham/kaja/releases/latest", nil)
	if err != nil {
		result.Error = fmt.Sprintf("failed to create request: %v", err)
		return result
	}

	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "kaja-update-checker")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		result.Error = fmt.Sprintf("failed to fetch releases: %v", err)
		return result
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		result.Error = fmt.Sprintf("GitHub API returned status %d", resp.StatusCode)
		return result
	}

	var release struct {
		TagName string `json:"tag_name"`
		HtmlUrl string `json:"html_url"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		result.Error = fmt.Sprintf("failed to parse response: %v", err)
		return result
	}

	result.LatestVersion = release.TagName
	result.DownloadUrl = release.HtmlUrl

	// Check if update is available
	if release.TagName != "" {
		if currentVersion != release.TagName && currentVersion != strings.TrimPrefix(release.TagName, "v") {
			result.UpdateAvailable = true
		}
	}

	return result
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

// TargetResult holds the response from a Target call, including HTTP status for Twirp.
type TargetResult struct {
	Body       []byte `json:"body"`
	StatusCode int    `json:"statusCode"`
	Status     string `json:"status"`
}

// Target proxies external API calls to configured endpoints (similar to /target/{method...} in web server)
// The protocol parameter indicates which RPC protocol to use:
// - 1 = gRPC (RPC_PROTOCOL_GRPC)
// - 2 = Twirp (RPC_PROTOCOL_TWIRP)
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

	// Use protocol enum to determine which handler to use
	switch protocol {
	case 1: // RPC_PROTOCOL_GRPC
		resp, err := a.targetGRPC(target, method, req, headers)
		if err != nil {
			return nil, err
		}
		return &TargetResult{Body: resp}, nil
	case 2: // RPC_PROTOCOL_TWIRP
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

func main() {
	// Get user's home directory and use ~/.kaja for config
	homeDir, err := os.UserHomeDir()
	if err != nil {
		slog.Error("Failed to get user home directory", "error", err)
		println("Error:", err.Error())
		return
	}

	kajaDir := filepath.Join(homeDir, ".kaja")
	configurationPath := filepath.Join(kajaDir, "kaja.json")

	// Create ~/.kaja directory if it doesn't exist
	if err := os.MkdirAll(kajaDir, 0755); err != nil {
		slog.Error("Failed to create kaja directory", "path", kajaDir, "error", err)
		println("Error:", err.Error())
		return
	}

	// Create empty kaja.json if it doesn't exist
	if _, err := os.Stat(configurationPath); os.IsNotExist(err) {
		if err := os.WriteFile(configurationPath, []byte("{}"), 0644); err != nil {
			slog.Error("Failed to create configuration file", "path", configurationPath, "error", err)
			println("Error:", err.Error())
			return
		}
	}

	// Create API service without embedded binaries
	apiService := api.NewApiService(configurationPath, true, GitRef)
	twirpHandler := api.NewApiServer(apiService)

	// Start configuration file watcher
	configurationWatcher, err := api.NewConfigurationWatcher(configurationPath)
	if err != nil {
		slog.Warn("Failed to start configuration watcher", "error", err)
	}

	// Create application with options
	app := NewApp(twirpHandler, configurationWatcher)

	appMenu := menu.NewMenu()
	appMenu.Append(menu.AppMenu())
	appMenu.Append(menu.EditMenu())
	viewMenu := appMenu.AddSubmenu("View")
	viewMenu.AddText("Reload", keys.CmdOrCtrl("r"), func(_ *menu.CallbackData) {
		runtime.WindowReloadApp(app.ctx)
	})

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
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

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/wham/kaja/v2/pkg/api"
)

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
	ctx          context.Context
	twirpHandler api.TwirpServer
}

// NewApp creates a new App application struct
func NewApp(twirpHandler api.TwirpServer) *App {
	return &App{
		twirpHandler: twirpHandler,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// OpenDirectoryDialog opens a native directory picker dialog
func (a *App) OpenDirectoryDialog() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Workspace Directory",
	})
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

// Target proxies external API calls to configured endpoints (similar to /target/{method...} in web server)
func (a *App) Target(target string, method string, req []byte) ([]byte, error) {
	slog.Info("Target called", "target", target, "method", method, "req_length", len(req))
	
	if req == nil {
		slog.Error("Received nil request")
		return nil, fmt.Errorf("nil request")
	}
	
	// Check if this is a gRPC target (starts with dns:)
	if strings.HasPrefix(target, "dns:") {
		// For gRPC targets, we need to return an error since gRPC-web is not supported in desktop mode
		slog.Error("gRPC endpoints not supported in desktop mode", "target", target, "method", method)
		return nil, fmt.Errorf("gRPC endpoints not supported in desktop mode")
	}
	
	// Handle HTTP/HTTPS Twirp endpoints
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

	if resp.StatusCode != http.StatusOK {
		slog.Error("Target request failed", "target", target, "method", method, "status", resp.StatusCode)
		return nil, fmt.Errorf("target request failed with status %d", resp.StatusCode)
	}

	return response, nil
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
	apiService := api.NewApiService(configurationPath, true)
	twirpHandler := api.NewApiServer(apiService)
	
	// Create application with options
	app := NewApp(twirpHandler)

	err = wails.Run(&options.App{
		Title:  "kaja",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
		LogLevel: logger.ERROR,
		Mac: &mac.Options{
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
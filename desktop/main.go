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
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/grpc"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed wails.json
var wailsJSON []byte

//go:embed all:demo
var demoFS embed.FS

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

// InstallDemo copies demo kaja.json and proto files from embedded resources to ~/.kaja
func (a *App) InstallDemo() error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		slog.Error("Failed to get user home directory", "error", err)
		return fmt.Errorf("failed to get user home directory: %w", err)
	}

	kajaDir := filepath.Join(homeDir, ".kaja")
	slog.Info("Installing demo to", "path", kajaDir)

	// Copy all files from embedded demo FS to ~/.kaja
	err = copyEmbeddedDir(demoFS, "demo", kajaDir)
	if err != nil {
		slog.Error("Failed to copy demo files", "error", err)
		return fmt.Errorf("failed to copy demo files: %w", err)
	}

	slog.Info("Demo installed successfully")
	return nil
}

// copyEmbeddedDir recursively copies files from an embedded FS to the destination directory
func copyEmbeddedDir(srcFS embed.FS, srcDir string, dstDir string) error {
	entries, err := srcFS.ReadDir(srcDir)
	if err != nil {
		return fmt.Errorf("failed to read directory %s: %w", srcDir, err)
	}

	for _, entry := range entries {
		srcPath := filepath.Join(srcDir, entry.Name())
		dstPath := filepath.Join(dstDir, entry.Name())

		if entry.IsDir() {
			// Create directory and recurse
			if err := os.MkdirAll(dstPath, 0755); err != nil {
				return fmt.Errorf("failed to create directory %s: %w", dstPath, err)
			}
			if err := copyEmbeddedDir(srcFS, srcPath, dstPath); err != nil {
				return err
			}
		} else {
			// Copy file
			content, err := srcFS.ReadFile(srcPath)
			if err != nil {
				return fmt.Errorf("failed to read file %s: %w", srcPath, err)
			}
			if err := os.WriteFile(dstPath, content, 0644); err != nil {
				return fmt.Errorf("failed to write file %s: %w", dstPath, err)
			}
			slog.Info("Copied demo file", "path", dstPath)
		}
	}

	return nil
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
		return a.targetGRPC(target, method, req)
	}

	// Handle HTTP/HTTPS Twirp endpoints
	return a.targetTwirp(target, method, req)
}

// targetGRPC handles gRPC protocol calls using the shared gRPC client
func (a *App) targetGRPC(target string, method string, req []byte) ([]byte, error) {
	slog.Info("Invoking gRPC target", "target", target, "method", method)

	client, err := grpc.NewClientFromString(target)
	if err != nil {
		slog.Error("Failed to create gRPC client", "target", target, "error", err)
		return nil, err
	}

	slog.Info("gRPC client created", "target", target, "tls", client.UseTLS())

	response, err := client.InvokeWithTimeout(method, req, 30*time.Second)
	if err != nil {
		slog.Error("gRPC invocation failed", "target", target, "method", method, "error", err)
		return nil, err
	}

	slog.Info("gRPC response received", "target", target, "method", method, "response_length", len(response))
	return response, nil
}

// targetTwirp handles Twirp protocol calls over HTTP
func (a *App) targetTwirp(target string, method string, req []byte) ([]byte, error) {
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
		Title:  "Kaja",
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
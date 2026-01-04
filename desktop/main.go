package main

import (
	"bytes"
	"context"
	"embed"
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

	"github.com/wham/kaja/v2/pkg/api"
)

//go:embed all:frontend/dist
var assets embed.FS

// App struct
type App struct {
	twirpHandler  api.TwirpServer
}

// NewApp creates a new App application struct
func NewApp(twirpHandler api.TwirpServer) *App {
	return &App{
		twirpHandler:  twirpHandler,
		}
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
	// Get user's home directory and use ~/kaja for config
	homeDir, err := os.UserHomeDir()
	if err != nil {
		slog.Error("Failed to get user home directory", "error", err)
		println("Error:", err.Error())
		return
	}

	kajaDir := filepath.Join(homeDir, "kaja")
	configPath := filepath.Join(kajaDir, "kaja.json")

	// Create ~/kaja directory if it doesn't exist
	if err := os.MkdirAll(kajaDir, 0755); err != nil {
		slog.Error("Failed to create kaja directory", "path", kajaDir, "error", err)
		println("Error:", err.Error())
		return
	}

	getConfigurationResponse := api.LoadGetConfigurationResponse(configPath, true)

	// Create API service without embedded binaries
	apiService := api.NewApiService(getConfigurationResponse, configPath)
	twirpHandler := api.NewApiServer(apiService)
	
	// Create application with options
	app := NewApp(twirpHandler)

	err = wails.Run(&options.App{
		Title:  "Kaja Compiler",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		Bind: []interface{}{
			app,
		},
		LogLevel: logger.ERROR,
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
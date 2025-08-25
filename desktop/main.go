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
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/wham/kaja/v2/pkg/api"
)

//go:embed all:frontend/dist
var assets embed.FS

// App struct
type App struct {
	ctx           context.Context
	twirpHandler  api.TwirpServer
	apiService    *api.ApiService
	configPath    string
}

// NewApp creates a new App application struct
func NewApp(twirpHandler api.TwirpServer, apiService *api.ApiService, configPath string) *App {
	return &App{
		twirpHandler:  twirpHandler,
		apiService:    apiService,
		configPath:    configPath,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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

// SelectFiles opens a file dialog for selecting proto files
func (a *App) SelectFiles() ([]string, error) {
	options := runtime.OpenDialogOptions{
		Title: "Select Proto Files",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Proto Files",
				Pattern:     "*.proto",
			},
			{
				DisplayName: "All Files",
				Pattern:     "*.*",
			},
		},
		CanCreateDirectories: false,
		ShowHiddenFiles:      false,
	}
	
	files, err := runtime.OpenMultipleFilesDialog(a.ctx, options)
	if err != nil {
		slog.Error("Failed to open file dialog", "error", err)
		return nil, err
	}
	
	return files, nil
}

// AddProject handles adding a new project to the configuration
func (a *App) AddProject(name string, url string, protocol string, protoFiles []string) error {
	slog.Info("Adding new project", "name", name, "url", url, "protocol", protocol, "files", len(protoFiles))
	
	// Get home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}
	
	kajaDir := filepath.Join(homeDir, ".kaja")
	projectDir := filepath.Join(kajaDir, name)
	
	// Create project directory
	if err := os.MkdirAll(projectDir, 0755); err != nil {
		return fmt.Errorf("failed to create project directory: %w", err)
	}
	
	// Copy proto files to project directory
	for _, srcPath := range protoFiles {
		fileName := filepath.Base(srcPath)
		dstPath := filepath.Join(projectDir, fileName)
		
		// Read source file
		data, err := os.ReadFile(srcPath)
		if err != nil {
			return fmt.Errorf("failed to read proto file %s: %w", srcPath, err)
		}
		
		// Write to destination
		if err := os.WriteFile(dstPath, data, 0644); err != nil {
			return fmt.Errorf("failed to write proto file %s: %w", dstPath, err)
		}
		
		slog.Info("Copied proto file", "from", srcPath, "to", dstPath)
	}
	
	// Load current configuration
	config, err := api.LoadConfiguration(a.configPath)
	if err != nil {
		return fmt.Errorf("failed to load configuration: %w", err)
	}
	
	// Determine RPC protocol
	var rpcProtocol api.RpcProtocol
	switch strings.ToUpper(protocol) {
	case "GRPC":
		rpcProtocol = api.RpcProtocol_RPC_PROTOCOL_GRPC
	case "TWIRP":
		rpcProtocol = api.RpcProtocol_RPC_PROTOCOL_TWIRP
	default:
		rpcProtocol = api.RpcProtocol_RPC_PROTOCOL_TWIRP
	}
	
	// Add new project to configuration
	newProject := &api.ConfigurationProject{
		Name:      name,
		Url:       url,
		Protocol:  rpcProtocol,
		Workspace: projectDir,
	}
	
	config.Projects = append(config.Projects, newProject)
	
	// Save updated configuration
	if err := api.SaveConfiguration(a.configPath, config); err != nil {
		return fmt.Errorf("failed to save configuration: %w", err)
	}
	
	// Reload configuration and trigger recompilation
	getConfigurationResponse := api.LoadGetConfigurationResponse(a.configPath)
	a.apiService.UpdateConfiguration(getConfigurationResponse)
	
	// Trigger compilation for the new project
	if err := a.apiService.CompileProject(name); err != nil {
		slog.Error("Failed to compile project", "name", name, "error", err)
		// Don't fail the whole operation if compilation fails
	}
	
	slog.Info("Project added successfully", "name", name)
	return nil
}

func main() {
	// Get home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		slog.Error("Failed to get home directory", "error", err)
		panic(err)
	}
	
	// Create ~/.kaja directory if it doesn't exist
	kajaDir := filepath.Join(homeDir, ".kaja")
	if err := os.MkdirAll(kajaDir, 0755); err != nil {
		slog.Error("Failed to create ~/.kaja directory", "error", err)
		panic(err)
	}
	
	// Config path
	configPath := filepath.Join(kajaDir, "kaja.json")
	
	// Load configuration using the enhanced function
	getConfigurationResponse := api.LoadGetConfigurationResponse(configPath)
	
	// If config doesn't exist, create an empty one
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		slog.Info("Creating empty configuration file", "path", configPath)
		emptyConfig := &api.Configuration{
			Projects: []*api.ConfigurationProject{},
		}
		if err := api.SaveConfiguration(configPath, emptyConfig); err != nil {
			slog.Error("Failed to create empty config", "error", err)
		}
	}
	
	// Create API service without embedded binaries
	apiService := api.NewApiService(getConfigurationResponse)
	apiService.SetWorkspace(kajaDir)
	twirpHandler := api.NewApiServer(apiService)
	
	// Create application with options
	app := NewApp(twirpHandler, apiService, configPath)

	err = wails.Run(&options.App{
		Title:  "Kaja Compiler",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
		},
		LogLevel: logger.ERROR,
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
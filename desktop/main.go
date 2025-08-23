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

	esbuild "github.com/evanw/esbuild/pkg/api"
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
	binaryManager *BinaryManager
}

// NewApp creates a new App application struct
func NewApp(twirpHandler api.TwirpServer, binaryManager *BinaryManager) *App {
	return &App{
		twirpHandler:  twirpHandler,
		binaryManager: binaryManager,
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

// LoadStub loads stub JavaScript content for a given project using the same approach as handleStubJs
func (a *App) LoadStub(projectName string) (string, error) {
	slog.Info("Loading stub for project", "project", projectName)
	
	// Read all files in the sources directory, similar to handleStubJs
	sourcesDir := filepath.Join("build", "sources", projectName)
	var stubContent strings.Builder
	
	err := filepath.Walk(sourcesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			// Create export statement similar to handleStubJs
			relativePath := strings.Replace(path, "build/sources/"+projectName, "./", 1)
			stubContent.WriteString(fmt.Sprintf("export * from \"%s\";\n", relativePath))
		}
		return nil
	})
	
	if err != nil {
		slog.Warn("Failed to walk sources directory", "path", sourcesDir, "error", err)
		return "", fmt.Errorf("failed to read sources directory: %w", err)
	}

	//slog.Info("Generated stub content", "project", projectName, "content", stubContent.String())

	// Use esbuild to bundle the stub, similar to handleStubJs
	result := esbuild.Build(esbuild.BuildOptions{
		Stdin: &esbuild.StdinOptions{
			Contents:   stubContent.String(),
			ResolveDir: sourcesDir,
			Sourcefile: "stub.ts",
		},
		Bundle:   true,
		Format:   esbuild.FormatESModule,
		Packages: esbuild.PackagesExternal,
	})

	if len(result.Errors) > 0 {
		errorMsg := result.Errors[0].Text
		slog.Error("esbuild failed", "project", projectName, "error", errorMsg)
		return "", fmt.Errorf("build failed: %s", errorMsg)
	}

	if len(result.OutputFiles) == 0 {
		slog.Error("No output files generated", "project", projectName)
		return "", fmt.Errorf("no output files generated")
	}

	output := string(result.OutputFiles[0].Contents)
	slog.Info("Stub loaded successfully", "project", projectName, "output_length", len(output))
	return output, nil
}

// LoadSourceFile loads the content of a specific source file
func (a *App) LoadSourceFile(path string) (string, error) {
	slog.Info("Loading source file", "path", path)
	
	// Construct the full path to the source file
	sourcePath := filepath.Join("build", "sources", path)
	
	// Check if the file exists and is within the sources directory (security check)
	cleanPath := filepath.Clean(sourcePath)
	expectedPrefix := filepath.Clean("build/sources/")
	if !strings.HasPrefix(cleanPath, expectedPrefix) {
		slog.Warn("Attempted to access file outside sources directory", "path", path, "cleanPath", cleanPath)
		return "", fmt.Errorf("invalid path: %s", path)
	}
	
	// Read the file content
	content, err := os.ReadFile(cleanPath)
	if err != nil {
		slog.Warn("Failed to read source file", "path", cleanPath, "error", err)
		return "", fmt.Errorf("failed to read file %s: %w", path, err)
	}
	
	slog.Info("Source file loaded successfully", "path", path, "content_length", len(content))
	return string(content), nil
}

// GetProtocPath returns the path to the embedded protoc binary
func (a *App) GetProtocPath() string {
	if a.binaryManager != nil {
		return a.binaryManager.GetProtocPath()
	}
	return "protoc" // fallback to system protoc
}

// GetProtocIncludePath returns the path to the embedded protoc include files
func (a *App) GetProtocIncludePath() string {
	if a.binaryManager != nil {
		return a.binaryManager.GetIncludePath()
	}
	return "" // fallback to system includes
}

// GetNodePath returns the path to the embedded Node.js binary
func (a *App) GetNodePath() string {
	if a.binaryManager != nil {
		return a.binaryManager.GetNodePath()
	}
	return "node" // fallback to system node
}

func main() {
	getConfigurationResponse := api.LoadGetConfigurationResponse("./workspace/kaja.json")
	
	// Initialize binary manager for embedded protoc
	binaryManager, err := NewBinaryManager()
	var twirpHandler api.TwirpServer
	if err != nil {
		slog.Error("Failed to initialize binary manager", "error", err)
		// Continue without embedded protoc - system protoc will be used as fallback
		binaryManager = nil
		twirpHandler = api.NewApiServer(api.NewApiService(getConfigurationResponse))
	} else {
		slog.Info("Protoc binary extracted", "path", binaryManager.GetProtocPath())
		slog.Info("Node binary extracted", "path", binaryManager.GetNodePath())
		
		// Update PATH to include both protoc and node directories
		protocDir := filepath.Dir(binaryManager.GetProtocPath())
		nodeDir := filepath.Dir(binaryManager.GetNodePath())
		currentPath := os.Getenv("PATH")
		
		// Add both directories to PATH (node first so it takes precedence)
		newPath := nodeDir + string(os.PathListSeparator) + protocDir + string(os.PathListSeparator) + currentPath
		os.Setenv("PATH", newPath)
		slog.Info("Updated PATH for embedded binaries", "node_dir", nodeDir, "protoc_dir", protocDir)
		
		// Create API service with embedded binaries
		apiService := api.NewApiServiceWithAllPaths(getConfigurationResponse, binaryManager.GetProtocPath(), binaryManager.GetIncludePath(), binaryManager.GetNodePath())
		twirpHandler = api.NewApiServer(apiService)
	}
	
	// Create application with options
	app := NewApp(twirpHandler, binaryManager)

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
	
	// Cleanup binary manager when app exits
	if binaryManager != nil {
		if cleanupErr := binaryManager.Cleanup(); cleanupErr != nil {
			slog.Warn("Failed to cleanup binary manager", "error", cleanupErr)
		}
	}
}
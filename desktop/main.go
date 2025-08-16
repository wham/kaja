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
	twirpHandler api.TwirpServer
}

// NewApp creates a new App application struct
func NewApp(twirpHandler api.TwirpServer) *App {
	return &App{twirpHandler: twirpHandler}
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

func main() {
	getConfigurationResponse := api.LoadGetConfigurationResponse("../workspace/kaja.json")
	twirpHandler := api.NewApiServer(api.NewApiService(getConfigurationResponse))
	
	// Create application with options
	app := NewApp(twirpHandler)

	err := wails.Run(&options.App{
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

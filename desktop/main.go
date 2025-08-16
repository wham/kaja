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

	"github.com/evanw/esbuild/pkg/api"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	kajaapi "github.com/wham/kaja/v2/pkg/api"
)

//go:embed all:frontend/dist
var assets embed.FS

// App struct
type App struct {
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
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

	getConfigurationResponse := kajaapi.LoadGetConfigurationResponse("../workspace/kaja.json")
	twirpHandler := kajaapi.NewApiServer(kajaapi.NewApiService(getConfigurationResponse))

	url := "/twirp/Api/" + method
	httpReq, err := http.NewRequestWithContext(context.Background(), "POST", url, bytes.NewReader(req))
	if err != nil {
		slog.Error("Failed to create HTTP request", "error", err)
		return nil, err
	}

	slog.Info("Twirp request created successfully")

	httpReq.Header.Set("Content-Type", "application/protobuf")

	recorder := httptest.NewRecorder()
	twirpHandler.ServeHTTP(recorder, httpReq)

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

	slog.Info("Generated stub content", "project", projectName, "content", stubContent.String())

	// Use esbuild to bundle the stub, similar to handleStubJs
	result := api.Build(api.BuildOptions{
		Stdin: &api.StdinOptions{
			Contents:   stubContent.String(),
			ResolveDir: sourcesDir,
			Sourcefile: "stub.ts",
		},
		Bundle:   true,
		Format:   api.FormatESModule,
		Packages: api.PackagesExternal,
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

func main() {
	// Create application with options
	app := NewApp()

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
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

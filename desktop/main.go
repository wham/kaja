package main

import (
	"context"
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wham/kaja/v2/pkg/compiler"
)

//go:embed all:frontend/dist
var assets embed.FS

// CompileRequest represents the compile request parameters
type CompileRequest struct {
	LogOffset   int32  `json:"log_offset"`
	Force       bool   `json:"force"`
	ProjectName string `json:"project_name"`
	Workspace   string `json:"workspace"`
}

// CompileResponse represents the compile response
type CompileResponse struct {
	Status  compiler.Status `json:"status"`
	Logs    []compiler.Log  `json:"logs"`
	Sources []string        `json:"sources"`
}

// GetConfigurationRequest represents the configuration request
type GetConfigurationRequest struct{}

// GetConfigurationResponse represents the configuration response
type GetConfigurationResponse struct {
	Configuration *Configuration `json:"configuration"`
	Logs          []compiler.Log `json:"logs"`
}

// Configuration represents the application configuration
type Configuration struct {
	PathPrefix string                  `json:"path_prefix"`
	Projects   []*ConfigurationProject `json:"projects"`
	AI         *ConfigurationAI        `json:"ai"`
}

// ConfigurationProject represents a project configuration
type ConfigurationProject struct {
	Name      string `json:"name"`
	Protocol  int32  `json:"protocol"` // 0 = Twirp, 1 = gRPC
	URL       string `json:"url"`
	Workspace string `json:"workspace"`
}

// ConfigurationAI represents AI configuration
type ConfigurationAI struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
}

// App struct
type App struct {
	compiler *compiler.Compiler
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		compiler: compiler.NewCompiler(nil), // Using default logger
	}
}

// Compile starts the compilation process for a project and returns status, logs, and sources
func (a *App) Compile(projectName string, workspace string, force bool, logOffset int) (compiler.Status, []compiler.Log, []string, error) {
	return a.compiler.Compile(projectName, workspace, force, logOffset)
}

// CompileRPC handles compile requests in protobuf-compatible format
func (a *App) CompileRPC(ctx context.Context, req *CompileRequest) (*CompileResponse, error) {
	status, logs, sources, err := a.compiler.Compile(req.ProjectName, req.Workspace, req.Force, int(req.LogOffset))
	if err != nil {
		return nil, err
	}

	return &CompileResponse{
		Status:  status,
		Logs:    logs,
		Sources: sources,
	}, nil
}

// GetConfiguration returns the desktop app configuration
func (a *App) GetConfiguration(req *GetConfigurationRequest) (*GetConfigurationResponse, error) {
	// For desktop app, provide a default configuration
	// In a real implementation, this might read from a config file
	config := &Configuration{
		PathPrefix: "",
		Projects: []*ConfigurationProject{
			{
				Name:      "demo",
				Protocol:  0, // Twirp
				URL:       "http://localhost:41521",
				Workspace: "../workspace",
			},
		},
		AI: &ConfigurationAI{
			BaseURL: "",
			APIKey:  "",
		},
	}

	return &GetConfigurationResponse{
		Configuration: config,
		Logs:          []compiler.Log{},
	}, nil
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

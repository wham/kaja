package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wham/kaja/v2/pkg/compiler"
)

//go:embed all:frontend/dist
var assets embed.FS

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

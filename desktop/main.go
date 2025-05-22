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
		compiler: &compiler.Compiler{},
	}
}

// Compile exposes the compiler functionality to the frontend
func (a *App) Compile(sourceCode string) (string, error) {
	return compiler.Compile(sourceCode)
}

func main() {
	// Create application with options
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  compiler.Hello(),
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

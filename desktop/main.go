package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wham/kaja/v2/internal/compiler"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create application with options
	err := wails.Run(&options.App{
		Title:  compiler.Hello(),
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

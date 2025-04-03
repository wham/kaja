package main

import (
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	assets "github.com/wham/kaja/v2"
)

func main() {
	// Create application with options
	err := wails.Run(&options.App{
		Title:  "desktop",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets.StaticFS,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

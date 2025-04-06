package desktop

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

func Main(fs embed.FS) {
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "desktop",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: fs,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

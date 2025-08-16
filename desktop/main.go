package main

import (
	"bytes"
	"context"
	"embed"
	"log/slog"
	"net/http"
	"net/http/httptest"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"github.com/wham/kaja/v2/pkg/api"
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
	getConfigurationResponse := api.LoadGetConfigurationResponse("../workspace/kaja.json")
	twirpHandler := api.NewApiServer(api.NewApiService(getConfigurationResponse))

	url := "/twirp/Api/" + method
	httpReq, err := http.NewRequestWithContext(context.Background(), "POST", url, bytes.NewReader(req))
	if err != nil {
		slog.Error("Failed twirp", "error", err)
		return nil, err
	}

	slog.Info("Twirp OK")

	httpReq.Header.Set("Content-Type", "application/protobuf")

	recorder := httptest.NewRecorder()
	twirpHandler.ServeHTTP(recorder, httpReq)

	//slog.Info("Twirp body", "body", recorder.Body.String())

	return recorder.Body.Bytes(), nil
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

//go:build !development

package main

import (
	"embed"
	"net/http"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

// assetHandler serves the UI bundled into the binary.
func assetHandler() http.Handler {
	return application.AssetFileServerFS(assets)
}

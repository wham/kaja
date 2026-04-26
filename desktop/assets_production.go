//go:build !development

package main

import (
	"embed"

	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func assetServerOptions() *assetserver.Options {
	return &assetserver.Options{
		Assets: assets,
	}
}

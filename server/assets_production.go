//go:build !development

package assets

import (
	"embed"
)

//go:embed static/*
var StaticFS embed.FS

//go:embed templates/*
var TemplatesFS embed.FS

//go:embed web/assets/ui.js
var ui []byte

func ReadUI() []byte {
	return ui
}

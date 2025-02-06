//go:build !development

package assets

import (
	"embed"
)

//go:embed static/*
var StaticFS embed.FS

//go:embed templates/*
var TemplatesFS embed.FS

//go:embed build/main.js
var mainJs []byte

//go:embed build/main.css
var mainCss []byte

//go:embed build/codicon-37A3DWZT.ttf
var codiconTtf []byte

func ReadUiBundle() *UiBundle {
	return &UiBundle{
		MainJs: ui,
		MainCss: mainCss,
		CodiconTtf: codiconTtf,
}

//go:build !development

package assets

import (
	"embed"

	"github.com/wham/kaja/v2/internal/ui"
)

//go:embed static/*
var StaticFS embed.FS

//go:embed build/main.js
var mainJs []byte

//go:embed build/main.css
var mainCss []byte

//go:embed build/codicon-LN6W7LCM.ttf
var codiconTtf []byte

func ReadUiBundle() *ui.UiBundle {
	return &ui.UiBundle{
		MainJs:     mainJs,
		MainCss:    mainCss,
		CodiconTtf: codiconTtf,
	}
}

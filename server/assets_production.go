//go:build !development

package assets

import (
	"embed"
	"fmt"

	"github.com/wham/kaja/v2/internal/ui"
)

//go:embed static/*
var StaticFS embed.FS

//go:embed build/main.js
var mainJs []byte

//go:embed build/main.css
var mainCss []byte

//go:embed build/codicon-37A3DWZT.ttf
var codiconTtf []byte

//go:embed build/monaco.json.worker.js
var monacoJsonWorkerJs []byte

//go:embed build/monaco.css.worker.js
var monacoCssWorkerJs []byte

//go:embed build/monaco.html.worker.js
var monacoHtmlWorkerJs []byte

//go:embed build/monaco.ts.worker.js
var monacoTsWorkerJs []byte

//go:embed build/monaco.editor.worker.js
var monacoEditorWorkerJs []byte

func ReadUiBundle() *ui.UiBundle {
	return &ui.UiBundle{
		MainJs:     mainJs,
		MainCss:    mainCss,
		CodiconTtf: codiconTtf,
	}
}

func ReadMonacoWorker(name string) ([]byte, error) {
	switch name {
	case "json":
		return monacoJsonWorkerJs, nil
	case "css":
		return monacoCssWorkerJs, nil
	case "html":
		return monacoHtmlWorkerJs, nil
	case "ts":
		return monacoTsWorkerJs, nil
	case "editor":
		return monacoEditorWorkerJs, nil
	}
	return nil, fmt.Errorf("unknown monaco worker: %s", name)
}

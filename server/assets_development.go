//go:build development

package assets

import (
	"io/fs"
	"os"

	"github.com/wham/kaja/v2/internal/ui"
)

var StaticFS fs.FS
var TemplatesFS fs.FS

func init() {
	StaticFS = os.DirFS(".")
	TemplatesFS = os.DirFS(".")
}

func ReadUiBundle() *ui.UiBundle {
	return ui.BuildForDevelopment()
}

func ReadMonacoWorker(name string) ([]byte, error) {
	return ui.BuildMonacoWorker(name)
}

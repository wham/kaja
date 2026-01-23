//go:build development

package assets

import (
	"io/fs"
	"os"

	"github.com/wham/kaja/v2/internal/ui"
)

var StaticFS fs.FS

func init() {
	StaticFS = os.DirFS(".")
}

func ReadUiBundle() *ui.UiBundle {
	return ui.BuildForDevelopment()
}

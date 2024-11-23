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

func ReadUI() []byte {
	return ui.BuildForDevelopment()
}

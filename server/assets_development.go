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

	// Bundling the UI is the longest thing between starting the server and
	// looking at it, and nothing else in a run's first seconds needs the
	// result - so it starts here rather than when the first request asks for
	// it, and runs while the browser is being reached for.
	go ui.BuildForDevelopment()
}

func ReadUiBundle() *ui.UiBundle {
	return ui.BuildForDevelopment()
}

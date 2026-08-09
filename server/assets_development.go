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
	// it, and runs while the browser is being reached for. It builds what the
	// page asks for, in the order the page asks for it.
	go func() {
		ui.BuildForDevelopment()
		for _, worker := range ui.MonacoWorkerNames {
			ui.BuildMonacoWorker(worker)
		}
	}()
}

func ReadUiBundle() *ui.UiBundle {
	return ui.BuildForDevelopment()
}

func ReadMonacoWorker(name string) ([]byte, error) {
	return ui.BuildMonacoWorker(name)
}

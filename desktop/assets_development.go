//go:build development

package main

import (
	"log/slog"
	"net/http"
	"os"
)

// assetHandler serves the UI from disk, so the esbuild watcher's output is a
// window reload rather than a rebuild of the binary it is embedded in.
// scripts/desktop exports the directory, because a development bundle runs from
// build/bin and has no path back to the tree it was built in.
func assetHandler() http.Handler {
	dir := os.Getenv("KAJA_FRONTEND_DIR")
	if dir == "" {
		slog.Error("KAJA_FRONTEND_DIR is not set; a development build serves the UI from disk")
	}
	return http.FileServer(http.Dir(dir))
}

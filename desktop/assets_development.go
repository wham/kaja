//go:build development

package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	serverAssets "github.com/wham/kaja/v2"
)

// assetServerOptions returns a Wails AssetServer that re-runs esbuild on every
// request, so cmd+R reloads the freshly bundled UI - matching the behavior of
// scripts/server in the browser.
func assetServerOptions() *assetserver.Options {
	// Static files (favicon, index.html) live in server/static. The desktop
	// binary's CWD is desktop/ when launched via wails dev, so reach across.
	staticFS := os.DirFS("../server")

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			http.NotFound(w, r)
			return
		}
		http.ServeFileFS(w, r, staticFS, "static/index.html")
	})

	mux.HandleFunc("GET /main.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		w.Write(serverAssets.ReadUiBundle().MainJs)
	})

	mux.HandleFunc("GET /main.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css")
		w.Write(serverAssets.ReadUiBundle().MainCss)
	})

	mux.HandleFunc("GET /codicon-LN6W7LCM.ttf", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "font/ttf")
		w.Write(serverAssets.ReadUiBundle().CodiconTtf)
	})

	for _, name := range serverAssets.MonacoWorkerNames {
		worker := name
		mux.HandleFunc("GET /monaco."+worker+".worker.js", func(w http.ResponseWriter, r *http.Request) {
			data, err := serverAssets.ReadMonacoWorker(worker)
			if err != nil {
				slog.Error("Failed to read monaco worker", "error", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/javascript")
			w.Write(data)
		})
	}

	mux.HandleFunc("GET /static/{name...}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if name == "index.html" {
			http.NotFound(w, r)
			return
		}
		http.ServeFileFS(w, r, staticFS, "static/"+name)
	})

	return &assetserver.Options{
		Handler: mux,
	}
}

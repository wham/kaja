package main

import (
	"flag"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"os"

	assets "github.com/wham/kaja/v2"
	"github.com/wham/kaja/v2/internal/ui"
	"github.com/wham/kaja/v2/pkg/agent"
	"github.com/wham/kaja/v2/pkg/api"
)

// GitRef is the git commit hash or tag, set at build time via ldflags
var GitRef string

func handleStatus(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func main() {
	// The server serves a workspace it does not own — a Git checkout, a mounted volume —
	// so its configuration is read-only. --editable opts out of that for development.
	editable := flag.Bool("editable", false, "allow the UI to write to the configuration file")
	flag.Parse()

	configurationPath := "../workspace/kaja.json"
	getConfigurationResponse := api.LoadGetConfigurationResponse(configurationPath)
	configuration := getConfigurationResponse.Configuration

	configurationWatcher, err := api.NewConfigurationWatcher(configurationPath)
	if err != nil {
		slog.Warn("Failed to start configuration watcher", "error", err)
	} else {
		defer configurationWatcher.Close()
	}

	mime.AddExtensionType(".ts", "text/plain")
	mux := http.NewServeMux()

	// No variable store on the web server: a "${secret}" variable's value comes from the
	// environment.
	apiService := api.NewApiService(configurationPath, *editable, GitRef, "", nil)
	twirpHandler := api.NewApiServer(apiService)
	mux.Handle(twirpHandler.PathPrefix(), twirpHandler)

	// The agent session. A script runs in a browser, so a deployed kaja can only answer
	// an agent by forwarding the run to a window that has offered itself. The window makes
	// up the token and holds the stream; this server holds nothing at rest.
	agentSessions := agent.NewRegistry(agent.NewWorkspaceScripts(apiService))
	mux.HandleFunc("GET /agent-session", agentSessions.ServeInfo)
	mux.HandleFunc("POST /agent-session/attach", agentSessions.ServeAttach)
	mux.HandleFunc("POST /agent-session/detach", agentSessions.ServeDetach)
	mux.HandleFunc("POST /agent-session/focus", agentSessions.ServeFocus)
	mux.HandleFunc("POST /agent-session/catalog", agentSessions.ServeCatalog)
	mux.HandleFunc("POST /agent-session/result", agentSessions.ServeResult)
	mux.HandleFunc("POST /mcp", agentSessions.ServeMCP)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}

		http.ServeFileFS(w, r, assets.StaticFS, "static/index.html")
	})

	mux.HandleFunc("GET /static/{name...}", func(w http.ResponseWriter, r *http.Request) {
		// index.html must be served via /.
		if r.PathValue("name") == "index.html" {
			http.NotFound(w, r)
			return
		}

		http.ServeFileFS(w, r, assets.StaticFS, "static/"+r.PathValue("name"))
	})

	mux.HandleFunc("GET /main.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		w.Write(assets.ReadUiBundle().MainJs)
	})

	mux.HandleFunc("GET /main.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css")
		w.Write(assets.ReadUiBundle().MainCss)
	})

	mux.HandleFunc("GET /codicon-KP4OV2OO.ttf", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "font/ttf")
		w.Write(assets.ReadUiBundle().CodiconTtf)
	})

	for _, worker := range ui.MonacoWorkerNames {
		mux.HandleFunc("GET /monaco."+worker+".worker.js", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/javascript")
			data, err := assets.ReadMonacoWorker(worker)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				slog.Error("Failed to read monaco worker", "error", err)
			} else {
				w.Write(data)
			}
		})
	}

	mux.HandleFunc("GET /status", handleStatus)

	// SSE endpoint for configuration change notifications.
	mux.HandleFunc("GET /configuration-changes", func(w http.ResponseWriter, r *http.Request) {
		if configurationWatcher == nil {
			http.Error(w, "Configuration watcher not available", http.StatusServiceUnavailable)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "Streaming not supported", http.StatusInternalServerError)
			return
		}

		fmt.Fprintf(w, "event: connected\ndata: {}\n\n")
		flusher.Flush()

		notify := make(chan struct{}, 1)
		unsubscribe := configurationWatcher.Subscribe(func() {
			select {
			case notify <- struct{}{}:
			default:
				// Already have a pending notification.
			}
		})
		defer unsubscribe()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-notify:
				fmt.Fprintf(w, "event: changed\ndata: {}\n\n")
				flusher.Flush()
			}
		}
	})

	// Handle /target path. The same handler an exported app serves, so a call
	// goes out the same way whichever of the two it was made in.
	mux.HandleFunc("/target/{method...}", api.TargetHandler(apiService, func(r *http.Request) string {
		return r.PathValue("method")
	}))

	root := http.NewServeMux()
	root.Handle(configuration.PathPrefix+"/", logRequest(http.StripPrefix(configuration.PathPrefix, mux)))

	// Used in kaja launch scripts to determine if the server has started. slog.Info is
	// not visible with Docker's -a STDOUT flag — its output is buffered. Ideally rewrite
	// the launch scripts to use the /status endpoint.
	fmt.Println("Server started")
	slog.Info("Server started", "URL", "http://localhost:41520")
	slog.Error("Failed to start server", "error", http.ListenAndServe(":41520", root))
	os.Exit(1)
}

func logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		slog.Info("Request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status)
	})
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Flush() {
	if flusher, ok := rw.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

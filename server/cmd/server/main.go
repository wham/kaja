package main

import (
	"flag"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	assets "github.com/wham/kaja/v2"
	"github.com/wham/kaja/v2/internal/grpc"
	"github.com/wham/kaja/v2/internal/ui"
	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/apps"
)

// GitRef is the git commit hash or tag, set at build time via ldflags
var GitRef string

func handleStatus(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func main() {
	// The server serves a workspace it does not own - a Git checkout, a mounted
	// volume - so its configuration is read-only. --editable opts out of that for
	// development, where the workspace is the developer's own.
	editable := flag.Bool("editable", false, "allow the UI to write to the configuration file")
	flag.Parse()

	configurationPath := "../workspace/kaja.json"
	getConfigurationResponse := api.LoadGetConfigurationResponse(configurationPath)
	configuration := getConfigurationResponse.Configuration

	// Start configuration file watcher
	configurationWatcher, err := api.NewConfigurationWatcher(configurationPath)
	if err != nil {
		slog.Warn("Failed to start configuration watcher", "error", err)
	} else {
		defer configurationWatcher.Close()
	}

	mime.AddExtensionType(".ts", "text/plain")
	mux := http.NewServeMux()

	// No variable store on the web server: a "${secret}" variable's value comes
	// from the environment.
	apiService := api.NewApiService(configurationPath, *editable, GitRef, "", nil)
	twirpHandler := api.NewApiServer(apiService)
	mux.Handle(twirpHandler.PathPrefix(), twirpHandler)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}

		http.ServeFileFS(w, r, assets.StaticFS, "static/index.html")
	})

	mux.HandleFunc("GET /static/{name...}", func(w http.ResponseWriter, r *http.Request) {
		// index.html must be served via /
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

	// SSE endpoint for configuration change notifications
	mux.HandleFunc("GET /configuration-changes", func(w http.ResponseWriter, r *http.Request) {
		if configurationWatcher == nil {
			http.Error(w, "Configuration watcher not available", http.StatusServiceUnavailable)
			return
		}

		// Set SSE headers
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "Streaming not supported", http.StatusInternalServerError)
			return
		}

		// Send initial connection event
		fmt.Fprintf(w, "event: connected\ndata: {}\n\n")
		flusher.Flush()

		// Channel to receive change notifications
		notify := make(chan struct{}, 1)
		unsubscribe := configurationWatcher.Subscribe(func() {
			select {
			case notify <- struct{}{}:
			default:
				// Already have a pending notification
			}
		})
		defer unsubscribe()

		// Keep connection alive and send events
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

	// Handle /target path
	mux.HandleFunc("/target/{method...}", func(w http.ResponseWriter, r *http.Request) {
		// Check if this is a gRPC-Web request
		contentType := r.Header.Get("Content-Type")
		targetHeader := r.Header.Get("X-Target")

		// Extract headers with X-Header- prefix to forward to target. Their values
		// still carry ${NAME} variable references: the browser sends them
		// unexpanded because a variable's value may be one this server holds and
		// the browser is not allowed to know.
		forwardHeaders := make(map[string]string)
		for name, values := range r.Header {
			if strings.HasPrefix(name, "X-Header-") && len(values) > 0 {
				headerName := strings.TrimPrefix(name, "X-Header-")
				forwardHeaders[headerName] = values[0]
			}
		}

		// App targets (kaja-app://<id>) are invoked in-process by the app manager
		// instead of being proxied to an external host. Apps are gRPC apps, so the
		// request arrives as gRPC-Web like a regular gRPC app. InvokeApp expands
		// the headers and redacts what it reports back.
		if apps.IsAppTarget(targetHeader) {
			grpc.ServeAppGRPCWeb(w, r, r.PathValue("method"), func(method string, message []byte, headers map[string]string) (*apps.InvokeResult, error) {
				return apiService.InvokeApp(targetHeader, method, message, headers)
			}, forwardHeaders)
			return
		}

		forwardHeaders = apiService.Variables().ExpandAll(forwardHeaders)

		target, err := url.Parse(targetHeader)
		if err != nil {
			slog.Warn("Failed to parse X-Target header", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte("Invalid X-Target header"))
			return
		}

		if strings.HasPrefix(contentType, "application/grpc-web") ||
			strings.HasPrefix(contentType, "application/grpc-web-text") {

			proxy, err := grpc.NewProxy(target)
			if err != nil {
				slog.Error("Failed to create gRPC proxy", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			proxy.ServeHTTP(w, r, r.PathValue("method"), forwardHeaders)
			return
		} else {
			// Create a reverse proxy for Twirp requests
			proxy := httputil.NewSingleHostReverseProxy(target)
			proxy.Director = func(req *http.Request) {
				req.Host = target.Host
				req.URL.Scheme = target.Scheme
				req.URL.Host = target.Host
				// Replace /target/ with /twirp/ and append to target path
				path := strings.Replace(req.URL.Path, "/target/", "/twirp/", 1)
				req.URL.Path = target.Path + path
				// Forward configured headers to target
				for name, value := range forwardHeaders {
					req.Header.Set(name, value)
				}
			}
			proxy.ServeHTTP(w, r)
		}
	})

	root := http.NewServeMux()
	root.Handle(configuration.PathPrefix+"/", logRequest(http.StripPrefix(configuration.PathPrefix, mux)))

	// Used in kaja launch scripts to determine if the server has started.
	// slog.Info is not visible with Docker's -a STDOUT flag - its output is buffered.
	// Ideally rewrite the launch scripts to use the /status endpoint.
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

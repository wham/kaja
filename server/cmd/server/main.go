package main

import (
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
	"github.com/wham/kaja/v2/pkg/api"
)

func handleStatus(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func handleAIProxy(config *api.Configuration) func(w http.ResponseWriter, r *http.Request) {
	aiConfig := config.Ai

	if aiConfig.BaseUrl == "" || aiConfig.ApiKey == "" {
		return func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "AI is not configured", http.StatusBadRequest)
		}
	}

	target, err := url.Parse(aiConfig.BaseUrl)
	if err != nil {
		return func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, fmt.Sprintf("Invalid ai.baseUrl: %s", err.Error()), http.StatusBadGateway)
		}
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Director = func(req *http.Request) {
		req.Header.Set("Authorization", "Bearer "+aiConfig.ApiKey)
		req.Host = target.Host
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		// Strip /ai prefix from the path
		// The configured baseUrl can contain a path too, concatenate all together
		req.URL.Path = target.Path + "/" + strings.TrimPrefix(req.URL.Path, "/ai/")
	}

	return func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHTTP(w, r)
	}
}

func main() {
	configurationPath := "../workspace/kaja.json"
	getConfigurationResponse := api.LoadGetConfigurationResponse(configurationPath, false)
	configuration := getConfigurationResponse.Configuration

	mime.AddExtensionType(".ts", "text/plain")
	mux := http.NewServeMux()

	twirpHandler := api.NewApiServer(api.NewApiService(configurationPath, false))
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

	mux.HandleFunc("GET /codicon-LN6W7LCM.ttf", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "font/ttf")
		w.Write(assets.ReadUiBundle().CodiconTtf)
	})

	mux.HandleFunc("GET /status", handleStatus)

	// Handle /target path
	mux.HandleFunc("/target/{method...}", func(w http.ResponseWriter, r *http.Request) {
		// Check if this is a gRPC-Web request
		contentType := r.Header.Get("Content-Type")
		target, err := url.Parse(r.Header.Get("X-Target"))
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
			proxy.ServeHTTP(w, r, r.PathValue("method"))
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
			}
			proxy.ServeHTTP(w, r)
		}
	})

	mux.HandleFunc("/ai/{path...}", handleAIProxy(configuration))

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
		slog.Info("Request",
			"method", r.Method,
			"path", r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

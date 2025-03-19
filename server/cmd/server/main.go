package main

import (
	"bytes"
	"fmt"
	"html/template"
	"log/slog"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/evanw/esbuild/pkg/api"
	assets "github.com/wham/kaja/v2"
	pb "github.com/wham/kaja/v2/internal/api"
	"github.com/wham/kaja/v2/internal/grpc"
	"github.com/wham/kaja/v2/internal/ui"
)

const (
	openAIEndpoint = "https://models.inference.ai.azure.com"
)

func handlerStubJs(w http.ResponseWriter, r *http.Request) {
	project := r.PathValue("project")
	cwd, err := os.Getwd()
	if err != nil {
		http.Error(w, "Failed to get current working directory", http.StatusInternalServerError)
		return
	}
	fmt.Printf("CWD: %s\n", cwd)

	// Read all files in the sources directory
	sourcesDir := "./build/sources/" + project
	var stubContent strings.Builder
	err = filepath.Walk(sourcesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			stubContent.WriteString("export * from \"" + strings.Replace(path, "build/sources/"+project, "./", 1) + "\";\n")
		}
		return nil
	})
	if err != nil {
		http.Error(w, "Failed to read sources directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	fmt.Printf("Stub content: %s\n", stubContent.String())

	result := api.Build(api.BuildOptions{
		Stdin: &api.StdinOptions{
			Contents:   stubContent.String(),
			ResolveDir: sourcesDir,
			Sourcefile: "stub.ts",
		},
		Bundle:   true,
		Format:   api.FormatESModule,
		Packages: api.PackagesExternal,
	})

	if len(result.Errors) > 0 {
		fmt.Printf("Build failed: %s\n", result.Errors[0].Text)
		http.Error(w, "Build failed\n"+result.Errors[0].Text, http.StatusInternalServerError)
		return
	}

	first := result.OutputFiles[0]

	w.Header().Set("Content-Type", "application/javascript")
	http.ServeContent(w, r, first.Path, time.Now(), bytes.NewReader(first.Contents))
}

func handlerStatus(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func handleOpenAIProxy(w http.ResponseWriter, r *http.Request) {
	// Get the GitHub token from environment
	githubToken := os.Getenv("GITHUB_TOKEN")
	if githubToken == "" {
		http.Error(w, "GitHub token not configured", http.StatusInternalServerError)
		return
	}

	target, err := url.Parse(openAIEndpoint)
	if err != nil {
		http.Error(w, "Invalid target URL", http.StatusInternalServerError)
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Director = func(req *http.Request) {
		req.Header.Set("Authorization", "Bearer "+githubToken)
		req.Host = target.Host
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		// Strip /openai prefix from the path
		req.URL.Path = strings.TrimPrefix(req.URL.Path, "/openai")
	}

	proxy.ServeHTTP(w, r)
}

func main() {
	// kaja can be deployed at a subpath - i.e. kaja.tools/demo
	// The PATH_PREFIX environment variable is used to set the subpath.
	// The server uses it to generate the correct paths in HTML and redirects.
	// The JS code is using relative paths and should be not dependent on this.
	pathPrefix := strings.Trim(os.Getenv("PATH_PREFIX"), "/")
	if pathPrefix != "" {
		pathPrefix = "/" + pathPrefix
	}
	slog.Info("Configuration", "PATH_PREFIX", pathPrefix)

	mime.AddExtensionType(".ts", "text/plain")
	mux := http.NewServeMux()

	twirpHandler := pb.NewApiServer(pb.NewApiService("../workspace/kaja.json"))
	mux.Handle(twirpHandler.PathPrefix(), twirpHandler)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}

		template, err := template.ParseFS(assets.TemplatesFS, "templates/**.html")
		if err != nil {
			slog.Error("Failed to parse HTML templates", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("Internal server error"))
			return
		}

		if err := template.ExecuteTemplate(w, "index.html", struct{ PathPrefix string }{PathPrefix: pathPrefix}); err != nil {
			slog.Error("Failed to execute template", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("Internal server error"))
			return
		}
	})

	mux.HandleFunc("GET /static/{name...}", func(w http.ResponseWriter, r *http.Request) {
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

	mux.HandleFunc("GET /codicon-37A3DWZT.ttf", func(w http.ResponseWriter, r *http.Request) {
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

	mux.Handle("GET /sources/", http.StripPrefix("/sources/", http.FileServer(http.Dir("build/sources"))))
	mux.HandleFunc("GET /stub/{project}/stub.js", handlerStubJs)
	mux.HandleFunc("GET /status", handlerStatus)

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
			// Create a reverse proxy
			proxy := httputil.NewSingleHostReverseProxy(target)

			// Handle regular Twirp requests
			r.URL.Path = strings.Replace(r.URL.Path, "/target/", "/twirp/", 1)
			proxy.ServeHTTP(w, r)
		}
	})

	// Register the OpenAI proxy handler
	mux.HandleFunc("/openai/{path...}", handleOpenAIProxy)

	root := http.NewServeMux()
	root.Handle(pathPrefix+"/", logRequest(http.StripPrefix(pathPrefix, mux)))

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

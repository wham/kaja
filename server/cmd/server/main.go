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
	"github.com/joho/godotenv"
	assets "github.com/wham/kaja/v2"
	pb "github.com/wham/kaja/v2/internal/api"
)

func handlerStubJs(w http.ResponseWriter, r *http.Request) {
	cwd, err := os.Getwd()
	if err != nil {
		http.Error(w, "Failed to get current working directory", http.StatusInternalServerError)
		return
	}
	fmt.Printf("CWD: %s\n", cwd)

	// Read all files in the sources directory
	sourcesDir := "./web/sources"
	var stubContent strings.Builder
	err = filepath.Walk(sourcesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			stubContent.WriteString("export * from \"" + strings.Replace(path, "web/sources/", "./", 1) + "\";\n")
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

func main() {
	err := godotenv.Load("../.env")
	if err != nil {
		slog.Info(".env file not loaded", "error", err)
	}

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

	twirpHandler := pb.NewApiServer(pb.NewApiService())
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

	mux.HandleFunc("GET /ui.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		w.Write(assets.ReadUI())
	})

	mux.Handle("GET /sources/", http.StripPrefix("/sources/", http.FileServer(http.Dir("web/sources"))))
	mux.HandleFunc("GET /stub.js", handlerStubJs)
	mux.HandleFunc("GET /status", handlerStatus)

	baseURL := os.Getenv("BASE_URL")
	if baseURL == "" {
		slog.Error("BASE_URL environment variable is not set")
		os.Exit(1)
	}

	target, err := url.Parse(baseURL)
	if err != nil {
		slog.Error("Invalid BASE_URL", "error", err)
		os.Exit(1)
	}

	// Create a reverse proxy
	proxy := httputil.NewSingleHostReverseProxy(target)

	// Handle /twirp path
	mux.HandleFunc("/twirp/", func(w http.ResponseWriter, r *http.Request) {
		//r.URL.Path = r.URL.Path[len(pathPrefix):]
		proxy.ServeHTTP(w, r)
	})

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

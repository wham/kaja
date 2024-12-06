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

	mime.AddExtensionType(".ts", "text/plain")
	mux := http.NewServeMux()

	twirpHandler := pb.NewApiServer(pb.NewApiService())
	mux.Handle(twirpHandler.PathPrefix(), twirpHandler)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		slog.Info("HTML request", "method", r.Method, "path", r.RequestURI)

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

		if err := template.ExecuteTemplate(w, "index.html", struct{}{}); err != nil {
			slog.Error("Failed to execute template", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("Internal server error"))
			return
		}
	})

	mux.HandleFunc("GET /static/{name...}", func(w http.ResponseWriter, r *http.Request) {
		slog.Info("Static file request", "method", r.Method, "path", r.RequestURI)
		http.ServeFileFS(w, r, assets.StaticFS, "static/"+r.PathValue("name"))
	})

	mux.HandleFunc("GET /ui.js", func(w http.ResponseWriter, r *http.Request) {
		slog.Info("UI bundle request", "method", r.Method, "path", r.RequestURI)

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
	// kaja can be deployed at a subpath - i.e. kaja.tools/demo
	// The JS code is using relative paths and should be able to handle this without any changes.
	// To test this, we can apply a prefix here and uncomment when done.
	// root.Handle("/demo/", http.StripPrefix("/demo", mux))
	root.Handle("/", http.StripPrefix("", mux))

	fmt.Println("Server started at http://localhost:41520")
	slog.Info("Server started", "URL", "http://localhost:41520")
	slog.Error("Failed to start server", "error", http.ListenAndServe(":41520", root))
	os.Exit(1)
}

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
	assets "github.com/wham/kaja-twirp/v2"
	pb "github.com/wham/kaja-twirp/v2/internal/api"
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

	twirpHandler := pb.NewApiServer(pb.NewApiService())
	http.Handle(twirpHandler.PathPrefix(), twirpHandler)

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		slog.Info("HTML request", "method", r.Method, "path", r.RequestURI)

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

	http.HandleFunc("GET /static/{name...}", func(w http.ResponseWriter, r *http.Request) {
		slog.Info("Static file request", "method", r.Method, "path", r.RequestURI)
		http.ServeFileFS(w, r, assets.StaticFS, "static/"+r.PathValue("name"))
	})

	http.HandleFunc("GET /ui.js", func(w http.ResponseWriter, r *http.Request) {
		slog.Info("UI bundle request", "method", r.Method, "path", r.RequestURI)

		w.Header().Set("Content-Type", "application/javascript")
		w.Write(assets.ReadUI())
	})

	http.Handle("GET /sources/", http.StripPrefix("/sources/", http.FileServer(http.Dir("web/sources"))))
	http.HandleFunc("GET /stub.js", handlerStubJs)
	http.HandleFunc("GET /status", handlerStatus)

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
	http.HandleFunc("/twirp/", func(w http.ResponseWriter, r *http.Request) {
		//r.URL.Path = r.URL.Path[len("/twirp"):]
		proxy.ServeHTTP(w, r)
	})

	fmt.Println("Server started at http://localhost:41520")
	slog.Info("Server started", "URL", "http://localhost:41520")
	slog.Error("Failed to start server", "error", http.ListenAndServe(":41520", nil))
	os.Exit(1)
}

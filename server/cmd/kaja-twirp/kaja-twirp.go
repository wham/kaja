package main

import (
	"bytes"
	"fmt"
	"html/template"
	"log"
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
	pb "github.com/wham/kaja-twirp/internal/api"
	"github.com/wham/kaja-twirp/web"
)

func handler(w http.ResponseWriter, r *http.Request) {
    t, err := template.New("index.html").Parse(web.IndexHtml)

    if err != nil {
        log.Fatal(err)
    }
    t.Execute(w, nil)
}

func handlerFaviconSvg(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "image/svg+xml")
    w.Write(web.FaviconSvg)
}

func handlerStaticJs(w http.ResponseWriter, r *http.Request) {
    cwd, err := os.Getwd()
    if err != nil {
        http.Error(w, "Failed to get current working directory", http.StatusInternalServerError)
        return
    }
    fmt.Printf("CWD: %s\n", cwd)

    _, err = os.Stat("../client/src/main.tsx")
    if os.IsNotExist(err) {
        w.Header().Set("Content-Type", "application/javascript")
        http.ServeContent(w, r, "kaja-twirp.js", time.Now(), bytes.NewReader(web.KajaTwirpJs))
        return
    }
    
    result := api.Build(api.BuildOptions{
        EntryPoints: []string{"../client/src/main.tsx"},
        Bundle:      true,
        Format:    api.FormatESModule,
        Sourcemap: api.SourceMapInline,
    })
    
    if len(result.Errors) > 0 {
        http.Error(w, "Build failed\n" + result.Errors[0].Text, http.StatusInternalServerError)
        return
    }

    first := result.OutputFiles[0]

    w.Header().Set("Content-Type", "application/javascript")
    http.ServeContent(w, r, first.Path, time.Now(), bytes.NewReader(first.Contents))
}

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
        Bundle:      true,
        Format:     api.FormatESModule,
        Packages: api.PackagesExternal,
    })
    
    if len(result.Errors) > 0 {
        fmt.Printf("Build failed: %s\n", result.Errors[0].Text)
        http.Error(w, "Build failed\n" + result.Errors[0].Text, http.StatusInternalServerError)
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
    slog.Info("Starting kaja-twirp server")
    
    err := godotenv.Load("../.env")
    if err != nil {
        slog.Info(".env file not loaded", "error", err)
    }

    mime.AddExtensionType(".ts", "text/plain")

    twirpHandler := pb.NewApiServer(pb.NewApiService())
    http.Handle(twirpHandler.PathPrefix(), twirpHandler)

    http.HandleFunc("/", handler)
    http.HandleFunc("/favicon.svg", handlerFaviconSvg)
    http.Handle("/sources/", http.StripPrefix("/sources/", http.FileServer(http.Dir("web/sources"))))
    http.HandleFunc("/static/kaja-twirp.js", handlerStaticJs)
    http.HandleFunc("/static/stub.js", handlerStubJs)
    http.HandleFunc("/status", handlerStatus)

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

    http.ListenAndServe(":41520", nil)
}
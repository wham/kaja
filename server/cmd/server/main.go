package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	assets "github.com/wham/kaja/v2"
	"github.com/wham/kaja/v2/internal/grpc"
	"github.com/wham/kaja/v2/internal/ui"
	"github.com/wham/kaja/v2/pkg/agent"
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

	// api.proto declares no package, so the gRPC path of the internal service is
	// /Api/<Method>. It is answered as gRPC-Web, the same framing the app lane answers
	// in, rather than as a protocol of its own.
	mux.HandleFunc("POST /Api/{method}", func(w http.ResponseWriter, r *http.Request) {
		grpc.ServeGRPCWeb(w, r, r.PathValue("method"), apiService.Invoke)
	})

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

	mux.HandleFunc("/target/{method...}", func(w http.ResponseWriter, r *http.Request) {
		contentType := r.Header.Get("Content-Type")
		targetHeader := r.Header.Get("X-Target")

		// Headers with an X-Header- prefix are forwarded to the target. Their values still
		// carry ${NAME} references: the browser sends them unexpanded, because a variable's
		// value may be one this server holds and the browser is not allowed to know.
		forwardHeaders := make(map[string]string)
		for name, values := range r.Header {
			if strings.HasPrefix(name, "X-Header-") && len(values) > 0 {
				headerName := strings.TrimPrefix(name, "X-Header-")
				forwardHeaders[headerName] = values[0]
			}
		}

		// The reserved header names the app the call belongs to and goes no further: it is
		// what the credential and the transport are looked up by.
		appName := apps.TakeAppName(forwardHeaders)

		// App targets (kaja-app://<id>) are invoked in-process by the app manager instead of
		// being proxied. InvokeApp expands the headers and redacts what it reports back.
		if apps.IsAppTarget(targetHeader) {
			grpc.ServeAppGRPCWeb(w, r, r.PathValue("method"), func(method string, message []byte, headers map[string]string) (*apps.InvokeResult, error) {
				return apiService.InvokeApp(targetHeader, method, message, headers)
			}, forwardHeaders)
			return
		}

		forwardHeaders = apiService.Variables().ExpandAll(forwardHeaders)

		// The app's own credential is applied here rather than sent from the browser, so a
		// "${secret}" token never leaves this process.
		connection := apiService.AppConnection(appName)
		forwardHeaders = apps.MergeMetadata(forwardHeaders, connection.Metadata)

		target, err := url.Parse(targetHeader)
		if err != nil {
			slog.Warn("Failed to parse X-Target header", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte("Invalid X-Target header"))
			return
		}

		if strings.HasPrefix(contentType, "application/grpc-web") ||
			strings.HasPrefix(contentType, "application/grpc-web-text") {

			proxy, err := grpc.NewProxy(target, connection.TLS)
			if err != nil {
				slog.Error("Failed to create gRPC proxy", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			proxy.ServeHTTP(w, r, r.PathValue("method"), forwardHeaders)
			return
		} else {
			proxy := httputil.NewSingleHostReverseProxy(target)
			proxy.Director = func(req *http.Request) {
				req.Host = target.Host
				req.URL.Scheme = target.Scheme
				req.URL.Host = target.Host
				// Replace /target/ with /twirp/ and append to the target path.
				path := strings.Replace(req.URL.Path, "/target/", "/twirp/", 1)
				req.URL.Path = target.Path + path
				for name, value := range forwardHeaders {
					req.Header.Set(name, value)
				}
			}
			started := time.Now()
			// The one Kaja process in the call's path stamps the upstream exchange.
			// Twirp has no trailers, so the measurement rides a reserved response
			// header (kaja-upstream-*, the same namespace the gRPC paths use as
			// trailers), which the client strips before showing response headers.
			proxy.ModifyResponse = func(resp *http.Response) error {
				resp.Header.Set("Kaja-Upstream-Duration-Ms", strconv.FormatInt(time.Since(started).Milliseconds(), 10))
				return nil
			}
			proxy.ServeHTTP(w, r)
		}
	})

	// A REST app's calls come through here rather than through /target: the browser
	// built the request itself from the document, so what crosses is an HTTP call
	// rather than an encoded message. What this adds is the two things the browser
	// is not given — where the API is, and the credential that opens it.
	mux.HandleFunc("POST /rest", func(w http.ResponseWriter, r *http.Request) {
		forwardHeaders := make(map[string]string)
		for name, values := range r.Header {
			if strings.HasPrefix(name, "X-Header-") && len(values) > 0 {
				forwardHeaders[strings.TrimPrefix(name, "X-Header-")] = values[0]
			}
		}
		apps.TakeAppName(forwardHeaders)

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "could not read the request body", http.StatusBadRequest)
			return
		}

		result, err := apiService.ForwardApp(r.Header.Get("X-Target"), &apps.ForwardRequest{
			Method:  r.Header.Get("X-Kaja-Method"),
			Path:    r.Header.Get("X-Kaja-Path"),
			Headers: forwardHeaders,
			Body:    body,
		})
		if err != nil {
			// The call could not be made at all, which is not a status the API
			// returned — so it is reported as kaja failing as the gateway it is here
			// rather than dressed up as an answer.
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusBadGateway)
			w.Write([]byte(err.Error()))
			return
		}

		writeForwardResult(w, result)
	})

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

// writeForwardResult hands one upstream answer back to the browser: the status and
// body as they came, and everything kaja knows about the exchange under the
// reserved kaja-upstream-* namespace the other transports already use, so the
// Headers view shows the API's own headers and nothing of the hop.
func writeForwardResult(w http.ResponseWriter, result *apps.ForwardResult) {
	headers, err := json.Marshal(result.Headers)
	if err != nil {
		headers = []byte("{}")
	}
	requestHeaders, err := json.Marshal(result.RequestHeaders)
	if err != nil {
		requestHeaders = []byte("{}")
	}

	w.Header().Set("Kaja-Upstream-Response-Headers", string(headers))
	w.Header().Set("Kaja-Upstream-Request-Headers", string(requestHeaders))
	w.Header().Set("Kaja-Upstream-Duration-Ms", strconv.FormatInt(result.DurationMs, 10))
	w.Header().Set("Kaja-Upstream-Status", strconv.Itoa(result.Status))
	if contentType := result.Headers["Content-Type"]; contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	// The browser is told 200 whatever the API said, and reads the real status off
	// the reserved header: a 404 the API returned is an answer this hop delivered
	// successfully, and letting fetch see it as a failure would lose the body.
	w.WriteHeader(http.StatusOK)
	w.Write(result.Body)
}

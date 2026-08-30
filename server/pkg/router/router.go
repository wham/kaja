// Package router registers the doors a call arrives at.
//
// There is one set of them and both builds serve it: the web listens on :41520,
// the desktop hands this mux to its webview's scheme handler. So a call is the
// same request, framed the same way, wherever the UI happens to be running.
package router

import (
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/wham/kaja/v2/internal/grpc"
	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/apps"
)

// Mount registers the two lanes every kaja answers on: the internal Api service
// and the per-app target.
func Mount(mux *http.ServeMux, apiService *api.ApiService) {
	// api.proto declares no package, so the gRPC path of the internal service is
	// /Api/<Method>. It is answered as gRPC-Web, the same framing the app lane answers
	// in, rather than as a protocol of its own.
	mux.HandleFunc("POST /Api/{method}", func(w http.ResponseWriter, r *http.Request) {
		grpc.ServeGRPCWeb(w, r, r.PathValue("method"), apiService.Invoke)
	})

	// Every call the client makes arrives here as gRPC-Web, whatever the app talks to
	// upstream. X-Target says which of the two things this process does with it: dial
	// the gRPC server it names, or invoke the app it names in this process.
	mux.HandleFunc("/target/{method...}", func(w http.ResponseWriter, r *http.Request) {
		targetHeader := r.Header.Get("X-Target")

		// Headers with an X-Header- prefix are forwarded to the target. Their values still
		// carry ${NAME} references: the client sends them unexpanded, because a variable's
		// value may be one this process holds and a remote browser is not allowed to know.
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

		// The app's own credential is applied here rather than sent from the client, so a
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

		proxy, err := grpc.NewProxy(target, connection.TLS)
		if err != nil {
			slog.Error("Failed to create gRPC proxy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		proxy.ServeHTTP(w, r, r.PathValue("method"), forwardHeaders)
	})
}

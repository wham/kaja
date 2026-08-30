// Package router registers the doors a call arrives at.
//
// There is one set of them and both builds serve it: the web listens on :41520,
// the desktop hands this mux to its webview's scheme handler. So a call is the
// same request, framed the same way, wherever the UI happens to be running.
package router

import (
	"context"
	"net/http"
	"strings"

	"github.com/wham/kaja/v2/internal/grpc"
	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/apps"
)

// Mount registers the two lanes every kaja answers on: the internal Api service
// and the apps.
func Mount(mux *http.ServeMux, apiService *api.ApiService) {
	// api.proto declares no package, so the gRPC path of the internal service is
	// /Api/<Method>. It is answered in the same framing the app lane answers in, by the
	// same handler: a service running in this process is a call that answers with one
	// message, which is the stream every call is.
	mux.HandleFunc("POST /Api/{method}", func(w http.ResponseWriter, r *http.Request) {
		grpc.Serve(w, r, r.PathValue("method"), nil, func(ctx context.Context, method string, message []byte, _ map[string]string) (apps.Stream, error) {
			response, err := apiService.Invoke(ctx, method, message)
			if err != nil {
				return nil, err
			}
			// Nothing is forwarded, so there is no upstream to report and no trailer
			// beyond the status.
			return apps.OneMessage(response, nil), nil
		})
	})

	// Every call the client makes arrives here as gRPC-Web, whatever the app talks to
	// upstream and whatever kaja does with it: transcode it in this process, or forward
	// it to the gRPC server it names. Which of those is the app's business, and the app
	// is named by the reserved header the call already carries — so there is no address
	// for the client to be told and none for it to get wrong.
	mux.HandleFunc("/app/{method...}", func(w http.ResponseWriter, r *http.Request) {
		// Headers with an X-Header- prefix are forwarded to the app. Their values still
		// carry ${NAME} references: the client sends them unexpanded, because a variable's
		// value may be one this process holds and a remote browser is not allowed to know.
		forwardHeaders := make(map[string]string)
		for name, values := range r.Header {
			if strings.HasPrefix(name, "X-Header-") && len(values) > 0 {
				headerName := strings.TrimPrefix(name, "X-Header-")
				forwardHeaders[headerName] = values[0]
			}
		}

		grpc.Serve(w, r, r.PathValue("method"), forwardHeaders, apiService.InvokeApp)
	})
}

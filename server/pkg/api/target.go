package api

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/wham/kaja/v2/internal/grpc"
	"github.com/wham/kaja/v2/pkg/apps"
)

// TargetHandler is the one door a call goes out of.
//
// It was written inline in the web server and is a package-level handler now
// because an exported app is a second thing that has to serve it, and a call
// that reached its upstream one way here and another way there would be two
// products. In-process apps are invoked through the manager, grpc apps are
// proxied as gRPC-Web, and twirp apps are reverse-proxied — with the app's own
// credential applied on the way out, so a "${secret}" token is never handed to
// the browser.
func TargetHandler(service *ApiService, method func(*http.Request) string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		contentType := r.Header.Get("Content-Type")
		targetHeader := r.Header.Get("X-Target")

		// Extract headers with X-Header- prefix to forward to target. Their values
		// still carry ${NAME} variable references: the browser sends them
		// unexpanded because a variable's value may be one this process holds and
		// the browser is not allowed to know.
		forwardHeaders := make(map[string]string)
		for name, values := range r.Header {
			if strings.HasPrefix(name, "X-Header-") && len(values) > 0 {
				forwardHeaders[strings.TrimPrefix(name, "X-Header-")] = values[0]
			}
		}

		// The reserved header names the app the call belongs to, and goes no
		// further: it is what the credential and the transport are looked up by.
		appName := apps.TakeAppName(forwardHeaders)

		if apps.IsAppTarget(targetHeader) {
			grpc.ServeAppGRPCWeb(w, r, method(r), func(method string, message []byte, headers map[string]string) (*apps.InvokeResult, error) {
				return service.InvokeApp(targetHeader, method, message, headers)
			}, forwardHeaders)
			return
		}

		forwardHeaders = service.Variables().ExpandAll(forwardHeaders)

		connection := service.AppConnection(appName)
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
			proxy.ServeHTTP(w, r, method(r), forwardHeaders)
			return
		}

		proxy := httputil.NewSingleHostReverseProxy(target)
		proxy.Director = func(req *http.Request) {
			req.Host = target.Host
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			// Replace /target/ with /twirp/ and append to target path
			path := strings.Replace(req.URL.Path, "/target/", "/twirp/", 1)
			req.URL.Path = target.Path + path
			for name, value := range forwardHeaders {
				req.Header.Set(name, value)
			}
		}
		proxy.ServeHTTP(w, r)
	}
}

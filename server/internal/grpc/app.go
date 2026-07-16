package grpc

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/wham/kaja/v2/pkg/apps"
)

// Trailer keys carrying the headers an in-process app exchanged with its
// upstream service, each a JSON object of header name to value. The client
// surfaces them in its Headers view alongside the transport headers.
const (
	upstreamRequestHeadersTrailer  = "kaja-upstream-request-headers"
	upstreamResponseHeadersTrailer = "kaja-upstream-response-headers"
)

// AppInvoker invokes an in-process app method given the de-framed request message
// and returns the invocation result (response message plus any upstream headers).
type AppInvoker func(method string, message []byte, headers map[string]string) (*apps.InvokeResult, error)

// ServeAppGRPCWeb handles a gRPC-Web request targeting an in-process app: it
// de-frames the request message, invokes the app, and writes a gRPC-Web framed
// response, or a gRPC-Web error trailer on failure. The framing mirrors Proxy so
// the same browser gRPC-Web client handles both.
func ServeAppGRPCWeb(w http.ResponseWriter, r *http.Request, method string, invoke AppInvoker, headers map[string]string) {
	isText := strings.HasPrefix(r.Header.Get("Content-Type"), "application/grpc-web-text")

	message, err := readGRPCWebMessage(r.Body, isText)
	if err != nil {
		slog.Error("Failed to read gRPC-Web app request", "error", err)
		http.Error(w, "Failed to read request", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/grpc-web-text")

	result, err := invoke(method, message, headers)
	if err != nil {
		slog.Error("App invocation failed", "method", method, "error", err)
		var upstream *apps.UpstreamError
		if errors.As(err, &upstream) {
			// An upstream HTTP failure maps to the closest gRPC status; the raw
			// response body rides in a trailer the client shows alongside it.
			writeGRPCWebText(w, nil, grpcStatusFromHTTP(upstream.Status), upstream.Error(), map[string]string{"upstream-body": string(upstream.Body)})
			return
		}
		// gRPC status 2 = UNKNOWN; the browser surfaces grpc-message as the error.
		writeGRPCWebText(w, nil, 2, err.Error(), nil)
		return
	}
	writeGRPCWebText(w, result.Body, 0, "", upstreamHeaderTrailers(result))
}

// upstreamHeaderTrailers encodes an app's exchanged upstream headers as gRPC-Web
// trailers, one JSON object each. Returns nil when the app surfaced no upstream
// headers (e.g. a local app), so no trailer is emitted.
func upstreamHeaderTrailers(result *apps.InvokeResult) map[string]string {
	trailers := map[string]string{}
	if encoded, ok := encodeHeaderTrailer(result.RequestHeaders); ok {
		trailers[upstreamRequestHeadersTrailer] = encoded
	}
	if encoded, ok := encodeHeaderTrailer(result.ResponseHeaders); ok {
		trailers[upstreamResponseHeadersTrailer] = encoded
	}
	if len(trailers) == 0 {
		return nil
	}
	return trailers
}

// encodeHeaderTrailer JSON-encodes a header map for a trailer value without
// HTML-escaping, so header names/values (which may contain <, >, &) stay
// readable. Returns false for an empty map so no trailer is emitted.
func encodeHeaderTrailer(headers map[string]string) (string, bool) {
	if len(headers) == 0 {
		return "", false
	}
	var buf strings.Builder
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(headers); err != nil {
		return "", false
	}
	// Encoder.Encode appends a trailing newline; drop it to keep the trailer on
	// a single line.
	return strings.TrimRight(buf.String(), "\n"), true
}

// grpcStatusFromHTTP maps an upstream HTTP status code to the closest gRPC
// status code.
func grpcStatusFromHTTP(status int) int {
	switch status {
	case http.StatusBadRequest:
		return 3 // INVALID_ARGUMENT
	case http.StatusUnauthorized:
		return 16 // UNAUTHENTICATED
	case http.StatusForbidden:
		return 7 // PERMISSION_DENIED
	case http.StatusNotFound:
		return 5 // NOT_FOUND
	case http.StatusConflict:
		return 10 // ABORTED
	case http.StatusTooManyRequests:
		return 8 // RESOURCE_EXHAUSTED
	case http.StatusNotImplemented:
		return 12 // UNIMPLEMENTED
	case http.StatusServiceUnavailable:
		return 14 // UNAVAILABLE
	case http.StatusGatewayTimeout:
		return 4 // DEADLINE_EXCEEDED
	}
	if status >= 500 {
		return 13 // INTERNAL
	}
	return 2 // UNKNOWN
}

// writeGRPCWebText writes a base64 gRPC-Web-text response: an optional data frame
// followed by a trailer frame carrying grpc-status, grpc-message, and any extra
// trailers.
func writeGRPCWebText(w http.ResponseWriter, message []byte, status int, grpcMessage string, extraTrailers map[string]string) {
	var full []byte
	if message != nil {
		frame := make([]byte, 5+len(message))
		frame[0] = 0 // data frame
		binary.BigEndian.PutUint32(frame[1:5], uint32(len(message)))
		copy(frame[5:], message)
		full = frame
	}

	trailers := fmt.Sprintf("grpc-status: %d\r\ngrpc-message: %s\r\n", status, sanitizeTrailerValue(grpcMessage))
	for name, value := range extraTrailers {
		trailers += fmt.Sprintf("%s: %s\r\n", name, sanitizeTrailerValue(value))
	}
	trailerBytes := []byte(trailers)
	trailerFrame := make([]byte, 5+len(trailerBytes))
	trailerFrame[0] = 0x80 // trailer frame
	binary.BigEndian.PutUint32(trailerFrame[1:5], uint32(len(trailerBytes)))
	copy(trailerFrame[5:], trailerBytes)
	full = append(full, trailerFrame...)

	w.Write([]byte(base64.StdEncoding.EncodeToString(full)))
}

// sanitizeTrailerValue keeps a grpc-message on a single trailer line.
func sanitizeTrailerValue(s string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(s)
}

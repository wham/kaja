package grpc

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/wham/kaja/v2/pkg/apps"
)

// Trailers carrying what an in-process app exchanged with its upstream service,
// out of band from the response message. The headers ones are a JSON object of
// header name to value each, surfaced in the client's Headers view; the error
// one is the structured HTTP failure (apps.UpstreamError.JSON), which the client
// shows *instead of* the gRPC error, so the tunnel doesn't show through.
const (
	upstreamRequestHeadersTrailer  = "kaja-upstream-request-headers"
	upstreamResponseHeadersTrailer = "kaja-upstream-response-headers"
	upstreamErrorTrailer           = "kaja-upstream-error"
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
			// An upstream HTTP failure maps to the closest gRPC status so a plain
			// gRPC-Web client still sees a sensible error, but the failure itself -
			// status, message, request line, body - rides whole in its own trailer.
			// That is what the client shows: the HTTP call failed, and the gRPC
			// status it was tunnelled through is not part of the story. The
			// exchanged headers come along too (a 401 is exactly when they matter).
			trailers := upstreamHeaderTrailers(upstream.RequestHeaders, upstream.ResponseHeaders)
			trailers[upstreamErrorTrailer] = string(upstream.JSON())
			writeGRPCWebText(w, nil, grpcStatusFromHTTP(upstream.TransportStatus()), upstream.Error(), trailers)
			return
		}
		// gRPC status 2 = UNKNOWN; the browser surfaces grpc-message as the error.
		writeGRPCWebText(w, nil, 2, err.Error(), nil)
		return
	}
	writeGRPCWebText(w, result.Body, 0, "", upstreamHeaderTrailers(result.RequestHeaders, result.ResponseHeaders))
}

// upstreamHeaderTrailers encodes an app's exchanged upstream headers as gRPC-Web
// trailers, one JSON object each. Absent maps contribute no trailer; the result
// is always non-nil so callers can add their own trailers to it.
func upstreamHeaderTrailers(requestHeaders, responseHeaders map[string]string) map[string]string {
	trailers := map[string]string{}
	if encoded, ok := encodeHeaderTrailer(requestHeaders); ok {
		trailers[upstreamRequestHeadersTrailer] = encoded
	}
	if encoded, ok := encodeHeaderTrailer(responseHeaders); ok {
		trailers[upstreamResponseHeadersTrailer] = encoded
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

// A trailer block is metadata about a response, not a place to put one, and nothing in
// it is a size kaja chose: a header set an upstream sent, a body it only truncated, and
// escapeTrailerValue can triple either on the way in. So the block is bounded, and a
// value that does not fit is dropped whole rather than cut - half a JSON object is
// worse than none, and the client already reads a missing trailer as one that never
// came. Names are written in order, which puts the failure itself ahead of the headers
// that merely describe the hop, so what is dropped under pressure is the lesser thing.
const maxTrailerBytes = 64 << 10

// writeGRPCWebText writes a base64 gRPC-Web-text response: an optional data frame
// followed by a trailer frame carrying grpc-status, grpc-message, and any extra
// trailers.
func writeGRPCWebText(w http.ResponseWriter, message []byte, status int, grpcMessage string, extraTrailers map[string]string) {
	var full []byte
	if message != nil {
		full = grpcWebFrame(0, message)
	}

	var trailers strings.Builder
	// grpc-message is a sentence rather than a document, so it is cut to fit instead of
	// dropped: a truncated reason still reads as the reason.
	fmt.Fprintf(&trailers, "grpc-status: %d\r\ngrpc-message: %s\r\n", status, escapeTrailerValue(cut(grpcMessage, maxTrailerBytes/4)))
	names := make([]string, 0, len(extraTrailers))
	for name := range extraTrailers {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		line := name + ": " + escapeTrailerValue(extraTrailers[name]) + "\r\n"
		if trailers.Len()+len(line) > maxTrailerBytes {
			continue
		}
		trailers.WriteString(line)
	}

	full = append(full, grpcWebFrame(0x80, []byte(trailers.String()))...)

	w.Write([]byte(base64.StdEncoding.EncodeToString(full)))
}

// grpcWebFrame prefixes a payload with its gRPC-Web frame header: a flag byte (0 for
// data, 0x80 for trailers) and the payload length as a big-endian uint32. Appended
// rather than sized up front, so the length arithmetic cannot be what goes wrong.
func grpcWebFrame(flag byte, payload []byte) []byte {
	frame := []byte{flag, 0, 0, 0, 0}
	binary.BigEndian.PutUint32(frame[1:5], uint32(len(payload)))
	return append(frame, payload...)
}

// cut bounds a string to n bytes without splitting the UTF-8 sequence at the end.
func cut(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// escapeTrailerValue percent-encodes everything a gRPC-Web trailer line cannot
// carry verbatim. Trailers are a text block a client splits on CRLF and reads
// byte by byte as Latin-1, so a UTF-8 payload arrives mangled ("—" as "â€""),
// and a newline in a value would end the line early. Encoding the bytes outside
// printable ASCII - and "%" itself, so the escape is reversible - keeps ordinary
// JSON readable on the wire while surviving the trip intact. This is also what
// the gRPC-Web spec asks of grpc-message.
func escapeTrailerValue(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < 0x20 || c > 0x7e || c == '%' {
			fmt.Fprintf(&b, "%%%02X", c)
			continue
		}
		b.WriteByte(c)
	}
	return b.String()
}

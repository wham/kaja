package grpc

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
)

// AppInvoker invokes an in-process app method given the de-framed request message
// and returns the response message (both unframed protobuf bytes).
type AppInvoker func(method string, message []byte, headers map[string]string) ([]byte, error)

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

	response, err := invoke(method, message, headers)
	if err != nil {
		slog.Error("App invocation failed", "method", method, "error", err)
		// gRPC status 2 = UNKNOWN; the browser surfaces grpc-message as the error.
		writeGRPCWebText(w, nil, 2, err.Error())
		return
	}
	writeGRPCWebText(w, response, 0, "")
}

// writeGRPCWebText writes a base64 gRPC-Web-text response: an optional data frame
// followed by a trailer frame carrying grpc-status and grpc-message.
func writeGRPCWebText(w http.ResponseWriter, message []byte, status int, grpcMessage string) {
	var full []byte
	if message != nil {
		frame := make([]byte, 5+len(message))
		frame[0] = 0 // data frame
		binary.BigEndian.PutUint32(frame[1:5], uint32(len(message)))
		copy(frame[5:], message)
		full = frame
	}

	trailers := fmt.Sprintf("grpc-status: %d\r\ngrpc-message: %s\r\n", status, sanitizeTrailerValue(grpcMessage))
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

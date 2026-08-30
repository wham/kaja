package grpc

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"google.golang.org/grpc/status"
)

// ServiceInvoker invokes one unary method of a service this process implements,
// taking and returning encoded protobuf.
type ServiceInvoker func(ctx context.Context, methodPath string, message []byte) ([]byte, error)

// ServeGRPCWeb answers a gRPC-Web request for a service running in this process.
// Nothing is forwarded, so there is no upstream to report and no trailer beyond the
// status: the same framing ServeAppGRPCWeb answers in, which is what lets one browser
// transport reach both.
func ServeGRPCWeb(w http.ResponseWriter, r *http.Request, methodPath string, invoke ServiceInvoker) {
	isText := strings.HasPrefix(r.Header.Get("Content-Type"), "application/grpc-web-text")

	message, err := readGRPCWebMessage(r.Body, isText)
	if err != nil {
		slog.Error("Failed to read gRPC-Web request", "method", methodPath, "error", err)
		http.Error(w, "Failed to read request", http.StatusBadRequest)
		return
	}

	response, err := invoke(r.Context(), methodPath, message)
	if err != nil {
		slog.Error("Call failed", "method", methodPath, "error", err)
		// A plain Go error converts to UNKNOWN carrying its own text, so what the
		// service wrote is what the browser reads either way.
		failure := status.Convert(err)
		writeGRPCWeb(w, nil, int(failure.Code()), failure.Message(), nil)
		return
	}
	writeGRPCWeb(w, response, 0, "", nil)
}

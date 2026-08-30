package grpc

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/wham/kaja/v2/pkg/apps"
	"google.golang.org/grpc/status"
)

// UpstreamTrailer is the one trailer kaja writes of its own: what happened upstream of
// this process, out of band from the response messages. It is the response side of the
// reserved X-Kaja-App request header — never something the upstream sent, which is why
// the client consumes it rather than showing it as a response header. Its value is an
// apps.Upstream object.
const UpstreamTrailer = "kaja-upstream"

// Invoker starts one call and hands back the stream its responses arrive on.
type Invoker func(ctx context.Context, method string, message []byte, headers map[string]string) (apps.Stream, error)

// Serve answers one gRPC-Web request: de-frame the request message, invoke, frame out
// however many messages come back. It is the whole server-side lane — the internal Api
// service, an app kaja transcodes in this process, and a gRPC call it forwards are all
// a call that answers with a stream, and a unary method is the stream that stops after
// one message. Which of those it is, the browser never has to say.
func Serve(w http.ResponseWriter, r *http.Request, method string, headers map[string]string, invoke Invoker) {
	message, err := readGRPCWebMessage(r.Body)
	if err != nil {
		slog.Error("Failed to read gRPC-Web request", "method", method, "error", err)
		http.Error(w, "Failed to read request", http.StatusBadRequest)
		return
	}

	// The call lives as long as the browser's request and no longer: a stream ends when
	// the server runs out or when Stop aborts the fetch, and a deadline of kaja's own
	// would cut a long one short at a number nobody chose.
	stream, err := invoke(r.Context(), method, message, headers)
	if err != nil {
		slog.Error("Call failed", "method", method, "error", err)
		writeFailure(newGRPCWebResponse(w), err)
		return
	}

	response := newGRPCWebResponse(w)
	for {
		received, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			slog.Error("Call failed", "method", method, "error", err)
			// A stream that fails partway through keeps the messages it already sent: the
			// status says what stopped it, and the frames before it stand.
			code, grpcMessage := grpcStatusOf(err)
			report := stream.Report()
			response.end(code, grpcMessage, apps.UpstreamOf(report), metadataOf(report))
			return
		}
		response.message(received)
	}

	report := stream.Report()
	response.end(0, "", apps.UpstreamOf(report), metadataOf(report))
}

// metadataOf is what a forwarded call's server answered with, under its own names.
func metadataOf(report *apps.Report) map[string]string {
	if report == nil {
		return nil
	}
	return report.Metadata
}

// writeFailure answers a call that never produced a stream. An upstream HTTP failure
// maps to the closest gRPC status so a plain gRPC-Web client still sees a sensible
// error, but the failure itself — status, message, request line, body — rides whole in
// kaja's own trailer. That is what the client shows: the HTTP call failed, and the gRPC
// status it was tunnelled through is not part of the story.
func writeFailure(response *grpcWebResponse, err error) {
	var upstream *apps.UpstreamError
	if errors.As(err, &upstream) {
		response.end(grpcStatusFromHTTP(upstream.TransportStatus()), upstream.Error(), apps.UpstreamOfError(upstream), nil)
		return
	}
	code, grpcMessage := grpcStatusOf(err)
	response.end(code, grpcMessage, nil, nil)
}

// grpcStatusOf reads the status a gRPC error carries, however deep the client wrapped
// it. An error with no status never left this process, which is what UNKNOWN says —
// and what a plain error from the Api service converts to, carrying its own text.
func grpcStatusOf(err error) (int, string) {
	var carrier interface{ GRPCStatus() *status.Status }
	if errors.As(err, &carrier) {
		s := carrier.GRPCStatus()
		return int(s.Code()), s.Message()
	}
	failure := status.Convert(err)
	return int(failure.Code()), failure.Message()
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

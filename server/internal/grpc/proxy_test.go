package grpc

import (
	"errors"
	"fmt"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestGRPCStatusOf locks in that the status an upstream gRPC server answered with
// survives the client's error wrapping, so the browser is shown NOT_FOUND from the
// API rather than a 500 from the proxy.
func TestGRPCStatusOf(t *testing.T) {
	wrapped := fmt.Errorf("gRPC invocation failed: %w", status.Error(codes.NotFound, "no such show"))
	code, message := grpcStatusOf(wrapped)
	if code != int(codes.NotFound) || message != "no such show" {
		t.Errorf("grpcStatusOf(wrapped) = %d %q, want %d %q", code, message, codes.NotFound, "no such show")
	}

	// An error with no status never left this process, which is what UNKNOWN says.
	code, message = grpcStatusOf(errors.New("dial tcp: connection refused"))
	if code != 2 || message != "dial tcp: connection refused" {
		t.Errorf("grpcStatusOf(plain) = %d %q, want 2 and the message intact", code, message)
	}
}

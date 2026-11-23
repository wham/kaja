package rpc

import (
	"context"
	"net"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/wham/kaja/v2/pkg/grpc"
)

// A listener that never accepts a word of HTTP/2 is a server nothing connects to.
func TestClassifyNeverConnected(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	target, err := url.Parse("dns:" + listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 300*time.Millisecond)
	defer cancel()
	_, err = grpc.NewReflectionClient(target, grpc.TLSOptions{Mode: grpc.TLSOff}, nil).Discover(ctx)
	if err == nil {
		t.Fatal("a silent listener reflected")
	}

	problem := classify(err)
	if problem.Kind != ProblemTimeout || problem.Message != "Couldn't connect to the server." {
		t.Errorf("problem = %+v from %v", problem, err)
	}
	if strings.Contains(problem.Detail, "reflection") {
		t.Errorf("detail = %q", problem.Detail)
	}
}

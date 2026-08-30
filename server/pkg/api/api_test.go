package api

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/wham/kaja/v2/pkg/apps"
)

// failingStream answers with one message and then the failure that ended it, which is
// what a call that has already started answering fails as.
type failingStream struct {
	sent bool
	err  error
}

func (s *failingStream) Recv() ([]byte, error) {
	if s.sent {
		return nil, s.err
	}
	s.sent = true
	return []byte("first"), nil
}

func (s *failingStream) Report() *apps.Report { return &apps.Report{} }

// The door writes one line per call, and a stream that failed halfway through is a
// call whose outcome is settled at its report: the status the upstream refused it with
// has to be on that line, or a headless deployment has nothing saying the call failed
// at all.
func TestTheDoorLogsTheStatusOfAFailureThatSurfacedMidStream(t *testing.T) {
	lines := &bytes.Buffer{}
	restore := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(lines, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(restore) })

	failure := apps.NewUpstreamError(http.MethodGet, "https://api.example.com/orders", http.StatusTooManyRequests, []byte(`{"msg":"slow down"}`))
	stream := &timedStream{
		stream:   &failingStream{err: failure},
		started:  time.Now(),
		resolver: NewResolver(nil, nil),
		log:      callLog{method: "orders.v1.Orders/List", app: "orders"},
	}

	if _, err := stream.Recv(); err != nil {
		t.Fatalf("first Recv: %v", err)
	}
	if _, err := stream.Recv(); err == nil {
		t.Fatal("second Recv answered, want the failure that ended the stream")
	}
	stream.Report()

	if !strings.Contains(lines.String(), "upstreamStatus=429") {
		t.Errorf("the line says nothing of what refused the call: %q", lines.String())
	}
}

// A stream that ran out is not a stream that failed.
func TestTheDoorLogsNoStatusForAStreamThatEnded(t *testing.T) {
	lines := &bytes.Buffer{}
	restore := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(lines, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(restore) })

	stream := &timedStream{
		stream:   &failingStream{err: io.EOF},
		started:  time.Now(),
		resolver: NewResolver(nil, nil),
		log:      callLog{method: "orders.v1.Orders/List", app: "orders"},
	}

	stream.Recv()
	stream.Recv()
	stream.Report()

	if strings.Contains(lines.String(), "upstreamStatus") {
		t.Errorf("a stream that ran out was logged as a failure: %q", lines.String())
	}
}

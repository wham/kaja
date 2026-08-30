package grpc

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/kaja/v2/pkg/apps/rpc"
	googlegrpc "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// passthroughCodec is the server-side counterpart of the client's raw-bytes codec.
// A forwarded call is never decoded, so the upstream a test points at must not decode
// it either.
type passthroughCodec struct{}

func (passthroughCodec) Marshal(v any) ([]byte, error) {
	if b, ok := v.([]byte); ok {
		return b, nil
	}
	return nil, fmt.Errorf("unsupported type: %T", v)
}

func (passthroughCodec) Unmarshal(data []byte, v any) error {
	if b, ok := v.(*[]byte); ok {
		*b = append([]byte(nil), data...)
		return nil
	}
	return fmt.Errorf("unsupported type: %T", v)
}

func (passthroughCodec) Name() string { return "proto" }

// upstream runs a gRPC server answering every method with handle, and returns the
// address a grpc app reaches it at. Registering no service and handling the unknown
// one is what lets a test answer a method no proto declares.
func upstream(t *testing.T, handle func(request []byte, stream googlegrpc.ServerStream) error) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := googlegrpc.NewServer(
		googlegrpc.ForceServerCodec(passthroughCodec{}),
		googlegrpc.UnknownServiceHandler(func(_ any, stream googlegrpc.ServerStream) error {
			var request []byte
			if err := stream.RecvMsg(&request); err != nil {
				return err
			}
			return handle(request, stream)
		}),
	)
	go server.Serve(listener)
	t.Cleanup(server.Stop)

	return "http://" + listener.Addr().String()
}

// call posts one gRPC-Web request at the handler in front of a grpc app pointed at
// url, and hands back the response body to be read as it arrives. The app is the real
// one: forwarding is how it answers a call, so the lane under test is the whole of it.
func call(t *testing.T, url string, request []byte) io.ReadCloser {
	t.Helper()
	opened, err := rpc.New().Open(map[string]string{"url": url, "proto_dir": "unused"}, "", func(string) {})
	if err != nil {
		t.Fatalf("open grpc app: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		Serve(w, r, "test.Service/Method", nil, func(ctx context.Context, method string, message []byte, headers map[string]string) (apps.Stream, error) {
			return opened.Instance.Invoke(ctx, &apps.Call{Method: method, Request: message, Headers: headers})
		})
	}))
	t.Cleanup(server.Close)

	response, err := http.Post(server.URL, "application/grpc-web+proto", bytes.NewReader(requestFrame(request)))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	t.Cleanup(func() { response.Body.Close() })
	if got := response.Header.Get("Content-Type"); got != "application/grpc-web+proto" {
		t.Fatalf("content type = %q, want the binary format", got)
	}
	return response.Body
}

// nextFrame reads one gRPC-Web frame, blocking until the whole of it has arrived.
func nextFrame(t *testing.T, body io.Reader) (flag byte, payload []byte) {
	t.Helper()
	header := make([]byte, 5)
	if _, err := io.ReadFull(body, header); err != nil {
		t.Fatalf("read frame header: %v", err)
	}
	payload = make([]byte, binary.BigEndian.Uint32(header[1:5]))
	if _, err := io.ReadFull(body, payload); err != nil {
		t.Fatalf("read frame payload: %v", err)
	}
	return header[0], payload
}

// TestForwardStreamsAsItGoes locks in the whole point of the lane: a server stream's
// messages reach the browser one at a time. The upstream holds the second message back
// until the first has been read off the wire, so a lane that collected the stream
// before answering would deadlock here rather than merely arrive late.
func TestForwardStreamsAsItGoes(t *testing.T) {
	read := make(chan struct{})
	url := upstream(t, func(_ []byte, stream googlegrpc.ServerStream) error {
		if err := stream.SendMsg([]byte("first")); err != nil {
			return err
		}
		<-read
		return stream.SendMsg([]byte("second"))
	})

	body := call(t, url, []byte{1})

	flag, payload := nextFrame(t, body)
	if flag != 0 || string(payload) != "first" {
		t.Fatalf("first frame = %d %q", flag, payload)
	}
	close(read)

	flag, payload = nextFrame(t, body)
	if flag != 0 || string(payload) != "second" {
		t.Fatalf("second frame = %d %q", flag, payload)
	}

	flag, payload = nextFrame(t, body)
	if flag&0x80 == 0 {
		t.Fatalf("third frame = %d %q, want the trailers", flag, payload)
	}
	if got := trailerValue(t, string(payload), "grpc-status"); got != "0" {
		t.Errorf("grpc-status = %q, want 0\ntrailers = %q", got, payload)
	}
}

// TestForwardsAUnaryCall locks in that one lane serves both: a unary method is a
// stream of one, and its request reaches the server as it was framed.
func TestForwardsAUnaryCall(t *testing.T) {
	url := upstream(t, func(request []byte, stream googlegrpc.ServerStream) error {
		return stream.SendMsg(append([]byte("echo:"), request...))
	})

	body, err := io.ReadAll(call(t, url, []byte{7, 8, 9}))
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	messages, trailers := parseGRPCWebFrames(t, body)
	if len(messages) != 1 || string(messages[0]) != "echo:\a\b\t" {
		t.Fatalf("messages = %q", messages)
	}
	if got := trailerValue(t, trailers, "grpc-status"); got != "0" {
		t.Errorf("grpc-status = %q, want 0\ntrailers = %q", got, trailers)
	}
}

// TestForwardKeepsWhatAFailedStreamSent locks in that a stream that fails partway keeps
// the messages it already sent, and that the status the browser is shown is the one the
// server answered with rather than a failure of Kaja's own. The metadata rides back
// under its own names, which is what the Headers view reads as the API's.
func TestForwardKeepsWhatAFailedStreamSent(t *testing.T) {
	url := upstream(t, func(_ []byte, stream googlegrpc.ServerStream) error {
		stream.SetTrailer(metadata.Pairs("x-ratelimit-remaining", "0"))
		if err := stream.SendMsg([]byte("partial")); err != nil {
			return err
		}
		return status.Error(codes.ResourceExhausted, "slow down")
	})

	body, err := io.ReadAll(call(t, url, []byte{1}))
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	messages, trailers := parseGRPCWebFrames(t, body)
	if len(messages) != 1 || string(messages[0]) != "partial" {
		t.Fatalf("messages = %q, want the one the server sent before it failed", messages)
	}
	if got := trailerValue(t, trailers, "grpc-status"); got != strconv.Itoa(int(codes.ResourceExhausted)) {
		t.Errorf("grpc-status = %q, want %d\ntrailers = %q", got, codes.ResourceExhausted, trailers)
	}
	if got := trailerValue(t, trailers, "grpc-message"); got != "slow down" {
		t.Errorf("grpc-message = %q\ntrailers = %q", got, trailers)
	}
	if got := trailerValue(t, trailers, "x-ratelimit-remaining"); got != "0" {
		t.Errorf("x-ratelimit-remaining = %q, want the server's own\ntrailers = %q", got, trailers)
	}
}

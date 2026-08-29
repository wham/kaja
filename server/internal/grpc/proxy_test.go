package grpc

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	googlegrpc "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	pkggrpc "github.com/wham/kaja/v2/pkg/grpc"
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

// passthroughCodec is the server-side counterpart of the client's raw-bytes codec.
// The proxy forwards frames it never decodes, so the upstream it is pointed at must
// not decode them either.
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

// upstream runs a gRPC server answering every method with handle, and returns the URL
// a proxy reaches it at. Registering no service and handling the unknown one is what
// lets a test answer a method no proto declares.
func upstream(t *testing.T, handle func(request []byte, stream googlegrpc.ServerStream) error) *url.URL {
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

	target, err := url.Parse("http://" + listener.Addr().String())
	if err != nil {
		t.Fatalf("parse target: %v", err)
	}
	return target
}

// call posts one gRPC-Web request at a proxy in front of target and hands back the
// response body to be read as it arrives.
func call(t *testing.T, target *url.URL, request []byte) io.ReadCloser {
	t.Helper()
	proxy, err := NewProxy(target, pkggrpc.TLSOptions{})
	if err != nil {
		t.Fatalf("new proxy: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHTTP(w, r, "test.Service/Method", nil)
	}))
	t.Cleanup(server.Close)

	response, err := http.Post(server.URL, "application/grpc-web-text", strings.NewReader(grpcWebTextFrame(request)))
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

// TestProxyStreamsAsItGoes locks in the whole point of the lane: a server stream's
// messages reach the browser one at a time. The upstream holds the second message
// back until the first has been read off the wire, so a proxy that collected the
// stream before answering would deadlock here rather than merely arrive late.
func TestProxyStreamsAsItGoes(t *testing.T) {
	read := make(chan struct{})
	target := upstream(t, func(_ []byte, stream googlegrpc.ServerStream) error {
		if err := stream.SendMsg([]byte("first")); err != nil {
			return err
		}
		<-read
		return stream.SendMsg([]byte("second"))
	})

	body := call(t, target, []byte{1})

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
	trailers := string(payload)
	if got := trailerValue(t, trailers, "grpc-status"); got != "0" {
		t.Errorf("grpc-status = %q, want 0\ntrailers = %q", got, trailers)
	}
	if trailerValue(t, trailers, "kaja-upstream-duration-ms") == "" {
		t.Errorf("no upstream duration\ntrailers = %q", trailers)
	}
}

// TestProxyForwardsAUnaryCall locks in that one lane serves both: a unary method is a
// stream of one, and its request reaches the server as it was framed.
func TestProxyForwardsAUnaryCall(t *testing.T) {
	target := upstream(t, func(request []byte, stream googlegrpc.ServerStream) error {
		return stream.SendMsg(append([]byte("echo:"), request...))
	})

	body, err := io.ReadAll(call(t, target, []byte{7, 8, 9}))
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

// TestProxyKeepsWhatAFailedStreamSent locks in that a stream that fails partway keeps
// the messages it already sent, and that the status the browser is shown is the one
// the server answered with rather than a failure of the proxy's own. The metadata
// rides back under its own names, which is what the Headers view reads as the API's.
func TestProxyKeepsWhatAFailedStreamSent(t *testing.T) {
	target := upstream(t, func(_ []byte, stream googlegrpc.ServerStream) error {
		stream.SetTrailer(metadata.Pairs("x-ratelimit-remaining", "0"))
		if err := stream.SendMsg([]byte("partial")); err != nil {
			return err
		}
		return status.Error(codes.ResourceExhausted, "slow down")
	})

	body, err := io.ReadAll(call(t, target, []byte{1}))
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

package grpc

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	pkggrpc "github.com/wham/kaja/v2/pkg/grpc"
	"google.golang.org/grpc/status"
)

type Proxy struct {
	client *pkggrpc.Client
}

func NewProxy(target *url.URL, options pkggrpc.TLSOptions) (*Proxy, error) {
	return &Proxy{
		client: pkggrpc.NewClient(target, options),
	}, nil
}

// ServeHTTP forwards one gRPC-Web call. Every call is forwarded as a server stream,
// because at this end of the wire there is nothing to tell one from a unary call: the
// request framing is identical, and a unary method answers with the one message and
// the status that a stream of one is. So the proxy forwards what arrives, however
// many messages that turns out to be.
func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request, method string, headers map[string]string) {
	isText := strings.HasPrefix(r.Header.Get("Content-Type"), "application/grpc-web-text")

	message, err := readGRPCWebMessage(r.Body, isText)
	if err != nil {
		slog.Error("Failed to read gRPC-Web request", "error", err)
		http.Error(w, "Failed to read request", http.StatusBadRequest)
		return
	}

	response := newGRPCWebResponse(w)

	// The one Kaja process in the call's path stamps the upstream exchange, so what
	// the client shows as the call's duration is the API's time, not the trip here.
	started := time.Now()
	// The call lives as long as the browser's request and no longer: a stream ends
	// when the server runs out or when Stop aborts the fetch, and a deadline of
	// Kaja's own would cut a long one short at a number nobody chose.
	stream, err := p.client.OpenServerStream(r.Context(), method, message, headers)
	if err != nil {
		slog.Error("gRPC invocation failed", "method", method, "error", err)
		// The upstream's own status rides back in the trailer frame, so the browser
		// sees the NOT_FOUND the API answered rather than a 500 from the proxy.
		code, grpcMessage := grpcStatusOf(err)
		response.end(code, grpcMessage, map[string]string{
			upstreamDurationTrailer: strconv.FormatInt(time.Since(started).Milliseconds(), 10),
		})
		return
	}

	for {
		received, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			slog.Error("gRPC invocation failed", "method", method, "error", err)
			// A stream that fails partway through keeps the messages it already sent:
			// the status says what stopped it, and the frames before it stand.
			code, grpcMessage := grpcStatusOf(err)
			response.end(code, grpcMessage, streamTrailers(stream, started))
			return
		}
		response.message(received)
	}

	response.end(0, "", streamTrailers(stream, started))
}

// streamTrailers is what the call has to say for itself once it is over. This lane is
// a bridge rather than a hop: the same call is forwarded, so what the server answered
// with is the response's own metadata and rides back under its own names, beside the
// one trailer that is Kaja's.
func streamTrailers(stream *pkggrpc.ServerStream, started time.Time) map[string]string {
	trailers := map[string]string{}
	for name, value := range stream.Metadata() {
		trailers[name] = value
	}
	trailers[upstreamDurationTrailer] = strconv.FormatInt(time.Since(started).Milliseconds(), 10)
	return trailers
}

// grpcStatusOf reads the status a gRPC error carries, however deep the client
// wrapped it. An error with no status never left this process, which is what
// UNKNOWN says.
func grpcStatusOf(err error) (int, string) {
	var carrier interface{ GRPCStatus() *status.Status }
	if errors.As(err, &carrier) {
		s := carrier.GRPCStatus()
		return int(s.Code()), s.Message()
	}
	return 2, err.Error()
}

func readGRPCWebMessage(r io.Reader, isText bool) ([]byte, error) {
	if isText {
		data, err := io.ReadAll(r)
		if err != nil {
			return nil, fmt.Errorf("reading text body: %w", err)
		}
		bin, err := base64.StdEncoding.DecodeString(string(data))

		return bin[5:], err
	}
	return io.ReadAll(r)
}

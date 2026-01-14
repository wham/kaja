package grpc

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	pkggrpc "github.com/wham/kaja/v2/pkg/grpc"
)

type Proxy struct {
	client *pkggrpc.Client
}

func NewProxy(target *url.URL) (*Proxy, error) {
	return &Proxy{
		client: pkggrpc.NewClient(target),
	}, nil
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request, method string) {
	// Check if using text format
	isText := strings.HasPrefix(r.Header.Get("Content-Type"), "application/grpc-web-text")

	// Read gRPC-Web message
	var message []byte
	message, err := p.readGRPCWebMessage(r.Body, isText)
	if err != nil {
		slog.Error("Failed to read gRPC-Web request", "error", err)
		http.Error(w, "Failed to read request", http.StatusBadRequest)
		return
	}
	slog.Info("Received message", "length", len(message))

	slog.Info("Invoking gRPC server", "method", method, "tls", p.client.UseTLS())

	res, err := p.client.InvokeWithTimeout(method, message, 5*time.Second)
	if err != nil {
		slog.Error("gRPC invocation failed", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	slog.Info("Received gRPC response", "length", len(res))

	// Build the gRPC-Web data frame:
	// - 1 byte flag (0 for data frame)
	// - 4 byte big-endian uint32 length
	// - followed by the response message bytes
	frame := make([]byte, 5+len(res))
	frame[0] = 0 // flag for data frame
	binary.BigEndian.PutUint32(frame[1:5], uint32(len(res)))
	copy(frame[5:], res)

	// Build the trailers frame containing the gRPC status code.
	// The trailers frame has:
	// - 1 byte flag (0x80 for trailers)
	// - 4 byte big-endian uint32 length
	// - trailers formatted as "key: value\r\n", ending with an extra "\r\n" line.
	trailers := "grpc-status: 0\r\ngrpc-message: \r\n"
	trailersBytes := []byte(trailers)
	trailerFrame := make([]byte, 5+len(trailersBytes))
	trailerFrame[0] = 0x80 // flag for trailer frame
	binary.BigEndian.PutUint32(trailerFrame[1:5], uint32(len(trailersBytes)))
	copy(trailerFrame[5:], trailersBytes)

	// Concatenate data frame and trailer frame to form complete response.
	fullResponse := append(frame, trailerFrame...)

	// Optionally, if sending gRPC-Web text response, base64-encode the fullResponse:
	encodedResponse := base64.StdEncoding.EncodeToString(fullResponse)

	w.Header().Set("Content-Type", "application/grpc-web-text")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(encodedResponse)))
	if _, err := w.Write([]byte(encodedResponse)); err != nil {
		slog.Error("Error writing response", "error", err)
	}
}

func (p *Proxy) readGRPCWebMessage(r io.Reader, isText bool) ([]byte, error) {
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

package grpc

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type grpcWebCodec struct{}

func (c *grpcWebCodec) Marshal(v interface{}) ([]byte, error) {
	// Already bytes
	if b, ok := v.([]byte); ok {
		return b, nil
	}

	return nil, fmt.Errorf("unsupported type: %T", v)
}

func (c *grpcWebCodec) Unmarshal(data []byte, v interface{}) error {
	// Check if v is a pointer to []byte
	if b, ok := v.(*[]byte); ok {
		*b = data
		return nil
	}

	return fmt.Errorf("unsupported type: %T", v)
}

func (c *grpcWebCodec) Name() string {
	return "grpc-web"
}

type Proxy struct {
	target *url.URL
}

func NewProxy(target *url.URL) (*Proxy, error) {
	return &Proxy{target: target}, nil
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

	// Instead of building an HTTP proxy request, use gRPC Go client to send the request.
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	codec := &grpcWebCodec{}

	slog.Info("Dialing gRPC server", "target", p.target.String())

	client, err := grpc.NewClient(":"+p.target.Port(), grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithDefaultCallOptions(grpc.ForceCodec(codec)))

	if err != nil {
		slog.Error("Failed to connect gRPC server", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	defer client.Close()

	res := []byte{}

	err = client.Invoke(ctx, "quirks.v1.Quirks/MethodWithAReallyLongNameGmthggupcbmnphflnnvu", message, &res)

	if err != nil {
		slog.Error("gRPC invocation failed", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	slog.Info("Received gRPC response", "length", len(res))
	w.Header().Set("Content-Type", "application/grpc")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(res)))
	_, _ = io.Copy(w, bytes.NewReader(res))
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

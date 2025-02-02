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
)

// rawMessage wraps raw request/response bytes as a proto.Message.
type rawMessage struct {
	Data []byte
}

func (m *rawMessage) Reset()         { m.Data = nil }
func (m *rawMessage) String() string { return string(m.Data) }
func (m *rawMessage) ProtoMessage()  {}

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

	slog.Info("Dialing gRPC server", "target", p.target.String())
	conn, err := grpc.DialContext(ctx, p.target.String(), grpc.WithInsecure(), grpc.WithBlock())
	if err != nil {
		slog.Error("Failed to dial gRPC server", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	defer conn.Close()

	reqMsg := &rawMessage{Data: message}
	resMsg := &rawMessage{}

	// Use the request URL path as the method name.
	err = conn.Invoke(ctx, "quirks.v1.Quirks/GetAuthentication", reqMsg, resMsg)
	if err != nil {
		slog.Error("gRPC invocation failed", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	slog.Info("Received gRPC response", "length", len(resMsg.Data))
	w.Header().Set("Content-Type", "application/grpc")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(resMsg.Data)))
	_, _ = io.Copy(w, bytes.NewReader(resMsg.Data))
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

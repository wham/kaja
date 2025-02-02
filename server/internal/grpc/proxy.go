package grpc

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"

	"golang.org/x/net/http2"
)

type Proxy struct {
	target *url.URL
	client *http.Client
}

func NewProxy(targetURL string) (*Proxy, error) {
	target, err := url.Parse(targetURL)
	if err != nil {
		return nil, fmt.Errorf("invalid target URL: %w", err)
	}

	transport := &http2.Transport{
		AllowHTTP: true,
		DialTLS: func(network, addr string, _ *tls.Config) (net.Conn, error) {
			return net.Dial(network, addr)
		},
	}

	client := &http.Client{Transport: transport}
	return &Proxy{target: target, client: client}, nil
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Set CORS headers for gRPC-Web
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

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

	// Create gRPC request
	proxyURL := *p.target
	proxyURL.Path = r.URL.Path
	proxyReq, err := http.NewRequest(r.Method, proxyURL.String(), bytes.NewReader(message))
	if err != nil {
		slog.Error("Failed to create proxy request", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Set headers
	proxyReq.Header.Set("Content-Type", "application/grpc")
	proxyReq.Header.Set("Content-Length", fmt.Sprintf("%d", len(message)))
	proxyReq.Header.Set("TE", "trailers")

	// Send request
	resp, err := p.client.Do(proxyReq)
	if err != nil {
		slog.Error("Proxy request failed", "error", err)
		http.Error(w, "Failed to proxy request", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Read response body
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		slog.Error("Failed to read response", "error", err)
		http.Error(w, "Failed to read response", http.StatusInternalServerError)
		return
	}
	slog.Info("Received response", "length", len(respBody), "status", resp.StatusCode)

	// Set response content type based on request format
	if isText {
		w.Header().Set("Content-Type", "application/grpc-web-text+proto")
	} else {
		w.Header().Set("Content-Type", "application/grpc-web+proto")
	}
	w.WriteHeader(resp.StatusCode)

	// Write response body, encoding if needed
	if isText {
		encoder := base64.NewEncoder(base64.StdEncoding, w)
		encoder.Write(respBody)
		encoder.Close()
	} else {
		w.Write(respBody)
	}
}

func (p *Proxy) readGRPCWebMessage(r io.Reader, isText bool) ([]byte, error) {
	if isText {
		data, err := io.ReadAll(r)
		if err != nil {
			return nil, fmt.Errorf("reading text body: %w", err)
		}
		return base64.StdEncoding.DecodeString(string(data))
	}
	return io.ReadAll(r)
}

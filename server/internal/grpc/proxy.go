package grpc

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
)

type Proxy struct {
	target *url.URL
}

func NewProxy(targetURL string) (*Proxy, error) {
	target, err := url.Parse(targetURL)
	if err != nil {
		return nil, fmt.Errorf("invalid target URL: %w", err)
	}
	return &Proxy{target: target}, nil
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

	// Determine if we're handling text format
	isTextFormat := strings.HasPrefix(r.Header.Get("Content-Type"), "application/grpc-web-text")

	// Read gRPC-Web message
	var message []byte
	var err error
	message, err = p.readGRPCWebMessage(r.Body, isTextFormat)
	if err != nil {
		slog.Error("Failed to read gRPC-Web request", "error", err)
		http.Error(w, "Failed to read request", http.StatusBadRequest)
		return
	}

	// Create gRPC request
	proxyURL := *p.target
	proxyURL.Scheme = "http"
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

	// Connect directly using TCP for h2c
	conn, err := net.Dial("tcp", proxyURL.Host)
	if err != nil {
		slog.Error("Failed to connect", "error", err)
		http.Error(w, "Failed to connect", http.StatusBadGateway)
		return
	}
	defer conn.Close()

	// Send HTTP/2 connection preface
	if _, err := conn.Write([]byte("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n")); err != nil {
		slog.Error("Failed to write preface", "error", err)
		return
	}

	// Write the request
	if err := proxyReq.Write(conn); err != nil {
		slog.Error("Failed to write request", "error", err)
		return
	}

	// Read response directly from connection
	reader := bufio.NewReader(conn)
	for {
		frame, err := reader.ReadBytes(0)
		if err == io.EOF {
			break
		}
		if err != nil {
			slog.Error("Failed to read frame", "error", err)
			return
		}

		// Skip empty frames and SETTINGS frames
		if len(frame) == 0 || (len(frame) > 3 && frame[3] == 0x04) {
			continue
		}

		if err := p.writeGRPCWebMessage(w, frame); err != nil {
			slog.Error("Failed to write frame", "error", err)
			return
		}
		w.(http.Flusher).Flush()
	}
}

func (p *Proxy) readGRPCWebMessage(r io.Reader, isTextFormat bool) ([]byte, error) {
	if isTextFormat {
		// For text format, read entire body and decode from base64
		data, err := io.ReadAll(r)
		if err != nil {
			return nil, fmt.Errorf("reading text format body: %w", err)
		}
		decoded, err := base64.StdEncoding.DecodeString(string(data))
		if err != nil {
			return nil, fmt.Errorf("decoding base64: %w", err)
		}
		return decoded, nil
	}

	// Regular binary format
	return p.readGRPCWebBinaryMessage(r)
}

func (p *Proxy) readGRPCWebBinaryMessage(r io.Reader) ([]byte, error) {
	var flag [1]byte
	if _, err := io.ReadFull(r, flag[:]); err != nil {
		return nil, fmt.Errorf("reading flag: %w", err)
	}

	var length [4]byte
	if _, err := io.ReadFull(r, length[:]); err != nil {
		return nil, fmt.Errorf("reading length: %w", err)
	}

	messageLength := binary.BigEndian.Uint32(length[:])
	message := make([]byte, messageLength)
	if _, err := io.ReadFull(r, message); err != nil {
		return nil, fmt.Errorf("reading message: %w", err)
	}

	return message, nil
}

func (p *Proxy) writeGRPCWebMessage(w io.Writer, data []byte) error {
	// Regular binary format
	// Write flag (0 = data frame)
	if _, err := w.Write([]byte{0}); err != nil {
		return err
	}

	// Write length
	length := make([]byte, 4)
	binary.BigEndian.PutUint32(length, uint32(len(data)))
	if _, err := w.Write(length); err != nil {
		return err
	}

	// Write data
	_, err := w.Write(data)
	return err
}

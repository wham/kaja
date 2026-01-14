// Package grpc provides a shared gRPC client for both web and desktop environments.
package grpc

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/url"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// grpcCodec is a gRPC codec that passes through raw bytes without modification.
type grpcCodec struct{}

func (c *grpcCodec) Marshal(v interface{}) ([]byte, error) {
	if b, ok := v.([]byte); ok {
		return b, nil
	}
	return nil, fmt.Errorf("unsupported type: %T", v)
}

func (c *grpcCodec) Unmarshal(data []byte, v interface{}) error {
	if b, ok := v.(*[]byte); ok {
		*b = data
		return nil
	}
	return fmt.Errorf("unsupported type: %T", v)
}

func (c *grpcCodec) Name() string {
	return "proto"
}

// Client is a gRPC client that can invoke methods on a target server.
type Client struct {
	target string
	useTLS bool
}

// ShouldUseTLS determines if TLS should be used based on the target URL.
// TLS is used when:
// - The scheme is "https" or "grpcs"
// - The port is 443 (common convention for TLS)
func ShouldUseTLS(target *url.URL) bool {
	scheme := strings.ToLower(target.Scheme)
	if scheme == "https" || scheme == "grpcs" {
		return true
	}

	// Check if port is 443 (either explicit or from URL parsing)
	port := target.Port()
	if port == "443" {
		return true
	}

	// For dns: scheme, the host might contain the port
	// e.g., dns:kaja.tools:443 parses as Opaque="kaja.tools:443"
	if target.Opaque != "" && strings.HasSuffix(target.Opaque, ":443") {
		return true
	}

	return false
}

// NewClient creates a new gRPC client for the given target URL.
func NewClient(target *url.URL) *Client {
	return &Client{
		target: target.String(),
		useTLS: ShouldUseTLS(target),
	}
}

// NewClientFromString creates a new gRPC client from a target string.
// The target string can be in the form "dns:host:port" or a URL.
func NewClientFromString(target string) (*Client, error) {
	parsed, err := url.Parse(target)
	if err != nil {
		return nil, fmt.Errorf("failed to parse target URL: %w", err)
	}
	return NewClient(parsed), nil
}

// UseTLS returns whether TLS is enabled for this client.
func (c *Client) UseTLS() bool {
	return c.useTLS
}

// Invoke calls a gRPC method on the target server.
// The method should be in the format "/package.Service/Method".
// The request and response are raw protobuf bytes.
func (c *Client) Invoke(ctx context.Context, method string, request []byte) ([]byte, error) {
	// Ensure method has leading slash for gRPC
	if !strings.HasPrefix(method, "/") {
		method = "/" + method
	}

	// Choose transport credentials based on TLS setting
	var creds credentials.TransportCredentials
	if c.useTLS {
		creds = credentials.NewTLS(&tls.Config{})
	} else {
		creds = insecure.NewCredentials()
	}

	codec := &grpcCodec{}
	conn, err := grpc.NewClient(c.target, grpc.WithTransportCredentials(creds), grpc.WithDefaultCallOptions(grpc.ForceCodec(codec)))
	if err != nil {
		return nil, fmt.Errorf("failed to create gRPC client: %w", err)
	}
	defer conn.Close()

	var response []byte
	err = conn.Invoke(ctx, method, request, &response)
	if err != nil {
		return nil, fmt.Errorf("gRPC invocation failed: %w", err)
	}

	return response, nil
}

// InvokeWithTimeout calls a gRPC method with a default timeout.
func (c *Client) InvokeWithTimeout(method string, request []byte, timeout time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return c.Invoke(ctx, method, request)
}

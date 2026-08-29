// Package grpc provides a shared gRPC client for both web and desktop environments.
package grpc

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// connections caches one gRPC client connection per (target, TLS) pair. A
// grpc.ClientConn is safe for concurrent use and manages its own reconnection and idle
// handling, so one long-lived connection is reused instead of dialing per request.
var (
	connectionsMu sync.Mutex
	connections   = map[string]*grpc.ClientConn{}
)

// sharedConnection returns the cached connection for the given target, dialing
// (lazily — grpc.NewClient does not block) and caching one on first use. Two apps
// pointing at one host with different certificates are two connections, so the options
// are part of the key.
func sharedConnection(target string, useTLS bool, options TLSOptions) (*grpc.ClientConn, error) {
	key := target
	if useTLS {
		key = "tls\x00" + options.key() + "\x00" + target
	}

	connectionsMu.Lock()
	defer connectionsMu.Unlock()

	if conn, ok := connections[key]; ok {
		return conn, nil
	}

	creds, err := options.credentials(useTLS)
	if err != nil {
		return nil, err
	}

	conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(creds), grpc.WithDefaultCallOptions(grpc.ForceCodec(&grpcCodec{})))
	if err != nil {
		return nil, fmt.Errorf("failed to create gRPC client: %w", err)
	}

	connections[key] = conn
	return conn, nil
}

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
	target  string
	useTLS  bool
	options TLSOptions
}

// ShouldUseTLS reads the transport off the target URL: an "https" or "grpcs" scheme,
// or port 443.
func ShouldUseTLS(target *url.URL) bool {
	scheme := strings.ToLower(target.Scheme)
	if scheme == "https" || scheme == "grpcs" {
		return true
	}

	port := target.Port()
	if port == "443" {
		return true
	}

	// For the dns: scheme the host may carry the port, e.g. dns:kaja.tools:443 parses as
	// Opaque="kaja.tools:443".
	if target.Opaque != "" && strings.HasSuffix(target.Opaque, ":443") {
		return true
	}

	return false
}

// ToGRPCTarget normalizes a URL to a gRPC target: a dns: target passes through, and
// grpc/grpcs/http/https/bare host:port all become dns:host:port. Whether TLS is used
// is ShouldUseTLS's answer, not this one's.
func ToGRPCTarget(target *url.URL) string {
	scheme := strings.ToLower(target.Scheme)

	if scheme == "dns" {
		return target.String()
	}

	if scheme == "grpc" || scheme == "grpcs" || scheme == "http" || scheme == "https" {
		host := target.Host
		if host == "" {
			host = target.Opaque
		}
		return "dns:" + host
	}

	// Fallback: assume it is already a valid gRPC target.
	return target.String()
}

// NewClient creates a gRPC client for the given target URL. options carry what the
// URL can't say about the connection; the zero value reads the transport off the URL
// and verifies against the system roots.
func NewClient(target *url.URL, options TLSOptions) *Client {
	return &Client{
		target:  ToGRPCTarget(target),
		useTLS:  options.UseTLS(target),
		options: options,
	}
}

// NewClientFromString creates a new gRPC client from a target string.
// The target string can be in the form "dns:host:port" or a URL.
func NewClientFromString(target string, options TLSOptions) (*Client, error) {
	parsed, err := url.Parse(target)
	if err != nil {
		return nil, fmt.Errorf("failed to parse target URL: %w", err)
	}
	return NewClient(parsed, options), nil
}

// UseTLS returns whether TLS is enabled for this client.
func (c *Client) UseTLS() bool {
	return c.useTLS
}

// Invoke calls a gRPC method, named "/package.Service/Method". Request and response
// are raw protobuf bytes; headers are passed as gRPC metadata.
//
// The metadata the server answered with comes back beside the response, on a failed
// call as well as a successful one: a refusal is exactly where a server has something
// to say about why, and a rate limit says it in headers the caller is meant to obey.
func (c *Client) Invoke(ctx context.Context, method string, request []byte, headers map[string]string) ([]byte, map[string]string, error) {
	if !strings.HasPrefix(method, "/") {
		method = "/" + method
	}

	conn, err := sharedConnection(c.target, c.useTLS, c.options)
	if err != nil {
		return nil, nil, err
	}

	if len(headers) > 0 {
		md := metadata.New(headers)
		ctx = metadata.NewOutgoingContext(ctx, md)
	}

	// Both, because which one a value arrives in is not the server's choice: a call
	// answered with a status and no message sends its metadata as trailers alone.
	var header, trailer metadata.MD
	var response []byte
	err = conn.Invoke(ctx, method, request, &response, grpc.Header(&header), grpc.Trailer(&trailer))
	responseMetadata := ResponseMetadata(header, trailer)
	if err != nil {
		return nil, responseMetadata, fmt.Errorf("gRPC invocation failed: %w", err)
	}

	return response, responseMetadata, nil
}

// InvokeWithTimeout calls a gRPC method with a default timeout.
func (c *Client) InvokeWithTimeout(method string, request []byte, timeout time.Duration, headers map[string]string) ([]byte, map[string]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return c.Invoke(ctx, method, request, headers)
}

// Reserved names carry the frame rather than anything the server said: HTTP/2
// pseudo-headers, the status the transport already reports, and the content type the
// codec settled. A -bin name is base64 of arbitrary bytes, which is not a header
// anything downstream can show. The kaja-upstream- prefix is Kaja's own channel back
// to the client, so an upstream may not write into it.
func reservedMetadata(name string) bool {
	switch name {
	case "content-type", "grpc-status", "grpc-message", "grpc-encoding", "grpc-accept-encoding", "trailer":
		return true
	}
	return strings.HasPrefix(name, ":") || strings.HasSuffix(name, "-bin") || strings.HasPrefix(name, "kaja-upstream-")
}

// ResponseMetadata flattens a call's header and trailer metadata into the headers the
// client sees. Names are already lowercase; a name sent more than once is joined the
// way HTTP joins a repeated field, and a trailer restates rather than replaces a
// header of the same name.
func ResponseMetadata(header, trailer metadata.MD) map[string]string {
	flattened := map[string]string{}
	for _, md := range []metadata.MD{header, trailer} {
		for name, values := range md {
			if reservedMetadata(name) || len(values) == 0 {
				continue
			}
			joined := strings.Join(values, ", ")
			if existing, ok := flattened[name]; ok && existing != joined {
				joined = existing + ", " + joined
			}
			flattened[name] = joined
		}
	}
	if len(flattened) == 0 {
		return nil
	}
	return flattened
}

// ServerStream sends a single request and returns a channel that yields response
// messages, closed when the stream ends. Errors are sent on the error channel.
func (c *Client) ServerStream(ctx context.Context, method string, request []byte, headers map[string]string) (<-chan []byte, <-chan error) {
	messages := make(chan []byte, 16)
	errc := make(chan error, 1)

	go func() {
		defer close(messages)
		defer close(errc)

		if !strings.HasPrefix(method, "/") {
			method = "/" + method
		}

		conn, err := sharedConnection(c.target, c.useTLS, c.options)
		if err != nil {
			errc <- err
			return
		}

		if len(headers) > 0 {
			md := metadata.New(headers)
			ctx = metadata.NewOutgoingContext(ctx, md)
		}

		streamDesc := &grpc.StreamDesc{
			ServerStreams: true,
		}

		stream, err := conn.NewStream(ctx, streamDesc, method)
		if err != nil {
			errc <- fmt.Errorf("failed to open stream: %w", err)
			return
		}

		if err := stream.SendMsg(request); err != nil {
			errc <- fmt.Errorf("failed to send request: %w", err)
			return
		}

		if err := stream.CloseSend(); err != nil {
			errc <- fmt.Errorf("failed to close send: %w", err)
			return
		}

		for {
			var response []byte
			err := stream.RecvMsg(&response)
			if err != nil {
				if errors.Is(err, io.EOF) || ctx.Err() != nil {
					return
				}
				errc <- fmt.Errorf("stream receive failed: %w", err)
				return
			}
			select {
			case messages <- response:
			case <-ctx.Done():
				return
			}
		}
	}()

	return messages, errc
}

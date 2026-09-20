// Package grpc provides a shared gRPC client for both web and desktop environments.
package grpc

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strings"
	"sync"
	"time"

	statuspb "google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/grpc"
	// A server that compresses what it sends answers a client that says it can read
	// it, and grpc-go says so for the compressors that are linked in - so without
	// this one a gzip response is a call refused for a reason nobody chose, and with
	// it a big response travels as the server already knows how to send it.
	_ "google.golang.org/grpc/encoding/gzip"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"
)

// connections caches one gRPC client connection per (target, TLS) pair. A
// grpc.ClientConn is safe for concurrent use and manages its own reconnection and idle
// handling, so one long-lived connection is reused instead of dialing per request.
var (
	connectionsMu sync.Mutex
	connections   = map[string]*grpc.ClientConn{}
)

// MaxMessageSize is how big a message kaja will read. grpc-go's own default is four
// megabytes, which is a server's guard against what it is sent rather than a client's
// against what it asked for - and an API answering a listing with more than that is
// an API kaja refused to show rather than one it showed. How big a response is, is
// the API's business; what kaja does with a big one is the console's, which already
// has its own caps.
var MaxMessageSize = grpc.MaxCallRecvMsgSize(math.MaxInt32)

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

	conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(creds), grpc.WithDefaultCallOptions(grpc.ForceCodec(&grpcCodec{}), MaxMessageSize))
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

// Name is empty, and that is what the request's content type is read from: grpc-go
// names the content subtype after the codec, so a codec called "proto" sends
// "application/grpc+proto". The protocol allows it and no stock client sends it, so a
// server that routes on "application/grpc" alone answers it from its HTTP frontend
// instead - a 404 page, which arrives as UNIMPLEMENTED and names neither the call nor
// the reason. Google's endpoints are that server. An empty name leaves the content
// type bare, which is what every other gRPC client on the wire sends.
func (c *grpcCodec) Name() string {
	return ""
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

// StatusDetails is the one -bin trailer that isn't arbitrary bytes: the protocol
// defines it as a google.rpc.Status, and it is where a gRPC API says what was wrong
// with a request beyond the code and the one sentence beside it - which field, which
// quota, how long to wait. So it is read rather than dropped, and what the client is
// shown under the name the server sent is that status as text.
const StatusDetails = "grpc-status-details-bin"

// Reserved names carry the frame rather than anything the server said: HTTP/2
// pseudo-headers, the status the transport already reports, and the content type the
// codec settled. A -bin name is base64 of arbitrary bytes, which is not a header
// anything downstream can show. A kaja-upstream name is Kaja's own channel back to the
// client, so an upstream may not write into it: a duration, an exchange and a failure
// the client reads as this process's are exactly what a server must not be able to
// state.
func reservedMetadata(name string) bool {
	switch name {
	case "content-type", "grpc-status", "grpc-message", "grpc-encoding", "grpc-accept-encoding", "trailer":
		return true
	}
	return strings.HasPrefix(name, ":") || strings.HasSuffix(name, "-bin") || strings.HasPrefix(name, "kaja-upstream")
}

// ResponseMetadata flattens a call's header and trailer metadata into the headers the
// client sees. Names are already lowercase; a name sent more than once is joined the
// way HTTP joins a repeated field, and a trailer restates rather than replaces a
// header of the same name.
func ResponseMetadata(header, trailer metadata.MD) map[string]string {
	flattened := map[string]string{}
	for _, md := range []metadata.MD{header, trailer} {
		for name, values := range md {
			if len(values) == 0 {
				continue
			}
			if name == StatusDetails {
				if details := readStatusDetails(values[0]); details != "" {
					flattened[name] = details
				}
				continue
			}
			if reservedMetadata(name) {
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

// ServerStream is a call whose responses arrive one message at a time. A unary
// method is a stream of one — the frames on the wire are the same either way — so a
// caller that forwards whatever arrives never has to know which kind it is holding.
type ServerStream struct {
	stream grpc.ClientStream
}

// OpenServerStream sends a single request and hands back the stream the responses
// arrive on. The call lives as long as ctx and no longer: how long a stream runs is
// the server's to decide and the caller's to cut short, so there is no deadline of
// this client's own.
func (c *Client) OpenServerStream(ctx context.Context, method string, request []byte, headers map[string]string) (*ServerStream, error) {
	if !strings.HasPrefix(method, "/") {
		method = "/" + method
	}

	conn, err := sharedConnection(c.target, c.useTLS, c.options)
	if err != nil {
		return nil, err
	}

	if len(headers) > 0 {
		ctx = metadata.NewOutgoingContext(ctx, metadata.New(headers))
	}

	stream, err := conn.NewStream(ctx, &grpc.StreamDesc{ServerStreams: true}, method)
	if err != nil {
		return nil, fmt.Errorf("failed to open stream: %w", err)
	}
	if err := stream.SendMsg(request); err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	if err := stream.CloseSend(); err != nil {
		return nil, fmt.Errorf("failed to close send: %w", err)
	}

	return &ServerStream{stream: stream}, nil
}

// Recv returns the next response message, io.EOF once the server has finished.
func (s *ServerStream) Recv() ([]byte, error) {
	var response []byte
	if err := s.stream.RecvMsg(&response); err != nil {
		return nil, err
	}
	return response, nil
}

// Metadata is what the server answered with, header and trailer read as one the way a
// unary call's is. A trailer exists only once the stream has ended, so this is read
// after Recv has reported io.EOF or a failure.
func (s *ServerStream) Metadata() map[string]string {
	header, _ := s.stream.Header()
	return ResponseMetadata(header, s.stream.Trailer())
}

// readStatusDetails renders the status a server attached to a refusal. Each detail
// is one of google.rpc's own messages, so it is read as the type it names; one this
// build doesn't know is left as its type URL rather than taking the rest with it.
func readStatusDetails(raw string) string {
	carried := &statuspb.Status{}
	if err := proto.Unmarshal([]byte(raw), carried); err != nil {
		return ""
	}
	if len(carried.GetDetails()) == 0 {
		return ""
	}

	read := make([]json.RawMessage, 0, len(carried.GetDetails()))
	for _, detail := range carried.GetDetails() {
		read = append(read, readDetail(detail))
	}
	rendered, err := json.Marshal(read)
	if err != nil {
		return ""
	}
	return string(rendered)
}

func readDetail(detail *anypb.Any) json.RawMessage {
	// The Any itself rather than the message inside it, because that is what carries
	// the type beside the fields: which of google.rpc's messages this is, is half of
	// what it says.
	if rendered, err := protojson.Marshal(detail); err == nil {
		return rendered
	}
	rendered, err := json.Marshal(map[string]string{"@type": detail.GetTypeUrl()})
	if err != nil {
		return json.RawMessage("{}")
	}
	return rendered
}

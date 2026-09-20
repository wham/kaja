// Package grpc provides gRPC utilities including reflection support.
package grpc

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	reflectionpb "google.golang.org/grpc/reflection/grpc_reflection_v1"
	reflectionv1alphapb "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

// ReflectionClient queries gRPC servers for their service definitions using reflection.
type ReflectionClient struct {
	target  string
	useTLS  bool
	options TLSOptions
	// metadata sent with the reflection stream. A server that guards reflection
	// wants the same credential the app calls it with.
	metadata map[string]string
}

// ReflectionResult contains the discovered service information.
type ReflectionResult struct {
	FileDescriptors []*descriptorpb.FileDescriptorProto
	Services        []string
	// Version is the reflection API the server answered: "v1" or "v1alpha".
	Version string
}

// NewReflectionClient creates a new reflection client for the given target URL.
// options carry what the URL can't say about the connection; metadata is sent
// with the reflection stream.
func NewReflectionClient(target *url.URL, options TLSOptions, metadata map[string]string) *ReflectionClient {
	return &ReflectionClient{
		target:   ToGRPCTarget(target),
		useTLS:   options.UseTLS(target),
		options:  options,
		metadata: metadata,
	}
}

// NewReflectionClientFromString creates a new reflection client from a target string.
func NewReflectionClientFromString(target string, options TLSOptions, metadata map[string]string) (*ReflectionClient, error) {
	parsed, err := url.Parse(target)
	if err != nil {
		return nil, fmt.Errorf("failed to parse target URL: %w", err)
	}
	return NewReflectionClient(parsed, options, metadata), nil
}

// Target is the gRPC target the client dials, e.g. "dns:seating.kaja.tools:443".
func (c *ReflectionClient) Target() string { return c.target }

// UseTLS reports whether the client dials over TLS.
func (c *ReflectionClient) UseTLS() bool { return c.useTLS }

// reflectionStream abstracts over v1 and v1alpha reflection streams.
type reflectionStream interface {
	sendListServices() error
	sendFileContainingSymbol(symbol string) error
	sendFileByFilename(filename string) error
	recv() (*reflectionpb.ServerReflectionResponse, error)
}

// v1Stream wraps the v1 reflection stream.
type v1Stream struct {
	stream reflectionpb.ServerReflection_ServerReflectionInfoClient
}

func (s *v1Stream) sendListServices() error {
	return s.stream.Send(&reflectionpb.ServerReflectionRequest{
		MessageRequest: &reflectionpb.ServerReflectionRequest_ListServices{ListServices: ""},
	})
}

func (s *v1Stream) sendFileContainingSymbol(symbol string) error {
	return s.stream.Send(&reflectionpb.ServerReflectionRequest{
		MessageRequest: &reflectionpb.ServerReflectionRequest_FileContainingSymbol{FileContainingSymbol: symbol},
	})
}

func (s *v1Stream) sendFileByFilename(filename string) error {
	return s.stream.Send(&reflectionpb.ServerReflectionRequest{
		MessageRequest: &reflectionpb.ServerReflectionRequest_FileByFilename{FileByFilename: filename},
	})
}

func (s *v1Stream) recv() (*reflectionpb.ServerReflectionResponse, error) {
	return s.stream.Recv()
}

// v1alphaStream wraps the v1alpha reflection stream, converting responses to v1 types.
type v1alphaStream struct {
	stream reflectionv1alphapb.ServerReflection_ServerReflectionInfoClient
}

func (s *v1alphaStream) sendListServices() error {
	return s.stream.Send(&reflectionv1alphapb.ServerReflectionRequest{
		MessageRequest: &reflectionv1alphapb.ServerReflectionRequest_ListServices{ListServices: ""},
	})
}

func (s *v1alphaStream) sendFileContainingSymbol(symbol string) error {
	return s.stream.Send(&reflectionv1alphapb.ServerReflectionRequest{
		MessageRequest: &reflectionv1alphapb.ServerReflectionRequest_FileContainingSymbol{FileContainingSymbol: symbol},
	})
}

func (s *v1alphaStream) sendFileByFilename(filename string) error {
	return s.stream.Send(&reflectionv1alphapb.ServerReflectionRequest{
		MessageRequest: &reflectionv1alphapb.ServerReflectionRequest_FileByFilename{FileByFilename: filename},
	})
}

func (s *v1alphaStream) recv() (*reflectionpb.ServerReflectionResponse, error) {
	resp, err := s.stream.Recv()
	if err != nil {
		return nil, err
	}
	// v1alpha and v1 have identical wire format — marshal and unmarshal to convert
	data, err := proto.Marshal(resp)
	if err != nil {
		return nil, err
	}
	v1Resp := &reflectionpb.ServerReflectionResponse{}
	if err := proto.Unmarshal(data, v1Resp); err != nil {
		return nil, err
	}
	return v1Resp, nil
}

// Discover queries the target server's reflection service and returns all file descriptors.
// Tries the v1 reflection API first, falls back to v1alpha for older servers.
func (c *ReflectionClient) Discover(ctx context.Context) (*ReflectionResult, error) {
	creds, err := c.options.credentials(c.useTLS)
	if err != nil {
		return nil, err
	}

	// A surface is one message, and a server with a few hundred protos in it has a
	// surface bigger than grpc-go's default.
	conn, err := grpc.NewClient(c.target, grpc.WithTransportCredentials(creds), grpc.WithDefaultCallOptions(MaxMessageSize))
	if err != nil {
		return nil, fmt.Errorf("failed to create gRPC client for %s (TLS=%v): %w", c.target, c.useTLS, err)
	}
	defer conn.Close()

	if len(c.metadata) > 0 {
		ctx = metadata.NewOutgoingContext(ctx, metadata.New(c.metadata))
	}

	version := "v1"
	stream, v1Err := c.openV1Stream(ctx, conn)
	if v1Err != nil {
		version = "v1alpha"
		stream, err = c.openV1AlphaStream(ctx, conn)
		if err != nil {
			// A server that guards reflection, or refuses the credential it was
			// given, says so on the v1 attempt; the v1alpha failure that follows is
			// the same refusal and would only bury it.
			if code := status.Code(v1Err); code == codes.Unauthenticated || code == codes.PermissionDenied {
				return nil, v1Err
			}
			return nil, fmt.Errorf("reflection not available (tried v1 and v1alpha): v1: %w; v1alpha: %v", v1Err, err)
		}
	}

	result, err := c.discover(stream)
	if err != nil {
		return nil, err
	}
	result.Version = version
	return result, nil
}

func (c *ReflectionClient) openV1Stream(ctx context.Context, conn *grpc.ClientConn) (reflectionStream, error) {
	client := reflectionpb.NewServerReflectionClient(conn)
	stream, err := client.ServerReflectionInfo(ctx)
	if err != nil {
		return nil, err
	}

	// Probe first, to detect Unimplemented before committing to this version.
	if err := stream.Send(&reflectionpb.ServerReflectionRequest{
		MessageRequest: &reflectionpb.ServerReflectionRequest_ListServices{ListServices: ""},
	}); err != nil {
		return nil, err
	}
	if _, err := stream.Recv(); err != nil {
		if s, ok := status.FromError(err); ok && s.Code() == codes.Unimplemented {
			return nil, err
		}
		return nil, err
	}

	// v1 works — open a fresh stream (the probe consumed the first response)
	stream, err = client.ServerReflectionInfo(ctx)
	if err != nil {
		return nil, err
	}
	return &v1Stream{stream: stream}, nil
}

func (c *ReflectionClient) openV1AlphaStream(ctx context.Context, conn *grpc.ClientConn) (reflectionStream, error) {
	client := reflectionv1alphapb.NewServerReflectionClient(conn)
	stream, err := client.ServerReflectionInfo(ctx)
	if err != nil {
		return nil, err
	}
	return &v1alphaStream{stream: stream}, nil
}

func (c *ReflectionClient) discover(stream reflectionStream) (*ReflectionResult, error) {
	if err := stream.sendListServices(); err != nil {
		return nil, fmt.Errorf("failed to send list services request: %w", err)
	}

	resp, err := stream.recv()
	if err != nil {
		return nil, fmt.Errorf("failed to receive list services response: %w", err)
	}

	listResp := resp.GetListServicesResponse()
	if listResp == nil {
		if errResp := resp.GetErrorResponse(); errResp != nil {
			return nil, fmt.Errorf("reflection error: %s", errResp.GetErrorMessage())
		}
		return nil, fmt.Errorf("unexpected response type")
	}

	var services []string
	for _, svc := range listResp.GetService() {
		name := svc.GetName()
		if !strings.HasPrefix(name, "grpc.reflection.") {
			services = append(services, name)
		}
	}

	fileDescriptorMap := make(map[string]*descriptorpb.FileDescriptorProto)
	for _, svcName := range services {
		if err := c.getFileDescriptorsForSymbol(stream, svcName, fileDescriptorMap); err != nil {
			return nil, fmt.Errorf("failed to get file descriptors for %s: %w", svcName, err)
		}
	}

	var fileDescriptors []*descriptorpb.FileDescriptorProto
	for _, fd := range fileDescriptorMap {
		fileDescriptors = append(fileDescriptors, fd)
	}

	return &ReflectionResult{
		FileDescriptors: fileDescriptors,
		Services:        services,
	}, nil
}

// getFileDescriptorsForSymbol retrieves file descriptors for a symbol and its
// dependencies.
func (c *ReflectionClient) getFileDescriptorsForSymbol(
	stream reflectionStream,
	symbol string,
	collected map[string]*descriptorpb.FileDescriptorProto,
) error {
	if err := stream.sendFileContainingSymbol(symbol); err != nil {
		return fmt.Errorf("failed to send file containing symbol request: %w", err)
	}

	resp, err := stream.recv()
	if err != nil {
		return fmt.Errorf("failed to receive file descriptor response: %w", err)
	}

	fdResp := resp.GetFileDescriptorResponse()
	if fdResp == nil {
		if errResp := resp.GetErrorResponse(); errResp != nil {
			return fmt.Errorf("reflection error: %s", errResp.GetErrorMessage())
		}
		return fmt.Errorf("unexpected response type")
	}

	for _, fdBytes := range fdResp.GetFileDescriptorProto() {
		fd := &descriptorpb.FileDescriptorProto{}
		if err := proto.Unmarshal(fdBytes, fd); err != nil {
			return fmt.Errorf("failed to unmarshal file descriptor: %w", err)
		}

		fileName := fd.GetName()
		if _, exists := collected[fileName]; !exists {
			collected[fileName] = fd

			for _, dep := range fd.GetDependency() {
				if _, exists := collected[dep]; !exists {
					err = c.getFileDescriptorByName(stream, dep, collected)
					if err != nil {
						// Some well-known types may not be available; a missing dependency is not fatal.
						continue
					}
				}
			}
		}
	}

	return nil
}

// getFileDescriptorByName retrieves a file descriptor by its filename.
func (c *ReflectionClient) getFileDescriptorByName(
	stream reflectionStream,
	fileName string,
	collected map[string]*descriptorpb.FileDescriptorProto,
) error {
	if err := stream.sendFileByFilename(fileName); err != nil {
		return fmt.Errorf("failed to send file by filename request: %w", err)
	}

	resp, err := stream.recv()
	if err != nil {
		return fmt.Errorf("failed to receive file descriptor response: %w", err)
	}

	fdResp := resp.GetFileDescriptorResponse()
	if fdResp == nil {
		if errResp := resp.GetErrorResponse(); errResp != nil {
			return fmt.Errorf("reflection error: %s", errResp.GetErrorMessage())
		}
		return fmt.Errorf("unexpected response type")
	}

	for _, fdBytes := range fdResp.GetFileDescriptorProto() {
		fd := &descriptorpb.FileDescriptorProto{}
		if err := proto.Unmarshal(fdBytes, fd); err != nil {
			return fmt.Errorf("failed to unmarshal file descriptor: %w", err)
		}

		name := fd.GetName()
		if _, exists := collected[name]; !exists {
			collected[name] = fd

			for _, dep := range fd.GetDependency() {
				if _, exists := collected[dep]; !exists {
					err = c.getFileDescriptorByName(stream, dep, collected)
					if err != nil {
						continue
					}
				}
			}
		}
	}

	return nil
}

// DescriptorSetName is the one file a reflected surface is written to: the
// descriptors the server sent, as it sent them. Compiling those directly is what
// keeps kaja's reading of a server the server's own - printing them back out as
// .proto text was a second parser to keep in step with protoc, and the one this
// replaced turned an edition into a syntax nothing accepts, a proto2 file into a
// proto3 one, an optional field into a oneof of its own, and dropped every option
// it had no line for, deprecation included.
const DescriptorSetName = "reflection.binpb"

// WriteDescriptorSet writes the discovered descriptors into dir as a
// FileDescriptorSet, which is what the compiler reads them back out of.
func WriteDescriptorSet(result *ReflectionResult, dir string) error {
	set := &descriptorpb.FileDescriptorSet{File: result.FileDescriptors}
	encoded, err := proto.Marshal(set)
	if err != nil {
		return fmt.Errorf("encoding the descriptors: %w", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	return os.WriteFile(filepath.Join(dir, DescriptorSetName), encoded, 0o644)
}

// DescriptorSetFiles reads a descriptor set and reports the files to compile from
// it: everything the server declared, which is everything but the well-known types
// its protos import.
func DescriptorSetFiles(path string) ([]string, error) {
	encoded, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	set := &descriptorpb.FileDescriptorSet{}
	if err := proto.Unmarshal(encoded, set); err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}

	var names []string
	for _, file := range set.GetFile() {
		if strings.HasPrefix(file.GetName(), "google/protobuf/") {
			continue
		}
		names = append(names, file.GetName())
	}
	if len(names) == 0 {
		return nil, fmt.Errorf("%s declares no files", path)
	}
	return names, nil
}

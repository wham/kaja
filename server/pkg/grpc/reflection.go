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

	conn, err := grpc.NewClient(c.target, grpc.WithTransportCredentials(creds))
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

// WriteProtoFiles writes the discovered file descriptors as .proto files to a directory.
// Returns the directory path containing the generated files.
func WriteProtoFiles(result *ReflectionResult, outputDir string) error {
	for _, fd := range result.FileDescriptors {
		fileName := fd.GetName()

		// Skip well-known types - they'll be provided by the include dir
		if strings.HasPrefix(fileName, "google/protobuf/") {
			continue
		}

		filePath := filepath.Join(outputDir, fileName)

		if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
			return fmt.Errorf("failed to create directory for %s: %w", fileName, err)
		}

		content := generateProtoFromDescriptor(fd)

		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			return fmt.Errorf("failed to write %s: %w", fileName, err)
		}
	}

	return nil
}

// generateProtoFromDescriptor converts a FileDescriptorProto back to .proto text format.
func generateProtoFromDescriptor(fd *descriptorpb.FileDescriptorProto) string {
	var b strings.Builder

	if fd.GetSyntax() != "" {
		b.WriteString(fmt.Sprintf("syntax = \"%s\";\n\n", fd.GetSyntax()))
	} else {
		b.WriteString("syntax = \"proto3\";\n\n")
	}

	if fd.GetPackage() != "" {
		b.WriteString(fmt.Sprintf("package %s;\n\n", fd.GetPackage()))
	}

	for _, dep := range fd.GetDependency() {
		b.WriteString(fmt.Sprintf("import \"%s\";\n", dep))
	}
	if len(fd.GetDependency()) > 0 {
		b.WriteString("\n")
	}

	if fd.GetOptions() != nil {
		opts := fd.GetOptions()
		if opts.GetGoPackage() != "" {
			b.WriteString(fmt.Sprintf("option go_package = \"%s\";\n\n", opts.GetGoPackage()))
		}
	}

	for _, enum := range fd.GetEnumType() {
		writeEnum(&b, enum, 0)
	}

	for _, msg := range fd.GetMessageType() {
		writeMessage(&b, msg, 0)
	}

	for _, svc := range fd.GetService() {
		writeService(&b, svc)
	}

	return b.String()
}

func writeEnum(b *strings.Builder, enum *descriptorpb.EnumDescriptorProto, indent int) {
	prefix := strings.Repeat("  ", indent)
	b.WriteString(fmt.Sprintf("%senum %s {\n", prefix, enum.GetName()))

	for _, val := range enum.GetValue() {
		b.WriteString(fmt.Sprintf("%s  %s = %d;\n", prefix, val.GetName(), val.GetNumber()))
	}

	b.WriteString(fmt.Sprintf("%s}\n\n", prefix))
}

func writeMessage(b *strings.Builder, msg *descriptorpb.DescriptorProto, indent int) {
	prefix := strings.Repeat("  ", indent)
	b.WriteString(fmt.Sprintf("%smessage %s {\n", prefix, msg.GetName()))

	for _, enum := range msg.GetEnumType() {
		writeEnum(b, enum, indent+1)
	}

	for _, nested := range msg.GetNestedType() {
		// Skip map entry types
		if nested.GetOptions() != nil && nested.GetOptions().GetMapEntry() {
			continue
		}
		writeMessage(b, nested, indent+1)
	}

	oneofFields := make(map[int32][]int) // oneof index -> field indices
	for i, field := range msg.GetField() {
		if field.OneofIndex != nil {
			oneofFields[*field.OneofIndex] = append(oneofFields[*field.OneofIndex], i)
		}
	}

	fieldsInOneof := make(map[int]bool)
	for _, indices := range oneofFields {
		for _, idx := range indices {
			fieldsInOneof[idx] = true
		}
	}

	for i, oneof := range msg.GetOneofDecl() {
		b.WriteString(fmt.Sprintf("%s  oneof %s {\n", prefix, oneof.GetName()))
		for _, fieldIdx := range oneofFields[int32(i)] {
			field := msg.GetField()[fieldIdx]
			writeField(b, field, msg, indent+2)
		}
		b.WriteString(fmt.Sprintf("%s  }\n", prefix))
	}

	for i, field := range msg.GetField() {
		if !fieldsInOneof[i] {
			writeField(b, field, msg, indent+1)
		}
	}

	b.WriteString(fmt.Sprintf("%s}\n\n", prefix))
}

func writeField(b *strings.Builder, field *descriptorpb.FieldDescriptorProto, parent *descriptorpb.DescriptorProto, indent int) {
	prefix := strings.Repeat("  ", indent)

	typeName := getTypeName(field, parent)

	label := ""
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED && !strings.HasPrefix(typeName, "map<") {
		label = "repeated "
	}

	b.WriteString(fmt.Sprintf("%s%s%s %s = %d;\n", prefix, label, typeName, field.GetName(), field.GetNumber()))
}

func getTypeName(field *descriptorpb.FieldDescriptorProto, parent *descriptorpb.DescriptorProto) string {
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED && field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		typeName := field.GetTypeName()
		for _, nested := range parent.GetNestedType() {
			if nested.GetOptions() != nil && nested.GetOptions().GetMapEntry() {
				fullName := "." + parent.GetName() + "." + nested.GetName()
				if strings.HasSuffix(typeName, fullName) || strings.HasSuffix(typeName, "."+nested.GetName()) {
					var keyType, valueType string
					for _, f := range nested.GetField() {
						if f.GetName() == "key" {
							keyType = getScalarTypeName(f.GetType())
						} else if f.GetName() == "value" {
							if f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE || f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM {
								valueType = simplifyTypeName(f.GetTypeName())
							} else {
								valueType = getScalarTypeName(f.GetType())
							}
						}
					}
					return fmt.Sprintf("map<%s, %s>", keyType, valueType)
				}
			}
		}
	}

	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE, descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return simplifyTypeName(field.GetTypeName())
	default:
		return getScalarTypeName(field.GetType())
	}
}

func simplifyTypeName(name string) string {
	if strings.HasPrefix(name, ".") {
		name = name[1:]
	}
	return name
}

func getScalarTypeName(t descriptorpb.FieldDescriptorProto_Type) string {
	switch t {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return "double"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return "float"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return "int64"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		return "uint64"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return "int32"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return "fixed64"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return "fixed32"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "bool"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "string"
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "bytes"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return "uint32"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "sfixed32"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return "sfixed64"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return "sint32"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return "sint64"
	default:
		return "unknown"
	}
}

func writeService(b *strings.Builder, svc *descriptorpb.ServiceDescriptorProto) {
	b.WriteString(fmt.Sprintf("service %s {\n", svc.GetName()))

	for _, method := range svc.GetMethod() {
		inputType := simplifyTypeName(method.GetInputType())
		outputType := simplifyTypeName(method.GetOutputType())

		if method.GetClientStreaming() && method.GetServerStreaming() {
			b.WriteString(fmt.Sprintf("  rpc %s(stream %s) returns (stream %s);\n", method.GetName(), inputType, outputType))
		} else if method.GetClientStreaming() {
			b.WriteString(fmt.Sprintf("  rpc %s(stream %s) returns (%s);\n", method.GetName(), inputType, outputType))
		} else if method.GetServerStreaming() {
			b.WriteString(fmt.Sprintf("  rpc %s(%s) returns (stream %s);\n", method.GetName(), inputType, outputType))
		} else {
			b.WriteString(fmt.Sprintf("  rpc %s(%s) returns (%s);\n", method.GetName(), inputType, outputType))
		}
	}

	b.WriteString("}\n\n")
}

// Package grpc provides gRPC utilities including reflection support.
package grpc

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	reflectionpb "google.golang.org/grpc/reflection/grpc_reflection_v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

// ReflectionClient queries gRPC servers for their service definitions using reflection.
type ReflectionClient struct {
	target string
	useTLS bool
}

// ReflectionResult contains the discovered service information.
type ReflectionResult struct {
	FileDescriptors []*descriptorpb.FileDescriptorProto
	Services        []string
}

// NewReflectionClient creates a new reflection client for the given target URL.
func NewReflectionClient(target *url.URL) *ReflectionClient {
	return &ReflectionClient{
		target: target.String(),
		useTLS: ShouldUseTLS(target),
	}
}

// NewReflectionClientFromString creates a new reflection client from a target string.
func NewReflectionClientFromString(target string) (*ReflectionClient, error) {
	parsed, err := url.Parse(target)
	if err != nil {
		return nil, fmt.Errorf("failed to parse target URL: %w", err)
	}
	return NewReflectionClient(parsed), nil
}

// Discover queries the target server's reflection service and returns all file descriptors.
func (c *ReflectionClient) Discover(ctx context.Context) (*ReflectionResult, error) {
	// Choose transport credentials based on TLS setting
	var creds credentials.TransportCredentials
	if c.useTLS {
		creds = credentials.NewTLS(&tls.Config{})
	} else {
		creds = insecure.NewCredentials()
	}

	conn, err := grpc.NewClient(c.target, grpc.WithTransportCredentials(creds))
	if err != nil {
		return nil, fmt.Errorf("failed to create gRPC client: %w", err)
	}
	defer conn.Close()

	client := reflectionpb.NewServerReflectionClient(conn)

	// Create a bidirectional stream for reflection requests
	stream, err := client.ServerReflectionInfo(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create reflection stream: %w", err)
	}

	// List all services
	err = stream.Send(&reflectionpb.ServerReflectionRequest{
		MessageRequest: &reflectionpb.ServerReflectionRequest_ListServices{
			ListServices: "",
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to send list services request: %w", err)
	}

	resp, err := stream.Recv()
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

	// Collect all service names (excluding reflection service itself)
	var services []string
	for _, svc := range listResp.GetService() {
		name := svc.GetName()
		if !strings.HasPrefix(name, "grpc.reflection.") {
			services = append(services, name)
		}
	}

	// Get file descriptors for all services
	fileDescriptorMap := make(map[string]*descriptorpb.FileDescriptorProto)
	for _, svcName := range services {
		err = c.getFileDescriptorsForSymbol(stream, svcName, fileDescriptorMap)
		if err != nil {
			return nil, fmt.Errorf("failed to get file descriptors for %s: %w", svcName, err)
		}
	}

	// Convert map to slice
	var fileDescriptors []*descriptorpb.FileDescriptorProto
	for _, fd := range fileDescriptorMap {
		fileDescriptors = append(fileDescriptors, fd)
	}

	return &ReflectionResult{
		FileDescriptors: fileDescriptors,
		Services:        services,
	}, nil
}

// getFileDescriptorsForSymbol retrieves file descriptors for a given symbol and its dependencies.
func (c *ReflectionClient) getFileDescriptorsForSymbol(
	stream reflectionpb.ServerReflection_ServerReflectionInfoClient,
	symbol string,
	collected map[string]*descriptorpb.FileDescriptorProto,
) error {
	err := stream.Send(&reflectionpb.ServerReflectionRequest{
		MessageRequest: &reflectionpb.ServerReflectionRequest_FileContainingSymbol{
			FileContainingSymbol: symbol,
		},
	})
	if err != nil {
		return fmt.Errorf("failed to send file containing symbol request: %w", err)
	}

	resp, err := stream.Recv()
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

	// Parse and collect file descriptors
	for _, fdBytes := range fdResp.GetFileDescriptorProto() {
		fd := &descriptorpb.FileDescriptorProto{}
		if err := proto.Unmarshal(fdBytes, fd); err != nil {
			return fmt.Errorf("failed to unmarshal file descriptor: %w", err)
		}

		fileName := fd.GetName()
		if _, exists := collected[fileName]; !exists {
			collected[fileName] = fd

			// Recursively fetch dependencies
			for _, dep := range fd.GetDependency() {
				if _, exists := collected[dep]; !exists {
					err = c.getFileDescriptorByName(stream, dep, collected)
					if err != nil {
						// Log but don't fail - some well-known types may not be available
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
	stream reflectionpb.ServerReflection_ServerReflectionInfoClient,
	fileName string,
	collected map[string]*descriptorpb.FileDescriptorProto,
) error {
	err := stream.Send(&reflectionpb.ServerReflectionRequest{
		MessageRequest: &reflectionpb.ServerReflectionRequest_FileByFilename{
			FileByFilename: fileName,
		},
	})
	if err != nil {
		return fmt.Errorf("failed to send file by filename request: %w", err)
	}

	resp, err := stream.Recv()
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

			// Recursively fetch dependencies
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

// DiscoverWithTimeout calls Discover with a default timeout.
func (c *ReflectionClient) DiscoverWithTimeout(timeout time.Duration) (*ReflectionResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return c.Discover(ctx)
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

		// Create parent directories if needed
		if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
			return fmt.Errorf("failed to create directory for %s: %w", fileName, err)
		}

		// Generate proto file content from descriptor
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

	// Syntax
	if fd.GetSyntax() != "" {
		b.WriteString(fmt.Sprintf("syntax = \"%s\";\n\n", fd.GetSyntax()))
	} else {
		b.WriteString("syntax = \"proto3\";\n\n")
	}

	// Package
	if fd.GetPackage() != "" {
		b.WriteString(fmt.Sprintf("package %s;\n\n", fd.GetPackage()))
	}

	// Imports
	for _, dep := range fd.GetDependency() {
		b.WriteString(fmt.Sprintf("import \"%s\";\n", dep))
	}
	if len(fd.GetDependency()) > 0 {
		b.WriteString("\n")
	}

	// Options
	if fd.GetOptions() != nil {
		opts := fd.GetOptions()
		if opts.GetGoPackage() != "" {
			b.WriteString(fmt.Sprintf("option go_package = \"%s\";\n\n", opts.GetGoPackage()))
		}
	}

	// Enums (top-level)
	for _, enum := range fd.GetEnumType() {
		writeEnum(&b, enum, 0)
	}

	// Messages
	for _, msg := range fd.GetMessageType() {
		writeMessage(&b, msg, 0)
	}

	// Services
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

	// Nested enums
	for _, enum := range msg.GetEnumType() {
		writeEnum(b, enum, indent+1)
	}

	// Nested messages
	for _, nested := range msg.GetNestedType() {
		// Skip map entry types
		if nested.GetOptions() != nil && nested.GetOptions().GetMapEntry() {
			continue
		}
		writeMessage(b, nested, indent+1)
	}

	// Oneofs need to be tracked
	oneofFields := make(map[int32][]int) // oneof index -> field indices
	for i, field := range msg.GetField() {
		if field.OneofIndex != nil {
			oneofFields[*field.OneofIndex] = append(oneofFields[*field.OneofIndex], i)
		}
	}

	// Track which fields are in oneofs
	fieldsInOneof := make(map[int]bool)
	for _, indices := range oneofFields {
		for _, idx := range indices {
			fieldsInOneof[idx] = true
		}
	}

	// Write oneofs
	for i, oneof := range msg.GetOneofDecl() {
		b.WriteString(fmt.Sprintf("%s  oneof %s {\n", prefix, oneof.GetName()))
		for _, fieldIdx := range oneofFields[int32(i)] {
			field := msg.GetField()[fieldIdx]
			writeField(b, field, msg, indent+2)
		}
		b.WriteString(fmt.Sprintf("%s  }\n", prefix))
	}

	// Regular fields
	for i, field := range msg.GetField() {
		if !fieldsInOneof[i] {
			writeField(b, field, msg, indent+1)
		}
	}

	b.WriteString(fmt.Sprintf("%s}\n\n", prefix))
}

func writeField(b *strings.Builder, field *descriptorpb.FieldDescriptorProto, parent *descriptorpb.DescriptorProto, indent int) {
	prefix := strings.Repeat("  ", indent)

	// Check if this is a map field
	typeName := getTypeName(field, parent)

	// Handle labels (repeated, optional)
	label := ""
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED && !strings.HasPrefix(typeName, "map<") {
		label = "repeated "
	}

	b.WriteString(fmt.Sprintf("%s%s%s %s = %d;\n", prefix, label, typeName, field.GetName(), field.GetNumber()))
}

func getTypeName(field *descriptorpb.FieldDescriptorProto, parent *descriptorpb.DescriptorProto) string {
	// Check if this is a map field
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED && field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		typeName := field.GetTypeName()
		// Look for map entry in nested types
		for _, nested := range parent.GetNestedType() {
			if nested.GetOptions() != nil && nested.GetOptions().GetMapEntry() {
				fullName := "." + parent.GetName() + "." + nested.GetName()
				if strings.HasSuffix(typeName, fullName) || strings.HasSuffix(typeName, "."+nested.GetName()) {
					// This is a map
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
	// Remove leading dot and return the type name
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

		// Handle streaming
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

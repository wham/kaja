package grpc

import (
	"strings"
	"testing"

	"google.golang.org/protobuf/types/descriptorpb"
)

func TestGenerateProtoFromDescriptor(t *testing.T) {
	// Create a simple file descriptor
	fd := &descriptorpb.FileDescriptorProto{
		Name:    strPtr("test.proto"),
		Package: strPtr("test"),
		Syntax:  strPtr("proto3"),
		MessageType: []*descriptorpb.DescriptorProto{
			{
				Name: strPtr("TestMessage"),
				Field: []*descriptorpb.FieldDescriptorProto{
					{
						Name:   strPtr("name"),
						Number: int32Ptr(1),
						Type:   typePtr(descriptorpb.FieldDescriptorProto_TYPE_STRING),
						Label:  labelPtr(descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL),
					},
					{
						Name:   strPtr("count"),
						Number: int32Ptr(2),
						Type:   typePtr(descriptorpb.FieldDescriptorProto_TYPE_INT32),
						Label:  labelPtr(descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL),
					},
					{
						Name:   strPtr("tags"),
						Number: int32Ptr(3),
						Type:   typePtr(descriptorpb.FieldDescriptorProto_TYPE_STRING),
						Label:  labelPtr(descriptorpb.FieldDescriptorProto_LABEL_REPEATED),
					},
				},
			},
		},
		Service: []*descriptorpb.ServiceDescriptorProto{
			{
				Name: strPtr("TestService"),
				Method: []*descriptorpb.MethodDescriptorProto{
					{
						Name:       strPtr("GetTest"),
						InputType:  strPtr(".test.TestMessage"),
						OutputType: strPtr(".test.TestMessage"),
					},
				},
			},
		},
	}

	content := generateProtoFromDescriptor(fd)

	// Verify the output contains expected elements
	if !strings.Contains(content, "syntax = \"proto3\"") {
		t.Error("Expected proto3 syntax")
	}
	if !strings.Contains(content, "package test;") {
		t.Error("Expected package test")
	}
	if !strings.Contains(content, "message TestMessage") {
		t.Error("Expected TestMessage")
	}
	if !strings.Contains(content, "string name = 1") {
		t.Error("Expected name field")
	}
	if !strings.Contains(content, "int32 count = 2") {
		t.Error("Expected count field")
	}
	if !strings.Contains(content, "repeated string tags = 3") {
		t.Error("Expected tags field")
	}
	if !strings.Contains(content, "service TestService") {
		t.Error("Expected TestService")
	}
	if !strings.Contains(content, "rpc GetTest(test.TestMessage) returns (test.TestMessage)") {
		t.Error("Expected GetTest method")
	}

	t.Logf("Generated proto:\n%s", content)
}

func TestGenerateProtoWithNestedTypes(t *testing.T) {
	fd := &descriptorpb.FileDescriptorProto{
		Name:    strPtr("nested.proto"),
		Package: strPtr("nested"),
		Syntax:  strPtr("proto3"),
		EnumType: []*descriptorpb.EnumDescriptorProto{
			{
				Name: strPtr("Status"),
				Value: []*descriptorpb.EnumValueDescriptorProto{
					{Name: strPtr("UNKNOWN"), Number: int32Ptr(0)},
					{Name: strPtr("ACTIVE"), Number: int32Ptr(1)},
					{Name: strPtr("INACTIVE"), Number: int32Ptr(2)},
				},
			},
		},
		MessageType: []*descriptorpb.DescriptorProto{
			{
				Name: strPtr("Outer"),
				Field: []*descriptorpb.FieldDescriptorProto{
					{
						Name:     strPtr("status"),
						Number:   int32Ptr(1),
						Type:     typePtr(descriptorpb.FieldDescriptorProto_TYPE_ENUM),
						TypeName: strPtr(".nested.Status"),
						Label:    labelPtr(descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL),
					},
				},
				NestedType: []*descriptorpb.DescriptorProto{
					{
						Name: strPtr("Inner"),
						Field: []*descriptorpb.FieldDescriptorProto{
							{
								Name:   strPtr("value"),
								Number: int32Ptr(1),
								Type:   typePtr(descriptorpb.FieldDescriptorProto_TYPE_STRING),
								Label:  labelPtr(descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL),
							},
						},
					},
				},
			},
		},
	}

	content := generateProtoFromDescriptor(fd)

	if !strings.Contains(content, "enum Status") {
		t.Error("Expected Status enum")
	}
	if !strings.Contains(content, "UNKNOWN = 0") {
		t.Error("Expected UNKNOWN value")
	}
	if !strings.Contains(content, "message Outer") {
		t.Error("Expected Outer message")
	}
	if !strings.Contains(content, "message Inner") {
		t.Error("Expected Inner message")
	}

	t.Logf("Generated proto:\n%s", content)
}

// Helper functions
func strPtr(s string) *string {
	return &s
}

func int32Ptr(i int32) *int32 {
	return &i
}

func typePtr(t descriptorpb.FieldDescriptorProto_Type) *descriptorpb.FieldDescriptorProto_Type {
	return &t
}

func labelPtr(l descriptorpb.FieldDescriptorProto_Label) *descriptorpb.FieldDescriptorProto_Label {
	return &l
}

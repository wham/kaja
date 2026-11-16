package grpc

import (
	"testing"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

// reflected is a discovery result holding one file of a server's own and one
// well-known type its protos import.
func reflected() *ReflectionResult {
	return &ReflectionResult{
		Services: []string{"test.TestService"},
		FileDescriptors: []*descriptorpb.FileDescriptorProto{
			{
				Name:    proto.String("test.proto"),
				Package: proto.String("test"),
				Syntax:  proto.String("proto3"),
				MessageType: []*descriptorpb.DescriptorProto{{
					Name: proto.String("TestMessage"),
					Field: []*descriptorpb.FieldDescriptorProto{{
						Name:   proto.String("name"),
						Number: proto.Int32(1),
						Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
					}},
				}},
				Service: []*descriptorpb.ServiceDescriptorProto{{
					Name: proto.String("TestService"),
					Method: []*descriptorpb.MethodDescriptorProto{{
						Name:       proto.String("GetTest"),
						InputType:  proto.String(".test.TestMessage"),
						OutputType: proto.String(".test.TestMessage"),
					}},
				}},
			},
			{Name: proto.String("google/protobuf/timestamp.proto"), Package: proto.String("google.protobuf"), Syntax: proto.String("proto3")},
		},
	}
}

// TestDeclaredFiles is what the compiler is told to compile out of a reflected
// surface: the server's own files, and not the well-known types they import.
func TestDeclaredFiles(t *testing.T) {
	files, err := reflected().DeclaredFiles()
	if err != nil {
		t.Fatalf("DeclaredFiles: %v", err)
	}
	if len(files) != 1 || files[0] != "test.proto" {
		t.Errorf("files = %v, want the server's own alone", files)
	}
}

// TestDeclaredFilesOfAnEmptySurface is a server that declares nothing of its own,
// which is a compile with nothing to compile rather than one that fails later.
func TestDeclaredFilesOfAnEmptySurface(t *testing.T) {
	if _, err := (&ReflectionResult{}).DeclaredFiles(); err == nil {
		t.Errorf("an empty surface compiled")
	}
}

package grpc

import (
	"os"
	"path/filepath"
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

// TestWriteDescriptorSet is what a reflected surface leaves on disk: the descriptors
// the server sent, in one file, unchanged.
func TestWriteDescriptorSet(t *testing.T) {
	dir := t.TempDir()
	if err := WriteDescriptorSet(reflected(), dir); err != nil {
		t.Fatalf("WriteDescriptorSet: %v", err)
	}

	encoded, err := os.ReadFile(filepath.Join(dir, DescriptorSetName))
	if err != nil {
		t.Fatalf("read the set back: %v", err)
	}
	set := &descriptorpb.FileDescriptorSet{}
	if err := proto.Unmarshal(encoded, set); err != nil {
		t.Fatalf("the set is not a FileDescriptorSet: %v", err)
	}
	if len(set.GetFile()) != 2 {
		t.Errorf("%d files in the set, want both the server sent", len(set.GetFile()))
	}
	if !proto.Equal(set.GetFile()[0], reflected().FileDescriptors[0]) {
		t.Errorf("the file came back changed:\n%v", set.GetFile()[0])
	}
}

// TestDescriptorSetFiles is what the compiler is told to compile out of it: the
// server's own files, and not the well-known types they import.
func TestDescriptorSetFiles(t *testing.T) {
	dir := t.TempDir()
	if err := WriteDescriptorSet(reflected(), dir); err != nil {
		t.Fatalf("WriteDescriptorSet: %v", err)
	}

	files, err := DescriptorSetFiles(filepath.Join(dir, DescriptorSetName))
	if err != nil {
		t.Fatalf("DescriptorSetFiles: %v", err)
	}
	if len(files) != 1 || files[0] != "test.proto" {
		t.Errorf("files = %v, want the server's own alone", files)
	}
}

// TestDescriptorSetFilesOfAnEmptySurface is a server that declares nothing of its
// own, which is a compile with nothing to compile rather than one that fails later.
func TestDescriptorSetFilesOfAnEmptySurface(t *testing.T) {
	dir := t.TempDir()
	if err := WriteDescriptorSet(&ReflectionResult{}, dir); err != nil {
		t.Fatalf("WriteDescriptorSet: %v", err)
	}

	if _, err := DescriptorSetFiles(filepath.Join(dir, DescriptorSetName)); err == nil {
		t.Errorf("an empty set compiled")
	}
}

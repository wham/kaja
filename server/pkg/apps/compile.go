package apps

import (
	"fmt"
	"sort"

	"github.com/wham/protoc-go/protoc"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
)

// Compile compiles the proto files an app wrote into protoDir and links their
// descriptors. The comments are kept and every file is named, because the manifest
// is generated off this result rather than off a second compile.
func Compile(protoDir string, files ...string) (*protoc.Result, *protoregistry.Files, error) {
	// In the order a folder of .proto files is found in, so the manifest reads the
	// same whichever way the surface arrived.
	sort.Strings(files)
	result, err := protoc.New(protoc.WithProtoPaths(protoDir), protoc.WithIncludeImports(), protoc.WithIncludeSourceInfo()).Compile(files...)
	if err != nil {
		return nil, nil, fmt.Errorf("compiling generated proto: %w", err)
	}
	linked, err := protodesc.NewFiles(result.AsFileDescriptorSet())
	if err != nil {
		return nil, nil, fmt.Errorf("building descriptors: %w", err)
	}
	return result, linked, nil
}

// FindService is the service an app generated, looked up in what it compiled.
func FindService(files *protoregistry.Files, name string) (protoreflect.ServiceDescriptor, error) {
	descriptor, err := files.FindDescriptorByName(protoreflect.FullName(name))
	if err != nil {
		return nil, fmt.Errorf("finding service %s: %w", name, err)
	}
	service, ok := descriptor.(protoreflect.ServiceDescriptor)
	if !ok {
		return nil, fmt.Errorf("%s is not a service", name)
	}
	return service, nil
}

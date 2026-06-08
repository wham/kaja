// Package markdown implements the built-in "markdown" app: it exposes a single
// method that appends a line of text to a Markdown file on disk.
//
// The app has one creation parameter, "path", the absolute path to the Markdown
// file. On the sandboxed macOS desktop the file is reached through a
// security-scoped bookmark saved when the user picks it; the append itself is a
// plain file write, the same on every platform.
package markdown

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/protoc-go/protoc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

const serviceTypeName = "markdown.Markdown"

// protoSource is the static proto surface the markdown app renders: a single
// AppendLine method that appends a line of text to the configured file.
const protoSource = `syntax = "proto3";

package markdown;

message AppendLineRequest {
  string text = 1 [json_name = "text"];
}

message AppendLineResponse {}

service Markdown {
  // Append a line of text to the Markdown file.
  rpc AppendLine(AppendLineRequest) returns (AppendLineResponse);
}
`

// App is the markdown app factory. Register it with the apps.Manager.
type App struct{}

func New() *App { return &App{} }

func (a *App) Open(parameters map[string]string, protoDir string, log func(string)) (apps.Instance, error) {
	path := strings.TrimSpace(parameters["path"])
	if path == "" {
		return nil, fmt.Errorf("missing required parameter %q", "path")
	}
	log("Markdown file: " + path)

	if err := os.WriteFile(filepath.Join(protoDir, "markdown.proto"), []byte(protoSource), 0o644); err != nil {
		return nil, fmt.Errorf("writing proto: %w", err)
	}

	input, output, err := compile(protoDir)
	if err != nil {
		return nil, err
	}

	return &instance{path: path, input: input, output: output}, nil
}

// compile compiles the static proto and resolves AppendLine's request and
// response descriptors, used to decode the request and encode the response.
func compile(protoDir string) (protoreflect.MessageDescriptor, protoreflect.MessageDescriptor, error) {
	result, err := protoc.New(protoc.WithProtoPaths(protoDir)).Compile("markdown.proto")
	if err != nil {
		return nil, nil, fmt.Errorf("compiling generated proto: %w", err)
	}
	files, err := protodesc.NewFiles(result.AsFileDescriptorSet())
	if err != nil {
		return nil, nil, fmt.Errorf("building descriptors: %w", err)
	}
	descriptor, err := files.FindDescriptorByName(protoreflect.FullName(serviceTypeName))
	if err != nil {
		return nil, nil, fmt.Errorf("finding service %s: %w", serviceTypeName, err)
	}
	service, ok := descriptor.(protoreflect.ServiceDescriptor)
	if !ok {
		return nil, nil, fmt.Errorf("%s is not a service", serviceTypeName)
	}
	method := service.Methods().ByName("AppendLine")
	if method == nil {
		return nil, nil, fmt.Errorf("method AppendLine missing from compiled descriptors")
	}
	return method.Input(), method.Output(), nil
}

// instance is a live opened markdown app bound to a single file on disk.
type instance struct {
	path   string
	input  protoreflect.MessageDescriptor
	output protoreflect.MessageDescriptor
}

func (in *instance) Invoke(methodPath string, request []byte, headers map[string]string) ([]byte, error) {
	if lastSegment(methodPath) != "AppendLine" {
		return nil, fmt.Errorf("unknown method %q", methodPath)
	}

	reqMsg := dynamicpb.NewMessage(in.input)
	if len(request) > 0 {
		if err := proto.Unmarshal(request, reqMsg); err != nil {
			return nil, fmt.Errorf("decoding request: %w", err)
		}
	}
	text := reqMsg.Get(in.input.Fields().ByName("text")).String()

	if err := appendLine(in.path, text); err != nil {
		return nil, err
	}

	return proto.Marshal(dynamicpb.NewMessage(in.output))
}

// appendLine appends text as a new line to the file, terminated by a newline.
func appendLine(path, text string) error {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("opening %s: %w", path, err)
	}
	defer f.Close()
	if _, err := f.WriteString(text + "\n"); err != nil {
		return fmt.Errorf("writing to %s: %w", path, err)
	}
	return nil
}

func lastSegment(s string) string {
	if i := strings.LastIndex(s, "/"); i >= 0 {
		return s[i+1:]
	}
	return s
}

// Package folder implements the built-in "folder" app: it binds to a folder on
// disk and exposes the essential file operations inside it - list, create, read
// and append.
//
// The app has one creation parameter, "path", the absolute path to the folder.
// On the sandboxed macOS desktop the folder is reached through a security-scoped
// bookmark saved when the user picks it; the operations themselves are plain
// file operations, the same on every platform.
//
// Every method names a file relative to the folder (e.g. "notes.md"), so the
// folder stays the single access boundary. Nothing here knows about file
// formats: content is written and read verbatim.
package folder

import (
	"fmt"
	"io"
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

const serviceTypeName = "folder.Folder"

// protoSource is the static proto surface the folder app renders.
const protoSource = `syntax = "proto3";

package folder;

// Returned by every write method: the file's name relative to the folder and its
// absolute path on disk.
message FileResponse {
  string file = 1 [json_name = "file"];
  string path = 2 [json_name = "path"];
}

message ListFilesRequest {}
message ListFilesResponse {
  repeated string files = 1 [json_name = "files"];
}

message CreateFileRequest {
  // Name of the file relative to the folder, e.g. "notes.md".
  string file = 1 [json_name = "file"];
  // Optional initial content, written verbatim.
  string content = 2 [json_name = "content"];
  // Overwrite the file if it already exists. Otherwise creating an existing file fails.
  bool overwrite = 3 [json_name = "overwrite"];
}

message ReadFileRequest {
  string file = 1 [json_name = "file"];
}
message ReadFileResponse {
  string content = 1 [json_name = "content"];
}

message AppendFileRequest {
  string file = 1 [json_name = "file"];
  // Appended verbatim. The file is created if it does not exist.
  string content = 2 [json_name = "content"];
}

service Folder {
  // List the files in the folder.
  rpc ListFiles(ListFilesRequest) returns (ListFilesResponse);
  // Create a file, optionally with initial content.
  rpc CreateFile(CreateFileRequest) returns (FileResponse);
  // Read a file's contents.
  rpc ReadFile(ReadFileRequest) returns (ReadFileResponse);
  // Append to a file, creating it if it does not exist.
  rpc AppendFile(AppendFileRequest) returns (FileResponse);
}
`

// App is the folder app factory. Register it with the apps.Manager.
type App struct{}

func New() *App { return &App{} }

func (a *App) Open(parameters map[string]string, protoDir string, log func(string)) (*apps.Opened, error) {
	path := strings.TrimSpace(parameters["path"])
	if path == "" {
		return nil, fmt.Errorf("missing required parameter %q", "path")
	}
	path = filepath.Clean(path)
	log("Folder: " + path)

	if err := os.WriteFile(filepath.Join(protoDir, "folder.proto"), []byte(protoSource), 0o644); err != nil {
		return nil, fmt.Errorf("writing proto: %w", err)
	}

	methods, err := compile(protoDir)
	if err != nil {
		return nil, err
	}

	return &apps.Opened{Instance: &instance{folder: path, methods: methods}}, nil
}

// method holds the request and response descriptors of one service method.
type method struct {
	input  protoreflect.MessageDescriptor
	output protoreflect.MessageDescriptor
}

// compile compiles the static proto and resolves every method's request and
// response descriptors, keyed by method name.
func compile(protoDir string) (map[string]method, error) {
	result, err := protoc.New(protoc.WithProtoPaths(protoDir)).Compile("folder.proto")
	if err != nil {
		return nil, fmt.Errorf("compiling generated proto: %w", err)
	}
	files, err := protodesc.NewFiles(result.AsFileDescriptorSet())
	if err != nil {
		return nil, fmt.Errorf("building descriptors: %w", err)
	}
	descriptor, err := files.FindDescriptorByName(protoreflect.FullName(serviceTypeName))
	if err != nil {
		return nil, fmt.Errorf("finding service %s: %w", serviceTypeName, err)
	}
	service, ok := descriptor.(protoreflect.ServiceDescriptor)
	if !ok {
		return nil, fmt.Errorf("%s is not a service", serviceTypeName)
	}
	methods := map[string]method{}
	for i := 0; i < service.Methods().Len(); i++ {
		m := service.Methods().Get(i)
		methods[string(m.Name())] = method{input: m.Input(), output: m.Output()}
	}
	return methods, nil
}

// instance is a live opened folder app bound to a folder on disk.
type instance struct {
	folder  string
	methods map[string]method
}

func (in *instance) Invoke(methodPath string, request []byte, headers map[string]string) (*apps.InvokeResult, error) {
	name := lastSegment(methodPath)
	m, ok := in.methods[name]
	if !ok {
		return nil, fmt.Errorf("unknown method %q", name)
	}

	req := dynamicpb.NewMessage(m.input)
	if len(request) > 0 {
		if err := proto.Unmarshal(request, req); err != nil {
			return nil, fmt.Errorf("decoding request: %w", err)
		}
	}
	resp := dynamicpb.NewMessage(m.output)

	if err := in.dispatch(name, req, resp); err != nil {
		return nil, err
	}
	// The Folder app is local: it makes no upstream call, so it surfaces no
	// upstream headers.
	body, err := proto.Marshal(resp)
	if err != nil {
		return nil, err
	}
	return &apps.InvokeResult{Body: body}, nil
}

func (in *instance) dispatch(name string, req, resp *dynamicpb.Message) error {
	switch name {
	case "ListFiles":
		files, err := in.listFiles()
		if err != nil {
			return err
		}
		setStringList(resp, "files", files)
		return nil

	case "CreateFile":
		file, err := resolve(getString(req, "file"))
		if err != nil {
			return err
		}
		root, err := os.OpenRoot(in.folder)
		if err != nil {
			return fmt.Errorf("opening folder: %w", err)
		}
		defer root.Close()
		if !getBool(req, "overwrite") {
			if _, err := root.Stat(file); err == nil {
				return fmt.Errorf("%s already exists (set overwrite to replace it)", file)
			}
		}
		f, err := root.OpenFile(file, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
		if err != nil {
			return fmt.Errorf("creating %s: %w", file, err)
		}
		if _, err := f.WriteString(getString(req, "content")); err != nil {
			f.Close()
			return fmt.Errorf("writing %s: %w", file, err)
		}
		if err := f.Close(); err != nil {
			return fmt.Errorf("writing %s: %w", file, err)
		}
		return setFileResponse(resp, file, filepath.Join(in.folder, file))

	case "ReadFile":
		file, err := resolve(getString(req, "file"))
		if err != nil {
			return err
		}
		root, err := os.OpenRoot(in.folder)
		if err != nil {
			return fmt.Errorf("opening folder: %w", err)
		}
		defer root.Close()
		f, err := root.Open(file)
		if err != nil {
			return fmt.Errorf("reading file: %w", err)
		}
		defer f.Close()
		data, err := io.ReadAll(f)
		if err != nil {
			return fmt.Errorf("reading file: %w", err)
		}
		setString(resp, "content", string(data))
		return nil

	case "AppendFile":
		file, err := resolve(getString(req, "file"))
		if err != nil {
			return err
		}
		root, err := os.OpenRoot(in.folder)
		if err != nil {
			return fmt.Errorf("opening folder: %w", err)
		}
		defer root.Close()
		f, err := root.OpenFile(file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			return fmt.Errorf("opening %s: %w", file, err)
		}
		defer f.Close()
		if _, err := f.WriteString(getString(req, "content")); err != nil {
			return fmt.Errorf("writing to %s: %w", file, err)
		}
		return setFileResponse(resp, file, filepath.Join(in.folder, file))
	}
	return fmt.Errorf("unhandled method %q", name)
}

// listFiles returns the files at the top level of the folder. Directories are
// left out: the folder is the boundary, and nothing here descends past it.
func (in *instance) listFiles() ([]string, error) {
	entries, err := os.ReadDir(in.folder)
	if err != nil {
		return nil, fmt.Errorf("listing files: %w", err)
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		files = append(files, e.Name())
	}
	return files, nil
}

// resolve validates a requested file name and returns a plain name within the
// folder. Names that contain a path separator or ".." are rejected; together
// with os.Root in the callers this keeps every file operation inside the folder.
func resolve(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("missing file name")
	}
	// filepath.IsLocal rejects absolute paths, "..", and anything that would
	// escape the folder; it is the canonical path-traversal barrier.
	if !filepath.IsLocal(name) || name != filepath.Base(name) {
		return "", fmt.Errorf("file must be a plain name within the folder, got %q", name)
	}
	return name, nil
}

func setFileResponse(resp *dynamicpb.Message, name, path string) error {
	setString(resp, "file", name)
	setString(resp, "path", path)
	return nil
}

func getString(m *dynamicpb.Message, name string) string {
	fd := m.Descriptor().Fields().ByName(protoreflect.Name(name))
	if fd == nil {
		return ""
	}
	return m.Get(fd).String()
}

func getBool(m *dynamicpb.Message, name string) bool {
	fd := m.Descriptor().Fields().ByName(protoreflect.Name(name))
	if fd == nil {
		return false
	}
	return m.Get(fd).Bool()
}

func setString(m *dynamicpb.Message, name, value string) {
	fd := m.Descriptor().Fields().ByName(protoreflect.Name(name))
	if fd == nil {
		return
	}
	m.Set(fd, protoreflect.ValueOfString(value))
}

func setStringList(m *dynamicpb.Message, name string, values []string) {
	fd := m.Descriptor().Fields().ByName(protoreflect.Name(name))
	if fd == nil {
		return
	}
	list := m.NewField(fd).List()
	for _, v := range values {
		list.Append(protoreflect.ValueOfString(v))
	}
	m.Set(fd, protoreflect.ValueOfList(list))
}

func lastSegment(s string) string {
	if i := strings.LastIndex(s, "/"); i >= 0 {
		return s[i+1:]
	}
	return s
}

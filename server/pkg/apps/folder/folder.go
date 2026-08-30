// Package folder implements the built-in "folder" app: it binds to the folder named
// by the "path" creation parameter and exposes list, create, read and append inside
// it. On the sandboxed macOS desktop that folder is reached through a security-scoped
// bookmark saved when the user picks it.
//
// Every method names a path relative to the folder ("team/notes.md"), and every path
// the app reports can be handed straight back to another method. os.Root is the whole
// access boundary, enforced at the syscall level, symlinks included. Nothing here
// knows about file formats: content is written and read verbatim.
package folder

import (
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"slices"
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

// Returned by every write method: the file's path relative to the folder and its
// absolute path on disk.
message FileResponse {
  string file = 1 [json_name = "file"];
  string path = 2 [json_name = "path"];
}

message ListFolderRequest {
  // The folder to list, relative to the app's folder, e.g. "team". Empty lists
  // the app's folder itself.
  string folder = 1 [json_name = "folder"];
  // List the whole tree under the folder rather than its immediate entries only.
  bool recursive = 2 [json_name = "recursive"];
}
message ListFolderResponse {
  // File paths, relative to the app's folder. Pass one to ReadFile or AppendFile as it is.
  repeated string files = 1 [json_name = "files"];
  // Folder paths, in the same form. Pass one back as ListFolderRequest.folder.
  repeated string folders = 2 [json_name = "folders"];
  // The listing stopped at the entry limit. Narrow it with folder.
  bool truncated = 3 [json_name = "truncated"];
}

message CreateFileRequest {
  // Path of the file relative to the folder, e.g. "team/notes.md". Folders that
  // do not exist yet along the way are created.
  string file = 1 [json_name = "file"];
  // Optional initial content, written verbatim.
  string content = 2 [json_name = "content"];
  // Overwrite the file if it already exists. Otherwise creating an existing file fails.
  bool overwrite = 3 [json_name = "overwrite"];
}

message ReadFileRequest {
  // Path of the file relative to the folder, e.g. "team/notes.md".
  string file = 1 [json_name = "file"];
}
message ReadFileResponse {
  string content = 1 [json_name = "content"];
}

message AppendFileRequest {
  // Path of the file relative to the folder, e.g. "team/notes.md". Folders that
  // do not exist yet along the way are created.
  string file = 1 [json_name = "file"];
  // Appended verbatim. The file is created if it does not exist.
  string content = 2 [json_name = "content"];
}

service Folder {
  // List a folder's files and folders. Every path it reports can be passed back
  // to another method as it is.
  rpc ListFolder(ListFolderRequest) returns (ListFolderResponse);
  // Create a file, optionally with initial content.
  rpc CreateFile(CreateFileRequest) returns (FileResponse);
  // Read a file's contents.
  rpc ReadFile(ReadFileRequest) returns (ReadFileResponse);
  // Append to a file, creating it if it does not exist.
  rpc AppendFile(AppendFileRequest) returns (FileResponse);
}
`

// maxEntries bounds one listing. The walk is breadth-first, so a truncated listing
// reports the top of the tree rather than whatever sorted first, and it says so.
const maxEntries = 10000

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

	return &apps.Opened{Instance: &instance{folder: path, methods: methods, limit: maxEntries}}, nil
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
	limit   int
}

func (in *instance) Invoke(ctx context.Context, call *apps.Call) (apps.Stream, error) {
	name := lastSegment(call.Method)
	m, ok := in.methods[name]
	if !ok {
		return nil, fmt.Errorf("unknown method %q", name)
	}

	req := dynamicpb.NewMessage(m.input)
	if len(call.Request) > 0 {
		if err := proto.Unmarshal(call.Request, req); err != nil {
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
	return apps.OneMessage(body, nil), nil
}

func (in *instance) dispatch(name string, req, resp *dynamicpb.Message) error {
	switch name {
	case "ListFolder":
		folder, err := resolveFolder(getString(req, "folder"))
		if err != nil {
			return err
		}
		files, folders, truncated, err := in.listFolder(folder, getBool(req, "recursive"))
		if err != nil {
			return err
		}
		setStringList(resp, "files", files)
		setStringList(resp, "folders", folders)
		setBool(resp, "truncated", truncated)
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
		if info, err := root.Stat(file); err == nil {
			// A folder in the way is reported whatever overwrite says, since
			// overwrite is not what would resolve it.
			if info.IsDir() {
				return fmt.Errorf("%s is a folder, not a file", file)
			}
			if !getBool(req, "overwrite") {
				return fmt.Errorf("%s already exists (set overwrite to replace it)", file)
			}
		}
		if err := makeParents(root, file); err != nil {
			return err
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
		return setFileResponse(resp, file, in.absolute(file))

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
		if info, err := f.Stat(); err == nil && info.IsDir() {
			return fmt.Errorf("%s is a folder, not a file (list it with ListFolder)", file)
		}
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
		if err := makeParents(root, file); err != nil {
			return err
		}
		f, err := root.OpenFile(file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			return fmt.Errorf("opening %s: %w", file, err)
		}
		defer f.Close()
		if _, err := f.WriteString(getString(req, "content")); err != nil {
			return fmt.Errorf("writing to %s: %w", file, err)
		}
		return setFileResponse(resp, file, in.absolute(file))
	}
	return fmt.Errorf("unhandled method %q", name)
}

// listFolder lists one folder, or the whole tree under it. Paths come back relative
// to the app's folder, so anything it reports addresses the same file in any other
// method without being joined to something first.
//
// The walk is breadth-first and stops at in.limit entries. Nothing is filtered on the
// way: a listing that hides what is on disk is worse than one that says where it
// stopped, and folder is how a caller narrows it.
func (in *instance) listFolder(folder string, recursive bool) (files, folders []string, truncated bool, err error) {
	root, err := os.OpenRoot(in.folder)
	if err != nil {
		return nil, nil, false, fmt.Errorf("opening folder: %w", err)
	}
	defer root.Close()

	if folder != "." {
		info, statErr := root.Stat(folder)
		if statErr != nil {
			return nil, nil, false, fmt.Errorf("listing %s: %w", folder, statErr)
		}
		if !info.IsDir() {
			return nil, nil, false, fmt.Errorf("%s is a file, not a folder (read it with ReadFile)", folder)
		}
	}

	for queue := []string{folder}; len(queue) > 0; queue = queue[1:] {
		entries, readErr := readDir(root, queue[0])
		if readErr != nil {
			return nil, nil, false, fmt.Errorf("listing %s: %w", queue[0], readErr)
		}
		for _, e := range entries {
			if len(files)+len(folders) >= in.limit {
				return files, folders, true, nil
			}
			child := childPath(queue[0], e.Name())
			if !e.IsDir() {
				files = append(files, child)
				continue
			}
			folders = append(folders, child)
			if recursive {
				queue = append(queue, child)
			}
		}
	}
	return files, folders, false, nil
}

// readDir reads one folder's entries through the root, holding a listing to the same
// boundary every other operation is. File.ReadDir hands back filesystem order where
// the os.ReadDir this replaced sorted, and a listing that reorders itself between two
// calls is one nothing can be compared against — so the sort is kept.
func readDir(root *os.Root, folder string) ([]os.DirEntry, error) {
	f, err := root.Open(folder)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	entries, err := f.ReadDir(-1)
	if err != nil {
		return nil, err
	}
	slices.SortFunc(entries, func(a, b os.DirEntry) int { return strings.Compare(a.Name(), b.Name()) })
	return entries, nil
}

// childPath joins an entry onto the folder it was read from, keeping the app folder
// itself as the empty prefix rather than a leading "./".
func childPath(folder, name string) string {
	if folder == "." {
		return name
	}
	return folder + "/" + name
}

// clean validates a requested path and returns it relative to the folder,
// slash-separated. A lexical check and not the fence itself: os.Root in the callers
// enforces the boundary at the syscall level, symlinks included.
func clean(noun, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("missing %s name", noun)
	}
	name = path.Clean(filepath.ToSlash(name))
	// filepath.IsLocal rejects absolute paths, "..", and anything that would escape the
	// folder; it is the canonical path-traversal barrier.
	if !filepath.IsLocal(filepath.FromSlash(name)) {
		return "", fmt.Errorf("%s must be a path within the folder, got %q", noun, name)
	}
	return name, nil
}

// resolve is clean for a file. IsLocal admits ".", which is the folder itself and so
// is never a file, so a path that cleans down to it is refused here rather than by
// the open that would otherwise follow.
func resolve(name string) (string, error) {
	file, err := clean("file", name)
	if err != nil {
		return "", err
	}
	if file == "." {
		return "", fmt.Errorf("file must be a path within the folder, got %q", name)
	}
	return file, nil
}

// resolveFolder is clean for a folder, where naming none means the app's own,
// and a path that climbs back down to it is still it.
func resolveFolder(name string) (string, error) {
	if trimmed := strings.TrimSpace(name); trimmed == "" || trimmed == "/" {
		return ".", nil
	}
	return clean("folder", name)
}

// makeParents creates the folders a file's path implies. A path is the only way to
// make a folder here, which is what keeps the app at four methods.
func makeParents(root *os.Root, file string) error {
	parent := path.Dir(file)
	if parent == "." {
		return nil
	}
	if err := root.MkdirAll(parent, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", parent, err)
	}
	return nil
}

// absolute is a resolved path as it reads on disk, for FileResponse.
func (in *instance) absolute(file string) string {
	return filepath.Join(in.folder, filepath.FromSlash(file))
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

func setBool(m *dynamicpb.Message, name string, value bool) {
	fd := m.Descriptor().Fields().ByName(protoreflect.Name(name))
	if fd == nil {
		return
	}
	m.Set(fd, protoreflect.ValueOfBool(value))
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

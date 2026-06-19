// Package markdown implements the built-in "markdown" app: it binds to a folder
// on disk and exposes methods to create and write Markdown files inside it.
//
// The app has one creation parameter, "folder", the absolute path to the folder.
// On the sandboxed macOS desktop the folder is reached through a security-scoped
// bookmark saved when the user picks it; the writes themselves are plain file
// operations, the same on every platform.
//
// Every write method names a file relative to the folder (e.g. "notes.md") and
// auto-creates it if it does not exist, so the folder stays the single access
// boundary. The methods are deliberately semantic - AddHeading, AddBullets,
// AddTasks, AddCodeBlock and friends each render one Markdown construct - with
// AppendMarkdown as a verbatim escape hatch.
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

// protoSource is the static proto surface the markdown app renders.
const protoSource = `syntax = "proto3";

package markdown;

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
  // Name of the file relative to the folder, e.g. "notes.md". ".md" is added if missing.
  string file = 1 [json_name = "file"];
  // Optional: written as a top-level "# title" heading.
  string title = 2 [json_name = "title"];
  // Overwrite the file if it already exists. Otherwise creating an existing file fails.
  bool overwrite = 3 [json_name = "overwrite"];
}

message ReadFileRequest {
  string file = 1 [json_name = "file"];
}
message ReadFileResponse {
  string content = 1 [json_name = "content"];
}

message AddHeadingRequest {
  string file = 1 [json_name = "file"];
  string text = 2 [json_name = "text"];
  // Heading level 1-6. Defaults to 1.
  int32 level = 3 [json_name = "level"];
}

message AddParagraphRequest {
  string file = 1 [json_name = "file"];
  string text = 2 [json_name = "text"];
}

message AddBulletsRequest {
  string file = 1 [json_name = "file"];
  repeated string items = 2 [json_name = "items"];
}

message AddTasksRequest {
  string file = 1 [json_name = "file"];
  repeated string items = 2 [json_name = "items"];
  // Render the tasks as checked ("- [x]") instead of unchecked ("- [ ]").
  bool done = 3 [json_name = "done"];
}

message AddCodeBlockRequest {
  string file = 1 [json_name = "file"];
  string code = 2 [json_name = "code"];
  // Optional language for the fenced code block, e.g. "go".
  string language = 3 [json_name = "language"];
}

message AddQuoteRequest {
  string file = 1 [json_name = "file"];
  string text = 2 [json_name = "text"];
}

message AppendMarkdownRequest {
  string file = 1 [json_name = "file"];
  // Raw Markdown, appended verbatim.
  string markdown = 2 [json_name = "markdown"];
}

service Markdown {
  // List the Markdown files in the folder.
  rpc ListFiles(ListFilesRequest) returns (ListFilesResponse);
  // Create a new Markdown file, optionally seeded with an H1 title.
  rpc CreateFile(CreateFileRequest) returns (FileResponse);
  // Read a file's raw contents.
  rpc ReadFile(ReadFileRequest) returns (ReadFileResponse);
  // Append a heading.
  rpc AddHeading(AddHeadingRequest) returns (FileResponse);
  // Append a paragraph of text.
  rpc AddParagraph(AddParagraphRequest) returns (FileResponse);
  // Append a bulleted list.
  rpc AddBullets(AddBulletsRequest) returns (FileResponse);
  // Append a task (checkbox) list.
  rpc AddTasks(AddTasksRequest) returns (FileResponse);
  // Append a fenced code block.
  rpc AddCodeBlock(AddCodeBlockRequest) returns (FileResponse);
  // Append a block quote.
  rpc AddQuote(AddQuoteRequest) returns (FileResponse);
  // Append raw Markdown verbatim.
  rpc AppendMarkdown(AppendMarkdownRequest) returns (FileResponse);
}
`

// App is the markdown app factory. Register it with the apps.Manager.
type App struct{}

func New() *App { return &App{} }

func (a *App) Open(parameters map[string]string, protoDir string, log func(string)) (apps.Instance, error) {
	folder := strings.TrimSpace(parameters["folder"])
	if folder == "" {
		return nil, fmt.Errorf("missing required parameter %q", "folder")
	}
	folder = filepath.Clean(folder)
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return nil, fmt.Errorf("preparing folder %s: %w", folder, err)
	}
	log("Markdown folder: " + folder)

	if err := os.WriteFile(filepath.Join(protoDir, "markdown.proto"), []byte(protoSource), 0o644); err != nil {
		return nil, fmt.Errorf("writing proto: %w", err)
	}

	methods, err := compile(protoDir)
	if err != nil {
		return nil, err
	}

	return &instance{folder: folder, methods: methods}, nil
}

// method holds the request and response descriptors of one service method.
type method struct {
	input  protoreflect.MessageDescriptor
	output protoreflect.MessageDescriptor
}

// compile compiles the static proto and resolves every method's request and
// response descriptors, keyed by method name.
func compile(protoDir string) (map[string]method, error) {
	result, err := protoc.New(protoc.WithProtoPaths(protoDir)).Compile("markdown.proto")
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

// instance is a live opened markdown app bound to a folder on disk.
type instance struct {
	folder  string
	methods map[string]method
}

func (in *instance) Invoke(methodPath string, request []byte, headers map[string]string) ([]byte, error) {
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
	return proto.Marshal(resp)
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
		path, rel, err := in.resolve(getString(req, "file"))
		if err != nil {
			return err
		}
		if !getBool(req, "overwrite") {
			if _, err := os.Stat(path); err == nil {
				return fmt.Errorf("%s already exists (set overwrite to replace it)", rel)
			}
		}
		var content string
		if title := strings.TrimSpace(getString(req, "title")); title != "" {
			content = "# " + title + "\n"
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return fmt.Errorf("creating folder for %s: %w", rel, err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", rel, err)
		}
		return setFileResponse(resp, rel, path)

	case "ReadFile":
		path, _, err := in.resolve(getString(req, "file"))
		if err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("reading file: %w", err)
		}
		setString(resp, "content", string(data))
		return nil

	case "AddHeading":
		level := int(getInt32(req, "level"))
		if level < 1 {
			level = 1
		} else if level > 6 {
			level = 6
		}
		return in.appendBlock(req, resp, strings.Repeat("#", level)+" "+getString(req, "text"))

	case "AddParagraph":
		return in.appendBlock(req, resp, getString(req, "text"))

	case "AddBullets":
		var lines []string
		for _, item := range getStringList(req, "items") {
			lines = append(lines, "- "+item)
		}
		return in.appendBlock(req, resp, strings.Join(lines, "\n"))

	case "AddTasks":
		marker := "- [ ] "
		if getBool(req, "done") {
			marker = "- [x] "
		}
		var lines []string
		for _, item := range getStringList(req, "items") {
			lines = append(lines, marker+item)
		}
		return in.appendBlock(req, resp, strings.Join(lines, "\n"))

	case "AddCodeBlock":
		block := "```" + strings.TrimSpace(getString(req, "language")) + "\n" + getString(req, "code") + "\n```"
		return in.appendBlock(req, resp, block)

	case "AddQuote":
		var lines []string
		for _, line := range strings.Split(getString(req, "text"), "\n") {
			lines = append(lines, "> "+line)
		}
		return in.appendBlock(req, resp, strings.Join(lines, "\n"))

	case "AppendMarkdown":
		return in.appendBlock(req, resp, getString(req, "markdown"))
	}
	return fmt.Errorf("unhandled method %q", name)
}

// listFiles returns the Markdown files in the folder, relative to it, including
// those in sub-folders.
func (in *instance) listFiles() ([]string, error) {
	var files []string
	err := filepath.WalkDir(in.folder, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(strings.ToLower(d.Name()), ".md") {
			return nil
		}
		rel, err := filepath.Rel(in.folder, path)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("listing files: %w", err)
	}
	return files, nil
}

// resolve turns a requested file name into an absolute path within the folder,
// adding a ".md" suffix when missing and rejecting names that escape the folder.
// It returns the absolute path and the cleaned name relative to the folder.
func (in *instance) resolve(name string) (string, string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", "", fmt.Errorf("missing file name")
	}
	if !strings.HasSuffix(strings.ToLower(name), ".md") {
		name += ".md"
	}
	path := filepath.Clean(filepath.Join(in.folder, filepath.FromSlash(name)))
	// Containment check using strings.HasPrefix is recognized by static analysis
	// as a path-traversal barrier: the resolved path must stay inside the folder.
	if path != in.folder && !strings.HasPrefix(path, in.folder+string(os.PathSeparator)) {
		return "", "", fmt.Errorf("file must be a name within the folder, got %q", name)
	}
	rel, err := filepath.Rel(in.folder, path)
	if err != nil {
		return "", "", fmt.Errorf("file must be a name within the folder, got %q", name)
	}
	return path, filepath.ToSlash(rel), nil
}

// appendBlock resolves the request's "file", appends a Markdown block to it
// (creating the file if missing), and fills the FileResponse.
func (in *instance) appendBlock(req, resp *dynamicpb.Message, block string) error {
	path, rel, err := in.resolve(getString(req, "file"))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating folder for %s: %w", rel, err)
	}

	info, statErr := os.Stat(path)
	nonEmpty := statErr == nil && info.Size() > 0

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("opening %s: %w", rel, err)
	}
	defer f.Close()

	var b strings.Builder
	if nonEmpty {
		// Separate the new block from existing content with a blank line.
		b.WriteString("\n")
	}
	b.WriteString(block)
	if !strings.HasSuffix(block, "\n") {
		b.WriteString("\n")
	}
	if _, err := f.WriteString(b.String()); err != nil {
		return fmt.Errorf("writing to %s: %w", rel, err)
	}
	return setFileResponse(resp, rel, path)
}

func setFileResponse(resp *dynamicpb.Message, rel, path string) error {
	setString(resp, "file", rel)
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

func getInt32(m *dynamicpb.Message, name string) int32 {
	fd := m.Descriptor().Fields().ByName(protoreflect.Name(name))
	if fd == nil {
		return 0
	}
	return int32(m.Get(fd).Int())
}

func getStringList(m *dynamicpb.Message, name string) []string {
	fd := m.Descriptor().Fields().ByName(protoreflect.Name(name))
	if fd == nil {
		return nil
	}
	list := m.Get(fd).List()
	out := make([]string, 0, list.Len())
	for i := 0; i < list.Len(); i++ {
		out = append(out, list.Get(i).String())
	}
	return out
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

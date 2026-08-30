package folder

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/apps"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// open compiles the app bound to a fresh temp folder.
func open(t *testing.T) (*instance, string) {
	t.Helper()
	path := t.TempDir()
	protoDir := t.TempDir()
	opened, err := New().Open(map[string]string{"path": path}, protoDir, func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return opened.Instance.(*instance), path
}

// invoke encodes requestJSON into the method's request, calls it, and returns
// the response decoded back to JSON.
func invoke(t *testing.T, inst *instance, methodName, requestJSON string) string {
	t.Helper()
	result, err := call(inst, methodName, requestJSON)
	if err != nil {
		t.Fatalf("Invoke %q: %v", methodName, err)
	}
	resp := dynamicpb.NewMessage(inst.methods[methodName].output)
	if err := proto.Unmarshal(result, resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	out, err := protojson.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	return string(out)
}

// field calls a method and reads one string field out of its response.
func field(t *testing.T, inst *instance, methodName, requestJSON, name string) string {
	t.Helper()
	body, err := call(inst, methodName, requestJSON)
	if err != nil {
		t.Fatalf("Invoke %q: %v", methodName, err)
	}
	resp := dynamicpb.NewMessage(inst.methods[methodName].output)
	if err := proto.Unmarshal(body, resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return getString(resp, name)
}

// call invokes a method with a JSON request and returns the raw response body.
func call(inst *instance, methodName, requestJSON string) ([]byte, error) {
	m, ok := inst.methods[methodName]
	if !ok {
		return nil, os.ErrNotExist
	}
	req := dynamicpb.NewMessage(m.input)
	if requestJSON != "" {
		if err := protojson.Unmarshal([]byte(requestJSON), req); err != nil {
			return nil, err
		}
	}
	reqBytes, err := proto.Marshal(req)
	if err != nil {
		return nil, err
	}
	stream, err := inst.Invoke(context.Background(), &apps.Call{Method: "folder.Folder/" + methodName, Request: reqBytes})
	if err != nil {
		return nil, err
	}
	return stream.Recv()
}

func TestWriteAndRead(t *testing.T) {
	inst, path := open(t)

	invoke(t, inst, "CreateFile", `{"file": "notes.md", "content": "# My Notes\n"}`)
	invoke(t, inst, "AppendFile", `{"file": "notes.md", "content": "\nSome intro.\n"}`)
	invoke(t, inst, "AppendFile", `{"file": "log.txt", "content": "started\n"}`)

	got, err := os.ReadFile(filepath.Join(path, "notes.md"))
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	want := "# My Notes\n\nSome intro.\n"
	if string(got) != want {
		t.Fatalf("file mismatch\n got: %q\nwant: %q", got, want)
	}

	if read := field(t, inst, "ReadFile", `{"file": "notes.md"}`, "content"); read != want {
		t.Fatalf("ReadFile = %q", read)
	}

	// AppendFile created log.txt, and the listing is not limited to one file type.
	list := invoke(t, inst, "ListFolder", "")
	if !strings.Contains(list, `"log.txt"`) || !strings.Contains(list, `"notes.md"`) {
		t.Fatalf("ListFolder = %s", list)
	}
}

// listing calls ListFolder and returns its files and folders.
func listing(t *testing.T, inst *instance, requestJSON string) (files, folders []string) {
	t.Helper()
	body, err := call(inst, "ListFolder", requestJSON)
	if err != nil {
		t.Fatalf("ListFolder %s: %v", requestJSON, err)
	}
	resp := dynamicpb.NewMessage(inst.methods["ListFolder"].output)
	if err := proto.Unmarshal(body, resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return getStringList(resp, "files"), getStringList(resp, "folders")
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

// A write names the folders it wants, a listing reports them, and every path a
// listing reports reads back without being joined to anything.
func TestSubfolders(t *testing.T) {
	inst, path := open(t)

	invoke(t, inst, "CreateFile", `{"file": "team/tomas.md", "content": "tomas"}`)
	invoke(t, inst, "AppendFile", `{"file": "team/notes/standup.md", "content": "monday"}`)
	invoke(t, inst, "CreateFile", `{"file": "README.md", "content": "root"}`)

	// The path a write names is the path it lands on.
	if got, err := os.ReadFile(filepath.Join(path, "team", "tomas.md")); err != nil || string(got) != "tomas" {
		t.Fatalf("team/tomas.md = %q, %v", got, err)
	}

	// A shallow listing reports the folder without descending into it.
	files, folders := listing(t, inst, "")
	if !slices.Equal(files, []string{"README.md"}) || !slices.Equal(folders, []string{"team"}) {
		t.Fatalf("shallow listing = %v, %v", files, folders)
	}

	// A folder reported by a listing goes back in as it is.
	files, folders = listing(t, inst, `{"folder": "team"}`)
	if !slices.Equal(files, []string{"team/tomas.md"}) || !slices.Equal(folders, []string{"team/notes"}) {
		t.Fatalf("listing of team = %v, %v", files, folders)
	}

	// And so does every file a recursive listing reports.
	files, folders = listing(t, inst, `{"recursive": true}`)
	want := []string{"README.md", "team/tomas.md", "team/notes/standup.md"}
	if !slices.Equal(files, want) {
		t.Fatalf("recursive files = %v, want %v", files, want)
	}
	if !slices.Equal(folders, []string{"team", "team/notes"}) {
		t.Fatalf("recursive folders = %v", folders)
	}
	for _, file := range files {
		if content := field(t, inst, "ReadFile", `{"file": "`+file+`"}`, "content"); content == "" {
			t.Fatalf("ReadFile %q read nothing back", file)
		}
	}
}

// A truncated listing says so, and breadth-first is what makes what it did
// report worth having: the top of the tree, not whatever sorted first.
func TestListFolderTruncated(t *testing.T) {
	inst, path := open(t)
	inst.limit = 4

	for _, name := range []string{"a.md", "b.md"} {
		if err := os.WriteFile(filepath.Join(path, name), []byte("x"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	if err := os.MkdirAll(filepath.Join(path, "deep", "deeper"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	for _, name := range []string{"deep/c.md", "deep/deeper/d.md"} {
		if err := os.WriteFile(filepath.Join(path, filepath.FromSlash(name)), []byte("x"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	body, err := call(inst, "ListFolder", `{"recursive": true}`)
	if err != nil {
		t.Fatalf("ListFolder: %v", err)
	}
	resp := dynamicpb.NewMessage(inst.methods["ListFolder"].output)
	if err := proto.Unmarshal(body, resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !getBool(resp, "truncated") {
		t.Fatal("expected truncated")
	}
	// The four it had room for are the top of the tree, in order, and the fifth
	// (deep/deeper) is what it stopped at.
	files, folders := getStringList(resp, "files"), getStringList(resp, "folders")
	if !slices.Equal(files, []string{"a.md", "b.md", "deep/c.md"}) || !slices.Equal(folders, []string{"deep"}) {
		t.Fatalf("truncated listing = %v, %v", files, folders)
	}

	// Narrowing with folder is the way past the limit.
	if files, _ = listing(t, inst, `{"folder": "deep"}`); !slices.Equal(files, []string{"deep/c.md"}) {
		t.Fatalf("listing of deep = %v", files)
	}
}

// Naming the wrong kind of thing says which method wants it.
func TestWrongKind(t *testing.T) {
	inst, _ := open(t)
	invoke(t, inst, "CreateFile", `{"file": "team/tomas.md", "content": "tomas"}`)

	_, err := call(inst, "ReadFile", `{"file": "team"}`)
	if err == nil || !strings.Contains(err.Error(), "ListFolder") {
		t.Fatalf("ReadFile on a folder = %v", err)
	}
	_, err = call(inst, "ListFolder", `{"folder": "team/tomas.md"}`)
	if err == nil || !strings.Contains(err.Error(), "ReadFile") {
		t.Fatalf("ListFolder on a file = %v", err)
	}
}

func TestCreateFileNoOverwrite(t *testing.T) {
	inst, path := open(t)
	invoke(t, inst, "CreateFile", `{"file": "dup.md", "content": "first"}`)

	if _, err := call(inst, "CreateFile", `{"file": "dup.md"}`); err == nil {
		t.Fatal("expected error creating existing file without overwrite")
	}
	got, err := os.ReadFile(filepath.Join(path, "dup.md"))
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	if string(got) != "first" {
		t.Fatalf("refused create still wrote: %q", got)
	}

	invoke(t, inst, "CreateFile", `{"file": "dup.md", "content": "second", "overwrite": true}`)
	got, err = os.ReadFile(filepath.Join(path, "dup.md"))
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	if string(got) != "second" {
		t.Fatalf("overwrite = %q", got)
	}
}

// A path may descend, and it may not climb out.
func TestRejectsPathTraversal(t *testing.T) {
	inst, _ := open(t)
	for _, name := range []string{"../escape.md", "/etc/passwd", "sub/../../escape.md", "team/../.."} {
		if _, err := call(inst, "AppendFile", `{"file": "`+name+`", "content": "x"}`); err == nil {
			t.Fatalf("expected error appending to %q", name)
		}
		if _, err := call(inst, "ListFolder", `{"folder": "`+name+`"}`); err == nil {
			t.Fatalf("expected error listing %q", name)
		}
	}

	// A path that climbs back down to the folder itself is the folder: listing it
	// is what naming none already does, and it is never a file.
	if _, err := call(inst, "ReadFile", `{"file": "team/.."}`); err == nil {
		t.Fatal("expected error reading the folder itself")
	}
	if files, _ := listing(t, inst, `{"folder": "team/.."}`); len(files) != 0 {
		t.Fatalf("listing of an empty folder = %v", files)
	}
}

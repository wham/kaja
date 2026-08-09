package folder

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
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
	result, err := inst.Invoke("folder.Folder/"+methodName, reqBytes, nil)
	if err != nil {
		return nil, err
	}
	return result.Body, nil
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
	list := invoke(t, inst, "ListFiles", "")
	if !strings.Contains(list, `"log.txt"`) || !strings.Contains(list, `"notes.md"`) {
		t.Fatalf("ListFiles = %s", list)
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

func TestRejectsPathTraversal(t *testing.T) {
	inst, _ := open(t)
	for _, name := range []string{"../escape.md", "sub/notes.md", "/etc/passwd"} {
		if _, err := call(inst, "AppendFile", `{"file": "`+name+`", "content": "x"}`); err == nil {
			t.Fatalf("expected error for %q", name)
		}
	}
}

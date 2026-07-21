package markdown

import (
	"os"
	"path/filepath"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/dynamicpb"
)

// open compiles the app bound to a fresh temp folder.
func open(t *testing.T) (*instance, string) {
	t.Helper()
	folder := t.TempDir()
	protoDir := t.TempDir()
	opened, err := New().Open(map[string]string{"folder": folder}, protoDir, func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return opened.Instance.(*instance), folder
}

// invoke encodes requestJSON into the method's request, calls it, and returns
// the response decoded back to JSON.
func invoke(t *testing.T, inst *instance, methodName, requestJSON string) string {
	t.Helper()
	m, ok := inst.methods[methodName]
	if !ok {
		t.Fatalf("method %q not found", methodName)
	}
	req := dynamicpb.NewMessage(m.input)
	if requestJSON != "" {
		if err := protojson.Unmarshal([]byte(requestJSON), req); err != nil {
			t.Fatalf("build request for %q: %v", methodName, err)
		}
	}
	reqBytes, err := proto.Marshal(req)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	result, err := inst.Invoke("markdown.Markdown/"+methodName, reqBytes, nil)
	if err != nil {
		t.Fatalf("Invoke %q: %v", methodName, err)
	}
	resp := dynamicpb.NewMessage(m.output)
	if err := proto.Unmarshal(result.Body, resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	out, err := protojson.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	return string(out)
}

func TestWriteAndRead(t *testing.T) {
	inst, folder := open(t)

	invoke(t, inst, "CreateFile", `{"file": "notes", "title": "My Notes"}`)
	invoke(t, inst, "AddHeading", `{"file": "notes", "text": "Tasks", "level": 2}`)
	invoke(t, inst, "AddParagraph", `{"file": "notes", "text": "Some intro."}`)
	invoke(t, inst, "AddBullets", `{"file": "notes", "items": ["one", "two"]}`)
	invoke(t, inst, "AddTasks", `{"file": "notes", "items": ["do it"], "done": true}`)
	invoke(t, inst, "AddCodeBlock", `{"file": "notes", "code": "fmt.Println()", "language": "go"}`)
	invoke(t, inst, "AddQuote", `{"file": "notes", "text": "wise words"}`)
	invoke(t, inst, "AppendMarkdown", `{"file": "notes", "markdown": "[link](http://x)"}`)

	got, err := os.ReadFile(filepath.Join(folder, "notes.md"))
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	want := "# My Notes\n" +
		"\n## Tasks\n" +
		"\nSome intro.\n" +
		"\n- one\n- two\n" +
		"\n- [x] do it\n" +
		"\n```go\nfmt.Println()\n```\n" +
		"\n> wise words\n" +
		"\n[link](http://x)\n"
	if string(got) != want {
		t.Fatalf("file mismatch\n got: %q\nwant: %q", got, want)
	}

	read := invoke(t, inst, "ReadFile", `{"file": "notes"}`)
	if read == "" || read == "{}" {
		t.Fatalf("ReadFile returned empty: %q", read)
	}

	list := invoke(t, inst, "ListFiles", "")
	if list != `{"files":["notes.md"]}` {
		t.Fatalf("ListFiles = %s", list)
	}
}

func TestCreateFileNoOverwrite(t *testing.T) {
	inst, _ := open(t)
	invoke(t, inst, "CreateFile", `{"file": "dup.md"}`)

	m := inst.methods["CreateFile"]
	req := dynamicpb.NewMessage(m.input)
	if err := protojson.Unmarshal([]byte(`{"file": "dup.md"}`), req); err != nil {
		t.Fatal(err)
	}
	reqBytes, _ := proto.Marshal(req)
	if _, err := inst.Invoke("markdown.Markdown/CreateFile", reqBytes, nil); err == nil {
		t.Fatal("expected error creating existing file without overwrite")
	}
}

func TestRejectsPathTraversal(t *testing.T) {
	inst, _ := open(t)
	m := inst.methods["AppendMarkdown"]
	req := dynamicpb.NewMessage(m.input)
	if err := protojson.Unmarshal([]byte(`{"file": "../escape.md", "markdown": "x"}`), req); err != nil {
		t.Fatal(err)
	}
	reqBytes, _ := proto.Marshal(req)
	if _, err := inst.Invoke("markdown.Markdown/AppendMarkdown", reqBytes, nil); err == nil {
		t.Fatal("expected error for path traversal")
	}
}

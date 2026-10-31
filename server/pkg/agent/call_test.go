package agent

import (
	"context"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/mcp"
)

// A caller in the process is an agent like any other, so its run lands under the
// name it gives and the window reports back the same way.
func TestACallInTheProcessRunsAsTheNamedClient(t *testing.T) {
	registry := newRegistry()
	stream, err := registry.Attach(token)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	defer stream.Detach()

	session, _ := registry.Session(token)
	clients := make(chan string, 1)
	go func() {
		message := drain(t, stream, "run")
		clients <- message.Client
		session.Result(message.RunID, mcp.RunResult{Console: []string{"[INFO] 2 issues"}})
	}()

	result, err := session.Call(context.Background(), "Siri", "run_script", map[string]any{"code": "kaja.text('hi')"})
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	if result.IsError || !strings.Contains(result.Text, "2 issues") {
		t.Errorf("expected the window's report, got %+v", result)
	}
	if !strings.Contains(string(result.Structured), `"console":["[INFO] 2 issues"]`) {
		t.Errorf("expected the structured report beside the text, got %s", result.Structured)
	}
	if client := <-clients; client != "Siri" {
		t.Errorf("the run was made as %q, want Siri", client)
	}
}

// The write gate is the server's, so a caller in the process is refused the same way.
func TestACallInTheProcessIsRefusedAWrite(t *testing.T) {
	registry := newRegistry()
	session, err := registry.Open(token)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	result, err := session.Call(context.Background(), "Siri", "create_script", map[string]any{"name": "x", "content": "1"})
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	if !result.IsError || !strings.Contains(result.Text, "does not own") {
		t.Errorf("expected the refusal to say why, got %+v", result)
	}
}

func TestAnUnknownToolIsAnError(t *testing.T) {
	session, _ := newRegistry().Open(token)
	if _, err := session.Call(context.Background(), "Siri", "no_such_tool", nil); err == nil {
		t.Error("expected an unknown tool to fail the call")
	}
}

// Ready waits for the window on duty to say what is callable, not merely to attach.
func TestASessionIsReadyOnceTheWindowOnDutyPushesItsCatalog(t *testing.T) {
	registry := newRegistry()
	session, _ := registry.Open(token)
	if session.Ready() {
		t.Fatal("a session with no window is not ready")
	}
	stream, err := registry.Attach(token)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	if session.Ready() {
		t.Fatal("a window that has pushed nothing is not ready")
	}
	session.SetCatalogFrom(stream.ID, mcp.Catalog{})
	if !session.Ready() {
		t.Fatal("expected the session to be ready once the window on duty pushed")
	}
	stream.Detach()
	if session.Ready() {
		t.Error("a session whose window went away is not ready")
	}
}

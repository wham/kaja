package mcp

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// A run that says what it has done turns a silent minute into a live one, and the only
// place a notification fits is a streamed answer - so asking for progress is what makes
// the answer one, whatever the delivery this server was built with.
func TestRunScriptReportsProgress(t *testing.T) {
	bridge := newFakeBridge()
	bridge.onRun = func(progress func(RunProgress)) {
		progress(RunProgress{Calls: 1})
		progress(RunProgress{Calls: 12})
	}
	srv := NewServer(bridge, token, version)

	events := runWithProgress(t, srv, "beat-1")
	notes := progressNotes(t, events)
	if len(notes) != 2 {
		t.Fatalf("progress notifications = %d, want 2", len(notes))
	}
	for _, note := range notes {
		if token, _ := note.Params.ProgressToken.(string); token != "beat-1" {
			t.Errorf("progressToken = %v, want the caller's own", note.Params.ProgressToken)
		}
	}
	if !strings.HasPrefix(notes[0].Params.Message, "1 call ·") {
		t.Errorf("first message = %q, want one call", notes[0].Params.Message)
	}
	if !strings.HasPrefix(notes[1].Params.Message, "12 calls ·") {
		t.Errorf("second message = %q, want twelve calls", notes[1].Params.Message)
	}
	// A notification carries a larger number than the one before it, which is what the
	// value is seconds waited rather than calls made for.
	if notes[1].Params.Progress <= notes[0].Params.Progress {
		t.Errorf("progress did not increase: %v then %v", notes[0].Params.Progress, notes[1].Params.Progress)
	}
	// The answer is last, because a beat describing a run must not be written after it.
	if !strings.Contains(events[len(events)-1], `"result"`) {
		t.Errorf("last event is not the answer: %s", events[len(events)-1])
	}
}

// A caller that asked for no progress is one the window is not asked to beat for, and
// its answer stays the single body a direct delivery answers with.
func TestRunScriptWithoutAProgressTokenSaysNothing(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token, version)

	rec := rawPost(t, srv, "tools/call", map[string]interface{}{
		"name":      "run_script",
		"arguments": map[string]string{"code": "1"},
	}, map[string]string{"Accept": "application/json, text/event-stream"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("content type = %q, want a single body", got)
	}
	if bridge.hadProgress {
		t.Error("the run was asked to beat for a caller that asked for nothing")
	}
}

// A streamed delivery still has nowhere to put a beat when the client takes no stream,
// so the run is told so rather than reporting into a body that has already been framed.
func TestProgressNeedsAStream(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token, version).Streamed()

	call(t, srv, "tools/call", map[string]interface{}{
		"name":      "run_script",
		"arguments": map[string]string{"code": "1"},
		"_meta":     map[string]interface{}{"progressToken": "beat-2"},
	})
	if bridge.hadProgress {
		t.Error("the run was asked to beat into a single body")
	}
}

type progressNote struct {
	Method string `json:"method"`
	Params struct {
		ProgressToken interface{} `json:"progressToken"`
		Progress      float64     `json:"progress"`
		Message       string      `json:"message"`
	} `json:"params"`
}

// runWithProgress runs a snippet asking to hear about it, and hands back the data lines
// of the stream it was answered with.
func runWithProgress(t *testing.T, srv *Server, handle string) []string {
	t.Helper()
	rec := rawPost(t, srv, "tools/call", map[string]interface{}{
		"name":      "run_script",
		"arguments": map[string]string{"code": "1"},
		"_meta":     map[string]interface{}{"progressToken": handle},
	}, map[string]string{"Accept": "application/json, text/event-stream"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("content type = %q, want a stream", got)
	}
	var events []string
	for _, line := range strings.Split(rec.Body.String(), "\n") {
		if data, ok := strings.CutPrefix(line, "data: "); ok {
			events = append(events, data)
		}
	}
	if len(events) == 0 {
		t.Fatalf("no events: %s", rec.Body.String())
	}
	return events
}

func progressNotes(t *testing.T, events []string) []progressNote {
	t.Helper()
	var notes []progressNote
	for _, event := range events {
		var note progressNote
		if json.Unmarshal([]byte(event), &note) != nil || note.Method != "notifications/progress" {
			continue
		}
		notes = append(notes, note)
	}
	return notes
}

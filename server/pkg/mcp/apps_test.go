package mcp

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

// appArguments is an add_app call's arguments as a client sends them: the draft's
// fields nested under parameters rather than flattened to strings.
func appArguments(name string) map[string]interface{} {
	return map[string]interface{}{
		"name":       name,
		"type":       "openapi",
		"parameters": map[string]interface{}{"spec_url": "https://petstore.example/openapi.json", "reflection": true},
		"headers":    map[string]interface{}{"X-Tenant": "acme"},
	}
}

func TestAddAppWritesWhatIsComplete(t *testing.T) {
	bridge := newFakeBridge()
	bridge.inspection = AppInspection{Summary: "Petstore 1.0: 3 operations."}
	bridge.compiled = true
	srv := NewServer(bridge, token, version)

	text := toolText(t, call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": appArguments("Petstore")}))
	if len(bridge.added) != 1 {
		t.Fatalf("added %d apps, want 1", len(bridge.added))
	}
	draft := bridge.added[0]
	if draft.Name != "Petstore" || draft.Type != "openapi" || draft.Parameters["spec_url"] != "https://petstore.example/openapi.json" {
		t.Errorf("draft = %+v", draft)
	}
	// A boolean argument reaches the tool as the string kaja.json would hold.
	if draft.Parameters["reflection"] != "true" {
		t.Errorf("reflection = %q, want \"true\"", draft.Parameters["reflection"])
	}
	if draft.Headers["X-Tenant"] != "acme" {
		t.Errorf("headers = %v", draft.Headers)
	}
	if !strings.Contains(text, "Added Petstore") || !strings.Contains(text, "3 operations") {
		t.Errorf("answer = %q", text)
	}
	if len(bridge.formOpened) != 0 {
		t.Errorf("a complete draft opened a form")
	}
}

func TestAddAppOpensTheFormAndWaitsForIt(t *testing.T) {
	bridge := newFakeBridge()
	bridge.inspection = AppInspection{Summary: "Not probed.", Missing: []string{"A proto folder: the server has no reflection."}}
	bridge.formOutcome = AppFormOutcome{Saved: true, Name: "github"}
	bridge.compiled = true
	srv := NewServer(bridge, token, version)

	text := toolText(t, call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": appArguments("GitHub")}))
	if len(bridge.formOpened) != 1 {
		t.Errorf("forms opened = %d, want 1", len(bridge.formOpened))
	}
	if !strings.Contains(text, "Added github") || !strings.Contains(text, "ListForRepo") {
		t.Errorf("answer = %q", text)
	}
	// The form writes the app, not the tool.
	if len(bridge.added) != 0 {
		t.Errorf("an incomplete draft was written")
	}
}

// A person takes longer than an agent's client will hold a call, so the call hands the
// turn back with the form still open, and the next call of that name picks up what the
// person did with it rather than opening a second form.
func TestAddAppAnswersWhileTheFormIsStillOpen(t *testing.T) {
	defer func(wait time.Duration) { formWait = wait }(formWait)
	formWait = 10 * time.Millisecond
	bridge := newFakeBridge()
	bridge.inspection = AppInspection{Missing: []string{"A credential: the document declares bearer."}}
	bridge.formPending = true
	srv := NewServer(bridge, token, version)

	text := toolText(t, call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": appArguments("GitHub")}))
	for _, want := range []string{"is open in front of the user", "A credential", "without ending your turn", `add_app again with the name "GitHub"`} {
		if !strings.Contains(text, want) {
			t.Errorf("answer lacks %q: %q", want, text)
		}
	}

	// The agent asks again in the same turn, and is told to go on asking.
	text = toolText(t, call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": appArguments("GitHub")}))
	if !strings.Contains(text, "has not finished") || !strings.Contains(text, "without ending your turn") {
		t.Errorf("answer = %q", text)
	}

	bridge.formPending = false
	bridge.formOutcome = AppFormOutcome{Saved: true, Name: "GitHub"}
	bridge.compiled = true
	text = toolText(t, call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": appArguments("GitHub")}))
	if !strings.Contains(text, "Added GitHub") {
		t.Errorf("answer = %q", text)
	}
	if len(bridge.formOpened) != 1 {
		t.Errorf("forms opened = %d, want 1", len(bridge.formOpened))
	}
	if len(bridge.inspected) != 1 {
		t.Errorf("probed %d times, want 1: a form already open answers without a probe", len(bridge.inspected))
	}
}

// Past formPatience the person has likely walked away, so the agent stops asking and
// hands the turn back, and the form still answers whenever they finish it.
func TestAddAppStopsAskingAfterAWhile(t *testing.T) {
	defer func(wait, patience time.Duration) { formWait, formPatience = wait, patience }(formWait, formPatience)
	formWait = 10 * time.Millisecond
	formPatience = 15 * time.Millisecond
	bridge := newFakeBridge()
	bridge.inspection = AppInspection{Missing: []string{"A credential."}}
	bridge.formPending = true
	srv := NewServer(bridge, token, version)

	toolText(t, call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": appArguments("GitHub")}))
	text := toolText(t, call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": appArguments("GitHub")}))
	if !strings.Contains(text, "Stop calling add_app") || !strings.Contains(text, "end your turn") {
		t.Errorf("answer = %q", text)
	}
}

// What the agent read up on reaches the form with the draft, under its own name.
func TestAddAppCarriesHintsToTheForm(t *testing.T) {
	bridge := newFakeBridge()
	bridge.inspection = AppInspection{Missing: []string{"A credential."}}
	bridge.formOutcome = AppFormOutcome{Saved: false}
	srv := NewServer(bridge, token, version)

	arguments := appArguments("GitHub")
	arguments["hints"] = map[string]interface{}{
		"username": map[string]interface{}{"text": "The API key goes here.", "needs_user": true},
		"base_url": "Each tenant has its own.",
		"token":    7,
	}
	call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": arguments})
	if len(bridge.formOpened) != 1 {
		t.Fatalf("forms opened = %d, want 1", len(bridge.formOpened))
	}
	draft := bridge.formOpened[0]
	want := map[string]AppHint{"username": {Text: "The API key goes here.", NeedsUser: true}, "base_url": {Text: "Each tenant has its own."}}
	if !reflect.DeepEqual(draft.Hints, want) {
		t.Errorf("hints = %+v, want %+v", draft.Hints, want)
	}
}

func TestAddAppFormClosed(t *testing.T) {
	bridge := newFakeBridge()
	bridge.inspection = AppInspection{Missing: []string{"A credential."}}
	srv := NewServer(bridge, token, version)

	text := toolText(t, call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": appArguments("GitHub")}))
	if !strings.Contains(text, "without adding GitHub") {
		t.Errorf("answer = %q", text)
	}
}

func TestAddAppFormFailed(t *testing.T) {
	bridge := newFakeBridge()
	bridge.inspection = AppInspection{Missing: []string{"A credential: the document declares bearer."}}
	bridge.formErr = errors.New("no Kaja window is open")
	srv := NewServer(bridge, token, version)

	resp := call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": appArguments("GitHub")})
	result := resp.Result.(map[string]interface{})
	text := contentText(t, result)
	if result["isError"] != true || !strings.Contains(text, "no Kaja window") || !strings.Contains(text, "A credential") {
		t.Errorf("result = %v", result)
	}
}

func TestAddAppRefusesAProblemNoFieldFixes(t *testing.T) {
	bridge := newFakeBridge()
	bridge.inspection = AppInspection{Problem: "petstore.example could not be reached"}
	srv := NewServer(bridge, token, version)

	resp := call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": appArguments("Petstore")})
	result := resp.Result.(map[string]interface{})
	if result["isError"] != true || !strings.Contains(contentText(t, result), "could not be reached") {
		t.Errorf("result = %v", result)
	}
	if len(bridge.added)+len(bridge.formOpened) != 0 {
		t.Errorf("a draft with a problem was acted on")
	}
}

func TestAddAppAbsentWhereTheWorkspaceIsReadOnly(t *testing.T) {
	bridge := newFakeBridge()
	bridge.readOnly = true
	srv := NewServer(bridge, token, version)

	resp := call(t, srv, "tools/list", nil)
	for _, entry := range resp.Result.(map[string]interface{})["tools"].([]interface{}) {
		name := entry.(map[string]interface{})["name"].(string)
		if name == "add_app" {
			t.Errorf("add_app is listed on a read-only workspace")
		}
		if name == "inspect_api" {
			return
		}
	}
	t.Errorf("inspect_api is missing on a read-only workspace")
}

func TestInspectApiReportsWithoutWriting(t *testing.T) {
	bridge := newFakeBridge()
	bridge.inspection = AppInspection{Summary: "Petstore 1.0: 3 operations.", Missing: []string{"A credential: the document declares bearer."}}
	srv := NewServer(bridge, token, version)

	text := toolText(t, call(t, srv, "tools/call", map[string]interface{}{"name": "inspect_api", "arguments": map[string]interface{}{
		"type": "openapi", "parameters": map[string]interface{}{"spec_url": "https://petstore.example/openapi.json"},
	}}))
	for _, want := range []string{"3 operations", "Adding it needs", "A credential"} {
		if !strings.Contains(text, want) {
			t.Errorf("answer lacks %q: %q", want, text)
		}
	}
	if len(bridge.added)+len(bridge.formOpened) != 0 {
		t.Errorf("inspect_api wrote or opened something")
	}
	if bridge.inspected[0].Type != "openapi" || bridge.inspected[0].Name != "" {
		t.Errorf("inspected = %+v", bridge.inspected[0])
	}
}

func contentText(t *testing.T, result map[string]interface{}) string {
	t.Helper()
	raw, err := json.Marshal(result["content"])
	if err != nil {
		t.Fatal(err)
	}
	var content []struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &content); err != nil {
		t.Fatalf("content = %s", raw)
	}
	var text strings.Builder
	for _, block := range content {
		text.WriteString(block.Text)
	}
	return text.String()
}

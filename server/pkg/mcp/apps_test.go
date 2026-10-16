package mcp

import (
	"encoding/json"
	"strings"
	"testing"
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

// withURLElicitation is a modern request from a client that can be asked to open a page.
func withURLElicitation(params map[string]interface{}) map[string]interface{} {
	return withCapabilities(params, map[string]interface{}{"elicitation": map[string]interface{}{"form": map[string]interface{}{}, "url": map[string]interface{}{}}})
}

func withCapabilities(params map[string]interface{}, capabilities map[string]interface{}) map[string]interface{} {
	params = modernParams(params)
	params["_meta"].(map[string]interface{})[metaClientCapabilities] = capabilities
	return params
}

// modernAnswer is a modern result read as it came, without modernResult's own framing
// of the request, which would write the capabilities back out of _meta.
func modernAnswer(t *testing.T, srv *Server, params map[string]interface{}) map[string]interface{} {
	t.Helper()
	resp := call(t, srv, "tools/call", params)
	if resp.Error != nil {
		t.Fatalf("tools/call: %+v", resp.Error)
	}
	return resp.Result.(map[string]interface{})
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

func TestAddAppAsksToOpenTheFormWhereTheClientCan(t *testing.T) {
	bridge := newFakeBridge()
	bridge.inspection = AppInspection{Summary: "Petstore did not hand over its document.", Missing: []string{"A credential: the document declares bearer (HTTP bearer)."}}
	srv := NewServer(bridge, token, version)

	params := withURLElicitation(map[string]interface{}{"name": "add_app", "arguments": appArguments("Petstore")})
	result := modernAnswer(t, srv, params)
	if result["resultType"] != "input_required" {
		t.Fatalf("resultType = %v, want input_required: %v", result["resultType"], result)
	}
	if result["requestState"] != "form-1" {
		t.Errorf("requestState = %v", result["requestState"])
	}
	requests := result["inputRequests"].(map[string]interface{})
	request := requests[appFormKey].(map[string]interface{})
	if request["method"] != "elicitation/create" {
		t.Errorf("method = %v", request["method"])
	}
	elicitation := request["params"].(map[string]interface{})
	if elicitation["mode"] != "url" || !strings.HasPrefix(elicitation["url"].(string), "kaja://add-app?") {
		t.Errorf("params = %v", elicitation)
	}
	if message, _ := elicitation["message"].(string); !strings.Contains(message, "A credential") {
		t.Errorf("message = %q", message)
	}
	if len(bridge.added) != 0 {
		t.Errorf("an incomplete draft was written")
	}
	if len(bridge.dropped) != 0 {
		t.Errorf("the form the client is about to open was dropped")
	}
}

func TestAddAppRetryWaitsForTheForm(t *testing.T) {
	bridge := newFakeBridge()
	bridge.formOutcome = AppFormOutcome{Saved: true, Name: "theatre"}
	bridge.compiled = true
	srv := NewServer(bridge, token, version)

	params := withURLElicitation(map[string]interface{}{
		"name":           "add_app",
		"arguments":      appArguments("Petstore"),
		"inputResponses": map[string]interface{}{appFormKey: map[string]interface{}{"action": "accept"}},
		"requestState":   "form-1",
	})
	result := modernAnswer(t, srv, params)
	if result["resultType"] != "complete" {
		t.Fatalf("resultType = %v", result["resultType"])
	}
	text := contentText(t, result)
	if !strings.Contains(text, "Added theatre") || !strings.Contains(text, "ListShows") {
		t.Errorf("answer = %q", text)
	}
	if len(bridge.awaited) != 1 || bridge.awaited[0] != "form-1" {
		t.Errorf("awaited = %v", bridge.awaited)
	}
	// The retry carries the draft again, but it is the form that was written.
	if len(bridge.inspected) != 0 || len(bridge.added) != 0 {
		t.Errorf("the retry probed or wrote: %v %v", bridge.inspected, bridge.added)
	}
}

func TestAddAppRetryDeclined(t *testing.T) {
	bridge := newFakeBridge()
	srv := NewServer(bridge, token, version)

	params := withURLElicitation(map[string]interface{}{
		"name":           "add_app",
		"arguments":      appArguments("Petstore"),
		"inputResponses": map[string]interface{}{appFormKey: map[string]interface{}{"action": "decline"}},
		"requestState":   "form-1",
	})
	text := contentText(t, modernAnswer(t, srv, params))
	if !strings.Contains(text, "declined") {
		t.Errorf("answer = %q", text)
	}
	if len(bridge.dropped) != 1 || bridge.dropped[0] != "form-1" {
		t.Errorf("dropped = %v", bridge.dropped)
	}
	if len(bridge.awaited) != 0 {
		t.Errorf("waited on a form nobody opened")
	}
}

func TestAddAppSaysWhatIsMissingWhereTheClientCannotOpenAPage(t *testing.T) {
	bridge := newFakeBridge()
	bridge.inspection = AppInspection{Summary: "Not probed.", Missing: []string{"A proto folder: the server has no reflection."}}
	srv := NewServer(bridge, token, version)

	// A handshake-era client, which declares nothing per request.
	text := toolText(t, call(t, srv, "tools/call", map[string]interface{}{"name": "add_app", "arguments": appArguments("Seats")}))
	for _, want := range []string{"was not added yet", "A proto folder", "kaja://add-app?"} {
		if !strings.Contains(text, want) {
			t.Errorf("answer lacks %q: %q", want, text)
		}
	}
	if len(bridge.dropped) != 1 {
		t.Errorf("a form nothing waits on was kept: %v", bridge.dropped)
	}
	if len(bridge.added) != 0 {
		t.Errorf("an incomplete draft was written")
	}

	// So is a modern client with form mode alone.
	params := withCapabilities(map[string]interface{}{"name": "add_app", "arguments": appArguments("Seats")}, map[string]interface{}{"elicitation": map[string]interface{}{}})
	result := modernAnswer(t, srv, params)
	if result["resultType"] != "complete" {
		t.Errorf("form-only client was asked for input: %v", result)
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

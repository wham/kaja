package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"testing"
)

func browserHeader(t *testing.T, workspace string, values map[string]string) string {
	t.Helper()
	held := map[string]*string{}
	for name, value := range values {
		held[name] = &value
	}
	payload, err := json.Marshal(browserValuesJSON{Workspace: workspace, Values: held})
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(payload)
}

// A served kaja has no store of its own, so a value the browser brought resolves for
// that request and no other.
func TestBrowserValuesResolveForTheirRequest(t *testing.T) {
	path := writeWorkspace(t, `{"id": "w1", "variables": {"TOKEN": "${secret}"}}`)
	service := NewApiService(path, true, "", "", nil)
	defer service.Close()

	ctx := WithBrowserValues(context.Background(), ReadBrowserValues(browserHeader(t, "w1", map[string]string{"TOKEN": "from-the-browser"})))
	if got := service.variables(ctx).Expand("${TOKEN}"); got != "from-the-browser" {
		t.Errorf("TOKEN = %q, want the browser's value", got)
	}
	if !service.workspaceResponse(ctx).Runtime.VariableStoreAvailable {
		t.Error("expected a browser bringing its values to be a store")
	}
	if got := service.Variables().Expand("${TOKEN}"); got != "${TOKEN}" {
		t.Errorf("TOKEN = %q without the browser, want the reference left", got)
	}
}

// Values kept for another workspace are not this one's.
func TestBrowserValuesOfAnotherWorkspaceAreNotRead(t *testing.T) {
	path := writeWorkspace(t, `{"id": "w1", "variables": {"TOKEN": "${secret}"}}`)
	service := NewApiService(path, true, "", "", nil)
	defer service.Close()

	ctx := WithBrowserValues(context.Background(), ReadBrowserValues(browserHeader(t, "other", map[string]string{"TOKEN": "x"})))
	if got := service.variables(ctx).Expand("${TOKEN}"); got != "${TOKEN}" {
		t.Errorf("TOKEN = %q, want the reference left", got)
	}
}

// A desktop's values are the keychain's, whatever a request brings.
func TestBrowserValuesAreIgnoredBesideAMachineStore(t *testing.T) {
	path := writeWorkspace(t, `{"id": "w1", "variables": {"TOKEN": "${secret}"}}`)
	store := &fakeStore{available: true, values: map[string]string{"w1#TOKEN": "from-the-keychain"}}
	service := NewApiService(path, true, "", "", store)
	defer service.Close()

	ctx := WithBrowserValues(context.Background(), ReadBrowserValues(browserHeader(t, "w1", map[string]string{"TOKEN": "from-the-browser"})))
	if got := service.variables(ctx).Expand("${TOKEN}"); got != "from-the-keychain" {
		t.Errorf("TOKEN = %q, want the keychain's value", got)
	}
}

// Storing a value writes it to the browser's store, which hands it back with the
// workspace's id - given one by the write, since it had none.
func TestStoringAValueWritesItBackToTheBrowser(t *testing.T) {
	path := writeWorkspace(t, `{"variables": {"TOKEN": "${secret}"}}`)
	service := NewApiService(path, true, "", "", nil)
	defer service.Close()

	values := ReadBrowserValues(browserHeader(t, "", nil))
	ctx := WithBrowserValues(context.Background(), values)
	response, err := service.SetStoredValue(ctx, &SetStoredValueRequest{Name: "TOKEN", Value: "typed"})
	if err != nil {
		t.Fatalf("SetStoredValue: %v", err)
	}
	if got := statusFor(t, &Resolver{statuses: response.VariableStatus}, "TOKEN"); got.Source != VariableSource_VARIABLE_SOURCE_KEYCHAIN {
		t.Errorf("status = %v, want the value stored", got)
	}

	var written browserValuesJSON
	if err := json.Unmarshal([]byte(values.Written()), &written); err != nil {
		t.Fatalf("Written: %v", err)
	}
	id := service.snapshot().workspace.GetId()
	if id == "" || written.Workspace != id {
		t.Errorf("written under %q, want the workspace's id %q", written.Workspace, id)
	}
	if value := written.Values["TOKEN"]; value == nil || *value != "typed" {
		t.Errorf("written = %v", written.Values)
	}

	if _, err := service.ClearStoredValue(ctx, &ClearStoredValueRequest{Name: "TOKEN"}); err != nil {
		t.Fatalf("ClearStoredValue: %v", err)
	}
	if err := json.Unmarshal([]byte(values.Written()), &written); err != nil {
		t.Fatalf("Written: %v", err)
	}
	if value, ok := written.Values["TOKEN"]; !ok || value != nil {
		t.Errorf("written = %v, want TOKEN deleted", written.Values)
	}
}

// A sign-in lands in the browser's store when it is the request's.
func TestASignInIsKeptInTheBrowser(t *testing.T) {
	path := writeWorkspace(t, `{"id": "w1", "variables": {"GITHUB": "${signin}"}}`)
	service := NewApiService(path, true, "", "", nil)
	defer service.Close()

	values := ReadBrowserValues(browserHeader(t, "w1", nil))
	ctx := WithBrowserValues(context.Background(), values)
	held := `{"resource":"https://api.github.com","server":{"issuer":"https://github.com/login/oauth"},"token":{"access_token":"gho_token"}}`
	if err := (signInStore{service: service}).Save(ctx, "GITHUB", held); err != nil {
		t.Fatalf("Save: %v", err)
	}
	token, err := service.authorizer.Token(ctx, "${GITHUB}", "https://api.github.com")
	if err != nil || token != "gho_token" {
		t.Fatalf("Token = %q, %v", token, err)
	}
	if _, err := service.authorizer.Token(context.Background(), "${GITHUB}", "https://api.github.com"); err == nil {
		t.Error("expected a request without the browser's values to hold no sign-in")
	}
	if values.Written() == "" {
		t.Error("expected the sign-in to be handed back to the browser")
	}
}

// A header nothing can be read from is still a browser offering to keep values.
func TestUnreadableBrowserValuesAreAnEmptyStore(t *testing.T) {
	values := ReadBrowserValues("not base64!")
	if values == nil || !values.Available() {
		t.Fatal("expected an empty store")
	}
	if _, ok := values.Get("", "TOKEN"); ok {
		t.Error("expected nothing held")
	}
	if ReadBrowserValues("") != nil {
		t.Error("expected no header to be no store")
	}
}

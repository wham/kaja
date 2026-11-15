package api

import (
	"context"
	"testing"

	"github.com/wham/kaja/v2/pkg/oauth"
)

// A sign-in is kept under the workspace's id and the server it is for, and every
// app that signs in to that server is stated as signed in. kaja.json is not written.
func TestASignInIsKeptForTheServer(t *testing.T) {
	path := writeWorkspace(t, `{"id": "w", "apps": [
		{"name": "one", "mcp": {"url": "https://Example.com/mcp/", "auth": "oauth"}},
		{"name": "two", "mcp": {"url": "https://example.com/mcp", "auth": "oauth"}},
		{"name": "elsewhere", "mcp": {"url": "https://other.example.com/mcp", "auth": "oauth"}},
		{"name": "token", "mcp": {"url": "https://example.com/mcp", "auth": "bearer", "token": "t"}},
		{"name": "github", "openapi": {"spec_url": "https://example.com/spec.json", "security_scheme": "githubSignIn"}}
	]}`)
	store := &fakeStore{available: true}
	service := NewApiService(path, true, "", "", store)
	defer service.Close()

	held := `{"resource":"https://example.com/mcp","server":{"issuer":"https://example.com"},"token":{"access_token":"the-token"}}`
	if err := (signInStore{service: service}).Save(context.Background(), oauth.Slot("https://example.com/mcp"), held); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if got := store.values["w#signin:https://example.com/mcp"]; got != held {
		t.Errorf("the sign-in is filed under %v", store.values)
	}

	response := service.workspaceResponse(context.Background())
	if len(response.Workspace.Variables) != 0 {
		t.Errorf("variables = %v, want kaja.json left alone", response.Workspace.Variables)
	}
	want := map[string]bool{"one": true, "two": true, "elsewhere": false, "github": false}
	if len(response.SignIns) != len(want) {
		t.Fatalf("sign-ins = %v", response.SignIns)
	}
	for _, status := range response.SignIns {
		if signedIn, ok := want[status.App]; !ok || signedIn != status.SignedIn {
			t.Errorf("%s: signed in = %v, want %v", status.App, status.SignedIn, signedIn)
		}
	}
}

// The token a sign-in handed out is masked out of what a call reports sending.
func TestASignedInTokenIsRedacted(t *testing.T) {
	path := writeWorkspace(t, `{}`)
	store := &fakeStore{available: true}
	service := NewApiService(path, true, "", "", store)
	defer service.Close()

	held := `{"resource":"https://api.github.com","server":{"issuer":"https://github.com/login/oauth"},"token":{"access_token":"gho_the_token"}}`
	if err := (signInStore{service: service}).Save(context.Background(), oauth.Slot("https://api.github.com"), held); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if _, err := service.authorizer.Token(context.Background(), "https://api.github.com"); err != nil {
		t.Fatalf("Token: %v", err)
	}
	reported := service.redact(service.Variables(), map[string]string{"Authorization": "Bearer gho_the_token"}, nil)
	if got := reported["Authorization"]; got != "Bearer ${signin}" {
		t.Errorf("Authorization = %q, want the token masked", got)
	}
}

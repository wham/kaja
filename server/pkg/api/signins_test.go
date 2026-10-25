package api

import (
	"context"
	"testing"
)

// A sign-in is kept under the workspace's id like a stored value, and the variable
// naming it is written into kaja.json once it lands.
func TestASignInIsKeptAsAVariable(t *testing.T) {
	path := writeWorkspace(t, `{"variables": {"HOST": "https://example.com"}}`)
	store := &fakeStore{available: true}
	service := NewApiService(path, true, "", "", store)
	defer service.Close()

	held := `{"resource":"https://api.github.com","server":{"issuer":"https://github.com/login/oauth"},"token":{"access_token":"the-token"}}`
	if err := (signInStore{service: service}).Save(context.Background(), "GITHUB", held); err != nil {
		t.Fatalf("Save: %v", err)
	}
	name, err := service.signInVariable("${GITHUB}")
	if err != nil || name != "GITHUB" {
		t.Fatalf("signInVariable = %q, %v", name, err)
	}
	if err := service.defineSignIn(name); err != nil {
		t.Fatalf("defineSignIn: %v", err)
	}

	workspace := service.snapshot().workspace
	if got := workspace.Variables["GITHUB"]; got != SignInSource {
		t.Errorf("GITHUB = %q, want %q", got, SignInSource)
	}
	if got := store.values[workspace.GetId()+"#GITHUB"]; got != held {
		t.Errorf("the sign-in is filed under %v, want the workspace's id", store.values)
	}
	if got := statusFor(t, service.Variables(), "GITHUB"); got.Source != VariableSource_VARIABLE_SOURCE_SIGN_IN {
		t.Errorf("status = %v", got)
	}
}

// A variable that holds a value of its own is not one a sign-in may overwrite.
func TestASignInIsNotKeptInAVariableWithAValue(t *testing.T) {
	path := writeWorkspace(t, `{"variables": {"TOKEN": "${secret}"}}`)
	service := NewApiService(path, true, "", "", &fakeStore{available: true})
	defer service.Close()

	if _, err := service.signInVariable("${TOKEN}"); err == nil {
		t.Error("expected a ${secret} variable to be refused")
	}
	if _, err := service.signInVariable("ghp_typed"); err == nil {
		t.Error("expected a credential naming no variable to be refused")
	}
}

// The token a sign-in handed out is masked out of what a call reports sending.
func TestASignedInTokenIsRedacted(t *testing.T) {
	path := writeWorkspace(t, `{"variables": {"GITHUB": "${signin}"}}`)
	store := &fakeStore{available: true}
	service := NewApiService(path, true, "", "", store)
	defer service.Close()

	held := `{"resource":"https://api.github.com","server":{"issuer":"https://github.com/login/oauth"},"token":{"access_token":"gho_the_token"}}`
	if err := (signInStore{service: service}).Save(context.Background(), "GITHUB", held); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if _, err := service.authorizer.Token(context.Background(), "${GITHUB}", "https://api.github.com"); err != nil {
		t.Fatalf("Token: %v", err)
	}
	reported := service.redact(service.Variables(), map[string]string{"Authorization": "Bearer gho_the_token"}, nil)
	if got := reported["Authorization"]; got != "Bearer ${GITHUB}" {
		t.Errorf("Authorization = %q, want the token masked", got)
	}
}

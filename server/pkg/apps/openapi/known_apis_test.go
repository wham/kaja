package openapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/oauth"
)

const githubLike = `openapi: 3.0.3
info: {title: GitHub v3 REST API, version: 1.1.4}
servers:
  - url: https://api.github.com/
paths:
  /user:
    get:
      operationId: users/get-authenticated
      responses:
        "200": {description: ok}
`

func mustReadSpec(t *testing.T, document string) *spec {
	t.Helper()
	s, p := readSpec([]byte(document), "")
	if p != nil {
		t.Fatalf("readSpec: %v", p)
	}
	return s
}

func TestGitHubIsSuppliedTheSchemesItsDocumentLeavesOut(t *testing.T) {
	s := mustReadSpec(t, githubLike)
	if got := strings.Join(s.Components.SecuritySchemes.order(), ","); got != "githubSignIn,personalAccessToken" {
		t.Fatalf("schemes = %q", got)
	}
	signIn := s.Components.SecuritySchemes.get("githubSignIn")
	if !signIn.supplied || signIn.signIn == nil || signIn.signIn.issuer != "https://github.com/login/oauth" {
		t.Errorf("githubSignIn = %+v", signIn)
	}

	document := describe(s, "https://raw.githubusercontent.com/github/rest-api-description/main/api.github.com.json")
	if len(document.SecuritySchemes) != 2 || !document.SecuritySchemes[0].SignIn || !document.SecuritySchemes[0].Supplied {
		t.Errorf("described schemes = %+v", document.SecuritySchemes)
	}
	if document.PerOperationSecurity {
		t.Error("a supplied scheme applies to every operation")
	}
}

func TestADocumentDeclaringSchemesKeepsItsOwn(t *testing.T) {
	s := mustReadSpec(t, githubLike+`components:
  securitySchemes:
    bearer: {type: http, scheme: bearer}
`)
	if got := strings.Join(s.Components.SecuritySchemes.order(), ","); got != "bearer" {
		t.Errorf("schemes = %q, want the document's own", got)
	}
}

func TestAnotherServerIsSuppliedNothing(t *testing.T) {
	s := mustReadSpec(t, strings.Replace(githubLike, "https://api.github.com/", "https://github.example.com/api/v3", 1))
	if s.Components.SecuritySchemes.len() != 0 {
		t.Errorf("schemes = %v, want none", s.Components.SecuritySchemes.order())
	}
}

// An app saved before kaja knew GitHub's schemes names none, and goes on sending
// the token it was saved with.
func TestASuppliedSchemeIsNeverPickedForAnApp(t *testing.T) {
	s := mustReadSpec(t, githubLike)
	if got := resolveAuth(s, "", "a-token", "", ""); got.kind != authBearer || got.token != "a-token" {
		t.Errorf("unpinned with a token = %+v, want the token as a bearer token", got)
	}
	if got := resolveAuth(s, "", "", "", ""); got.configured() {
		t.Errorf("unpinned without a token = %+v, want nothing sent", got)
	}
	if got := resolveAuth(s, "githubSignIn", "", "", ""); got.kind != authOAuth {
		t.Errorf("pinned = %+v, want the sign-in", got)
	}
}

func TestASignInIsRefusedWithoutAnAuthorizer(t *testing.T) {
	s := mustReadSpec(t, githubLike)
	if _, err := resolveAuth(s, "githubSignIn", "", "", "").withToken(nil, "https://api.github.com"); err == nil {
		t.Error("expected a kaja with nowhere to keep a sign-in to refuse")
	}
}

func TestASignInSaysWhenItHasNoToken(t *testing.T) {
	s := mustReadSpec(t, githubLike)
	authorizer := oauth.NewAuthorizer(oauth.NewTokenStore(filepath.Join(t.TempDir(), "oauth.json")), nil)
	_, err := resolveAuth(s, "githubSignIn", "", "", "").withToken(authorizer, "https://api.github.com")
	if err == nil || !strings.Contains(err.Error(), "not signed in") {
		t.Errorf("err = %v, want it to say kaja is not signed in", err)
	}
}

// A token is for the server it was issued for. An app pointed somewhere else is
// not sent it, whatever the scheme says.
func TestASignInIsNotSentToAnotherServer(t *testing.T) {
	s := mustReadSpec(t, githubLike)
	authorizer := signedInAuthorizer(t, "https://api.github.com", "the-token")
	_, err := resolveAuth(s, "githubSignIn", "", "", "").withToken(authorizer, "https://github.example.com/api/v3")
	if err == nil || !strings.Contains(err.Error(), "the sign-in is for") {
		t.Errorf("err = %v, want the call refused", err)
	}
}

func TestASignInSendsTheTokenKajaHolds(t *testing.T) {
	s := mustReadSpec(t, githubLike)
	authorizer := signedInAuthorizer(t, "https://api.github.com", "the-token")
	resolved, err := resolveAuth(s, "githubSignIn", "", "", "").withToken(authorizer, "https://api.github.com")
	if err != nil {
		t.Fatalf("withToken: %v", err)
	}
	request, _ := http.NewRequest(http.MethodGet, "https://api.github.com/user", nil)
	resolved.applyRequest(request)
	if got := request.Header.Get("Authorization"); got != "Bearer the-token" {
		t.Errorf("Authorization = %q", got)
	}
}

// signedInAuthorizer is an authorizer holding a token for one resource, written
// the way a finished sign-in leaves it.
func signedInAuthorizer(t *testing.T, resource, token string) *oauth.Authorizer {
	t.Helper()
	path := filepath.Join(t.TempDir(), "oauth.json")
	held := `{"grants":{"` + resource + `":{"server":{"issuer":"https://github.com/login/oauth"},"token":{"access_token":"` + token + `"}}}}`
	if err := os.WriteFile(path, []byte(held), 0o600); err != nil {
		t.Fatal(err)
	}
	return oauth.NewAuthorizer(oauth.NewTokenStore(path), nil)
}

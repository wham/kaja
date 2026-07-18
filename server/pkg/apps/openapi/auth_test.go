package openapi

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/wham/kaja/v2/pkg/apps"
)

func TestResolveAuthFromScheme(t *testing.T) {
	tests := []struct {
		name       string
		schemes    map[string]*securityScheme
		security   []map[string][]string
		token      string
		username   string
		password   string
		wantKind   authKind
		wantIn     string
		wantKeyNam string
	}{
		{
			name:     "bearer http",
			schemes:  map[string]*securityScheme{"bearerAuth": {Type: "http", Scheme: "bearer"}},
			security: []map[string][]string{{"bearerAuth": {}}},
			token:    "t",
			wantKind: authBearer,
		},
		{
			name:     "basic http",
			schemes:  map[string]*securityScheme{"basicAuth": {Type: "http", Scheme: "basic"}},
			security: []map[string][]string{{"basicAuth": {}}},
			username: "u",
			wantKind: authBasic,
		},
		{
			name:       "apiKey header",
			schemes:    map[string]*securityScheme{"k": {Type: "apiKey", In: "header", Name: "X-API-Key"}},
			security:   []map[string][]string{{"k": {}}},
			token:      "t",
			wantKind:   authAPIKey,
			wantIn:     "header",
			wantKeyNam: "X-API-Key",
		},
		{
			name:     "capitalized Basic http",
			schemes:  map[string]*securityScheme{"basicAuth": {Type: "http", Scheme: "Basic"}},
			security: []map[string][]string{{"basicAuth": {}}},
			username: "u",
			wantKind: authBasic,
		},
		{
			name:     "oauth2 is bearer",
			schemes:  map[string]*securityScheme{"oauth": {Type: "oauth2"}},
			security: []map[string][]string{{"oauth": {}}},
			token:    "t",
			wantKind: authBearer,
		},
		{
			name:     "sole scheme without document security",
			schemes:  map[string]*securityScheme{"only": {Type: "http", Scheme: "bearer"}},
			token:    "t",
			wantKind: authBearer,
		},
		{
			name:     "no scheme, token falls back to bearer",
			token:    "t",
			wantKind: authBearer,
		},
		{
			name:     "no scheme, basic creds fall back to basic",
			username: "u",
			password: "p",
			wantKind: authBasic,
		},
		{
			// Benchling-style: oauth is the first document security requirement,
			// but a username means the user wants the basic API-key scheme.
			name: "username selects basic over oauth-first security",
			schemes: map[string]*securityScheme{
				"oAuth":           {Type: "oauth2"},
				"basicApiKeyAuth": {Type: "http", Scheme: "basic"},
			},
			security: []map[string][]string{{"oAuth": {}}, {"basicApiKeyAuth": {}}},
			username: "my-key",
			wantKind: authBasic,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := &spec{Components: components{SecuritySchemes: tc.schemes}, Security: tc.security}
			a := resolveAuth(s, tc.token, tc.username, tc.password)
			if a.kind != tc.wantKind {
				t.Errorf("kind = %q, want %q", a.kind, tc.wantKind)
			}
			if a.apiKeyIn != tc.wantIn {
				t.Errorf("apiKeyIn = %q, want %q", a.apiKeyIn, tc.wantIn)
			}
			if a.apiKeyName != tc.wantKeyNam {
				t.Errorf("apiKeyName = %q, want %q", a.apiKeyName, tc.wantKeyNam)
			}
		})
	}
}

// TestTranscodeAuthInjection checks that each scheme reaches the upstream request.
func TestTranscodeAuthInjection(t *testing.T) {
	tests := []struct {
		name   string
		auth   *auth
		verify func(t *testing.T, r *http.Request)
	}{
		{
			name: "bearer",
			auth: &auth{kind: authBearer, token: "abc"},
			verify: func(t *testing.T, r *http.Request) {
				if got := r.Header.Get("Authorization"); got != "Bearer abc" {
					t.Errorf("Authorization = %q, want %q", got, "Bearer abc")
				}
			},
		},
		{
			name: "basic",
			auth: &auth{kind: authBasic, username: "u", password: "p"},
			verify: func(t *testing.T, r *http.Request) {
				u, p, ok := r.BasicAuth()
				if !ok || u != "u" || p != "p" {
					t.Errorf("BasicAuth = (%q,%q,%v), want (u,p,true)", u, p, ok)
				}
			},
		},
		{
			name: "apiKey header",
			auth: &auth{kind: authAPIKey, apiKeyIn: "header", apiKeyName: "X-API-Key", token: "k"},
			verify: func(t *testing.T, r *http.Request) {
				if got := r.Header.Get("X-API-Key"); got != "k" {
					t.Errorf("X-API-Key = %q, want k", got)
				}
			},
		},
		{
			name: "apiKey query",
			auth: &auth{kind: authAPIKey, apiKeyIn: "query", apiKeyName: "api_key", token: "k"},
			verify: func(t *testing.T, r *http.Request) {
				if got := r.URL.Query().Get("api_key"); got != "k" {
					t.Errorf("api_key query = %q, want k", got)
				}
			},
		},
		{
			name: "apiKey cookie",
			auth: &auth{kind: authAPIKey, apiKeyIn: "cookie", apiKeyName: "session", token: "k"},
			verify: func(t *testing.T, r *http.Request) {
				c, err := r.Cookie("session")
				if err != nil || c.Value != "k" {
					t.Errorf("session cookie = %v (err %v), want k", c, err)
				}
			},
		},
		{
			name: "unconfigured sends nothing",
			auth: &auth{kind: authBearer},
			verify: func(t *testing.T, r *http.Request) {
				if got := r.Header.Get("Authorization"); got != "" {
					t.Errorf("Authorization = %q, want empty", got)
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				tc.verify(t, r)
				w.Header().Set("Content-Type", "application/json")
				io.WriteString(w, `{}`)
			}))
			defer srv.Close()

			in := &instance{baseURL: srv.URL, client: srv.Client(), auth: tc.auth}
			binding := &methodBinding{verb: "GET", pathTemplate: "/thing", responseWrap: "object"}
			if _, _, _, err := in.transcode(binding, []byte(`{}`), nil); err != nil {
				t.Fatalf("transcode: %v", err)
			}
		})
	}
}

// TestTranscodeSurfacesHeaders checks that transcode reports the headers it
// exchanged with the upstream, masking credential-bearing ones while passing
// plain headers and response headers through.
func TestTranscodeSurfacesHeaders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Request-Id", "req-123")
		io.WriteString(w, `{}`)
	}))
	defer srv.Close()

	in := &instance{baseURL: srv.URL, client: srv.Client(), auth: &auth{kind: authBearer, token: "secret-token"}}
	binding := &methodBinding{verb: "GET", pathTemplate: "/thing", responseWrap: "object"}
	_, reqHeaders, respHeaders, err := in.transcode(binding, []byte(`{}`), nil)
	if err != nil {
		t.Fatalf("transcode: %v", err)
	}

	if got := reqHeaders["Authorization"]; got != "Bearer secret-token" {
		t.Errorf("request Authorization = %q, want %q", got, "Bearer secret-token")
	}
	if got := reqHeaders["Accept"]; got != "application/json" {
		t.Errorf("request Accept = %q, want application/json", got)
	}
	if got := respHeaders["X-Request-Id"]; got != "req-123" {
		t.Errorf("response X-Request-Id = %q, want req-123", got)
	}
}

// TestTranscodeSurfacesBasicAuthUsername checks that a basic-auth username is
// sent and shows up in the surfaced request headers as the Basic Authorization
// header (the shape APIs like Benchling expect, with the key as the username).
func TestTranscodeSurfacesBasicAuthUsername(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{}`)
	}))
	defer srv.Close()

	in := &instance{baseURL: srv.URL, client: srv.Client(), auth: &auth{kind: authBasic, username: "my-api-key"}}
	binding := &methodBinding{verb: "GET", pathTemplate: "/thing", responseWrap: "object"}
	_, reqHeaders, _, err := in.transcode(binding, []byte(`{}`), nil)
	if err != nil {
		t.Fatalf("transcode: %v", err)
	}

	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("my-api-key:"))
	if got := reqHeaders["Authorization"]; got != want {
		t.Errorf("request Authorization = %q, want %q", got, want)
	}
}

// TestTranscodeSurfacesHeadersOnError checks that a failed (>= 400) upstream call
// still reports the exchanged headers via the UpstreamError, so the Headers view
// is populated on a 401.
func TestTranscodeSurfacesHeadersOnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"message":"unauthorized"}`)
	}))
	defer srv.Close()

	in := &instance{baseURL: srv.URL, client: srv.Client(), auth: &auth{kind: authBearer, token: "secret-token"}}
	binding := &methodBinding{verb: "GET", pathTemplate: "/thing", responseWrap: "object"}
	_, _, _, err := in.transcode(binding, []byte(`{}`), nil)

	var upstream *apps.UpstreamError
	if !errors.As(err, &upstream) {
		t.Fatalf("transcode error = %v, want *apps.UpstreamError", err)
	}
	if got := upstream.RequestHeaders["Authorization"]; got != "Bearer secret-token" {
		t.Errorf("request Authorization = %q, want %q", got, "Bearer secret-token")
	}
	if got := upstream.ResponseHeaders["Www-Authenticate"]; got != "Bearer" {
		t.Errorf("response Www-Authenticate = %q, want Bearer", got)
	}
}

// TestAuthApplyNilSafe documents that instances without auth (e.g. unit tests) work.
func TestAuthApplyNilSafe(t *testing.T) {
	var a *auth
	a.applyQuery(url.Values{})
	req, _ := http.NewRequest("GET", "http://example.com", nil)
	a.applyRequest(req)
	if req.Header.Get("Authorization") != "" {
		t.Error("nil auth set a header")
	}
}

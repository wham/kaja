package openapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
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
			if _, err := in.transcode(binding, []byte(`{}`), nil); err != nil {
				t.Fatalf("transcode: %v", err)
			}
		})
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

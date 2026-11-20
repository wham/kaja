package openapi

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// The shape Benchling's document takes: a relative server, and a client
// credentials flow whose token URL is relative to it.
const clientCredentialsSpec = `
openapi: 3.0.1
info: {title: Lab API, version: "2.0.0"}
servers:
  - url: /api/v2
security:
  - oAuth: []
  - basicApiKeyAuth: []
paths:
  /entries:
    get:
      operationId: listEntries
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  name: {type: string}
components:
  securitySchemes:
    basicApiKeyAuth:
      type: http
      scheme: basic
    oAuth:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: /api/v2/token
          scopes: {}
`

type tokenServer struct {
	issued    atomic.Int32
	calls     atomic.Int32
	refuseNth int32 // the call that answers 401, as a revoked token would
	basicOnly bool
	postOnly  bool
}

func (ts *tokenServer) start(t *testing.T) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, clientCredentialsSpec) })
	mux.HandleFunc("/api/v2/token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil || r.PostForm.Get("grant_type") != "client_credentials" {
			http.Error(w, `{"error":"unsupported_grant_type"}`, http.StatusBadRequest)
			return
		}
		id, secret, basic := r.BasicAuth()
		if !basic {
			id, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
		}
		if (ts.postOnly && basic) || (ts.basicOnly && !basic) || id != "app-id" || secret != "app-secret" {
			w.WriteHeader(http.StatusUnauthorized)
			io.WriteString(w, `{"error":"invalid_client"}`)
			return
		}
		n := ts.issued.Add(1)
		fmt.Fprintf(w, `{"access_token":"minted-token-%d","token_type":"Bearer","expires_in":900}`, n)
	})
	mux.HandleFunc("/api/v2/entries", func(w http.ResponseWriter, r *http.Request) {
		n := ts.calls.Add(1)
		if n == ts.refuseNth || r.Header.Get("Authorization") != fmt.Sprintf("Bearer minted-token-%d", ts.issued.Load()) {
			w.WriteHeader(http.StatusUnauthorized)
			io.WriteString(w, `{"error":"invalid_token"}`)
			return
		}
		io.WriteString(w, `{"name":"entry"}`)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func openClientCredentialsApp(t *testing.T, srv *httptest.Server, extra map[string]string) (*instance, string) {
	t.Helper()
	parameters := map[string]string{
		"spec_url":        srv.URL + "/openapi.yaml",
		"base_url":        srv.URL + "/api/v2",
		"security_scheme": "oAuth",
		"client_id":       "app-id",
		"client_secret":   "app-secret",
	}
	for key, value := range extra {
		parameters[key] = value
	}
	opened, err := New().Open(context.Background(), parameters, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	inst := opened.Instance.(*instance)
	for method := range inst.methods {
		return inst, method
	}
	t.Fatal("no methods")
	return nil, ""
}

func TestClientCredentialsExchangedOnceAndSent(t *testing.T) {
	for name, server := range map[string]*tokenServer{
		"basic header": {basicOnly: true},
		"form body":    {postOnly: true},
	} {
		t.Run(name, func(t *testing.T) {
			inst, method := openClientCredentialsApp(t, server.start(t), nil)
			for i := 0; i < 3; i++ {
				result, err := invoke(inst, method, encodeRequest(t, inst, method, `{}`), nil)
				if err != nil {
					t.Fatalf("call %d: %v", i, err)
				}
				if got := result.RequestHeaders["Authorization"]; got != "Bearer minted-token-1" {
					t.Errorf("call %d sent Authorization %q", i, got)
				}
			}
			if got := server.issued.Load(); got != 1 {
				t.Errorf("tokens issued = %d, want one reused for every call", got)
			}
		})
	}
}

func TestClientCredentialsRenewedOnUnauthorized(t *testing.T) {
	server := &tokenServer{refuseNth: 2}
	inst, method := openClientCredentialsApp(t, server.start(t), nil)
	for i := 0; i < 2; i++ {
		if _, err := invoke(inst, method, encodeRequest(t, inst, method, `{}`), nil); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	if got := server.issued.Load(); got != 2 {
		t.Errorf("tokens issued = %d, want a second after the API refused the first", got)
	}
}

func TestClientCredentialsTokenURLOverride(t *testing.T) {
	server := &tokenServer{}
	srv := server.start(t)
	inst, method := openClientCredentialsApp(t, srv, map[string]string{"token_url": srv.URL + "/api/v2/token"})
	if _, err := invoke(inst, method, encodeRequest(t, inst, method, `{}`), nil); err != nil {
		t.Fatal(err)
	}
	if server.issued.Load() != 1 {
		t.Error("no token was issued")
	}
}

func TestClientCredentialsRefusedSecret(t *testing.T) {
	inst, method := openClientCredentialsApp(t, (&tokenServer{}).start(t), map[string]string{"client_secret": "wrong"})
	if _, err := invoke(inst, method, encodeRequest(t, inst, method, `{}`), nil); err == nil {
		t.Fatal("a refused secret made a call")
	}
}

func TestClientCredentialsNeedAClientID(t *testing.T) {
	s, p := readSpec([]byte(clientCredentialsSpec), "")
	if p != nil {
		t.Fatal(p)
	}
	if got := authFor(s, map[string]string{"security_scheme": "oAuth", "token": "pasted"}); got.kind != authBearer || got.token != "pasted" {
		t.Errorf("a pasted token on the oauth2 scheme resolved to %+v", got)
	}
	if got := authFor(s, map[string]string{"security_scheme": "basicApiKeyAuth", "username": "key", "client_id": "app-id"}); got.kind != authBasic {
		t.Errorf("a client id on another scheme took it over: %+v", got)
	}
	if got := authFor(s, map[string]string{"client_id": "app-id", "client_secret": "s"}); got.kind != authClientCredentials || got.clientCredentials.TokenURL != "/api/v2/token" {
		t.Errorf("an unpinned app with a client id resolved to %+v", got)
	}
}

func TestClientCredentialsDescribed(t *testing.T) {
	s, _ := readSpec([]byte(clientCredentialsSpec), "")
	document := describe(s, "")
	for _, scheme := range document.SecuritySchemes {
		if scheme.Key == "oAuth" && scheme.TokenURL != "/api/v2/token" {
			t.Errorf("TokenURL = %q", scheme.TokenURL)
		}
		if scheme.Key != "oAuth" && scheme.TokenURL != "" {
			t.Errorf("%s has a token URL", scheme.Key)
		}
	}
}

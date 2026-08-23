package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/bundle"
)

// Where a runner binds is the whole of how it decides what it is: somebody's own
// machine, or something a platform put on a port and expects to be reachable.
func TestListenAddress(t *testing.T) {
	if got := listenAddress("0.0.0.0:9000"); got != "0.0.0.0:9000" {
		t.Errorf("a stated address should win: %q", got)
	}

	t.Setenv("PORT", "8080")
	if got := listenAddress(""); got != ":8080" {
		t.Errorf("$PORT should mean every interface: %q", got)
	}

	t.Setenv("PORT", "")
	if got := listenAddress(""); got != "127.0.0.1:0" {
		t.Errorf("with neither, a port nobody else can reach: %q", got)
	}
}

// A run makes calls with the credentials this process holds, so being reachable
// is a decision rather than a default.
func TestCheckReachable(t *testing.T) {
	app := func(local bool, token string) *runner {
		return &runner{local: local, token: token, state: &state{Manifest: &bundle.Manifest{Name: "movies"}}}
	}

	if err := app(true, "").checkReachable(); err != nil {
		t.Errorf("a loopback address needs no permission: %v", err)
	}
	if err := app(false, "s3cr3t").checkReachable(); err != nil {
		t.Errorf("a token says who may run it: %v", err)
	}

	err := app(false, "").checkReachable()
	if err == nil {
		t.Fatal("a public address with nothing said should refuse to start")
	}
	// Refusing is only useful if it names both ways out.
	for _, mention := range []string{TokenEnv, PublicEnv, "movies"} {
		if !strings.Contains(err.Error(), mention) {
			t.Errorf("the refusal should mention %q, got: %v", mention, err)
		}
	}

	t.Setenv(PublicEnv, "1")
	if err := app(false, "").checkReachable(); err != nil {
		t.Errorf("meaning it is a way out: %v", err)
	}
}

func TestGuard(t *testing.T) {
	reached := false
	guarded := (&runner{token: "s3cr3t"}).guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))

	ask := func(target string, headers map[string]string, cookies ...*http.Cookie) (int, *http.Response) {
		reached = false
		request := httptest.NewRequest(http.MethodGet, target, nil)
		for name, value := range headers {
			request.Header.Set(name, value)
		}
		for _, cookie := range cookies {
			request.AddCookie(cookie)
		}
		recorder := httptest.NewRecorder()
		guarded.ServeHTTP(recorder, request)
		return recorder.Code, recorder.Result()
	}

	if code, _ := ask("/", nil); code != http.StatusUnauthorized || reached {
		t.Errorf("nothing gets through without the token: %d", code)
	}
	if code, _ := ask("/target/Shows.ListShows", nil); code != http.StatusUnauthorized || reached {
		t.Errorf("the call path is guarded too: %d", code)
	}
	// The one request that must be answerable by something with no business
	// running the app: the platform asking whether this came up.
	if code, _ := ask("/status", nil); code != http.StatusOK || !reached {
		t.Errorf("the health check should not need the token: %d", code)
	}
	if code, _ := ask("/", map[string]string{"Authorization": "Bearer s3cr3t"}); code != http.StatusOK || !reached {
		t.Errorf("a bearer token is how a script reaches it: %d", code)
	}
	if code, _ := ask("/", map[string]string{"Authorization": "Bearer nope"}); code != http.StatusUnauthorized {
		t.Errorf("a wrong bearer is no bearer: %d", code)
	}
	if code, _ := ask("/", nil, &http.Cookie{Name: tokenCookie, Value: "s3cr3t"}); code != http.StatusOK || !reached {
		t.Errorf("the cookie is what the redirect left behind: %d", code)
	}

	// A token in the query is remembered and taken back out of the URL, so it is
	// not left in a history or a screenshot.
	code, response := ask("/?token=s3cr3t", nil)
	if code != http.StatusSeeOther {
		t.Fatalf("a token in the query should redirect: %d", code)
	}
	if away := response.Header.Get("Location"); strings.Contains(away, "token") {
		t.Errorf("the redirect still carries the token: %q", away)
	}
	var held *http.Cookie
	for _, cookie := range response.Cookies() {
		if cookie.Name == tokenCookie {
			held = cookie
		}
	}
	if held == nil || held.Value != "s3cr3t" || !held.HttpOnly {
		t.Errorf("the token should be remembered in an http-only cookie: %+v", held)
	}
}

// With no token there is nothing to check, and an app on a loopback address or
// one that means to be open is served straight through.
func TestGuardIsAbsentWithoutAToken(t *testing.T) {
	reached := false
	guarded := (&runner{}).guard(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	guarded.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	if !reached {
		t.Error("an app with no token should not be guarded")
	}
}

// The token redirect hands back a Location, and a Location taken from the
// request is a redirect to wherever the request asked for — a path starting
// with two slashes is another site to a browser. Whatever was asked for, what
// comes back has to be this app.
func TestGuardRedirectsOnlyToItself(t *testing.T) {
	guarded := (&runner{token: "s3cr3t"}).guard(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	for _, target := range []string{
		"//evil.example.com/?token=s3cr3t",
		"///evil.example.com/?token=s3cr3t",
		"http://evil.example.com/?token=s3cr3t",
		"/canvas?token=s3cr3t&keep=1",
	} {
		recorder := httptest.NewRecorder()
		guarded.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))

		away := recorder.Result().Header.Get("Location")
		if recorder.Code != http.StatusSeeOther {
			t.Fatalf("%s: code = %d", target, recorder.Code)
		}
		if !strings.HasPrefix(away, "/") || strings.HasPrefix(away, "//") {
			t.Errorf("%s: Location %q leaves this app", target, away)
		}
		if strings.Contains(away, "evil.example.com") && !strings.HasPrefix(away, "/evil.example.com") {
			t.Errorf("%s: Location %q names another host", target, away)
		}
		if strings.Contains(away, "token") {
			t.Errorf("%s: Location %q still carries the token", target, away)
		}
	}

	// What is not the token is kept, because the redirect is the same page.
	recorder := httptest.NewRecorder()
	guarded.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/canvas?token=s3cr3t&keep=1", nil))
	if away := recorder.Result().Header.Get("Location"); away != "/canvas?keep=1" {
		t.Errorf("Location = %q, want /canvas?keep=1", away)
	}
}

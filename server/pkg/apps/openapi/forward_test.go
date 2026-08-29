package openapi

import "testing"

// The address is the security boundary of the forwarding lane. What reaches it has
// crossed from a browser, and on a deployed kaja that browser is not necessarily
// the workspace's owner — so the host is the app's and only the path is the
// caller's, whatever the caller writes.
func TestResolveKeepsTheCallOnTheAppsOwnHost(t *testing.T) {
	in := &instance{baseURL: "https://api.example.com/v1"}

	for _, path := range []string{
		"https://evil.example.net/x",
		"//evil.example.net/x",
		"http://evil.example.net",
		"https://user:pass@evil.example.net/x",
		"//evil.example.net",
	} {
		if target, err := in.resolve(path); err == nil {
			t.Errorf("resolve(%q) = %s, want a refusal", path, target)
		}
	}
}

// A document mounted at /v1 is an API that begins at /v1: climbing out of it
// reaches endpoints on that host the app was never opened for.
func TestResolveStaysUnderTheBasePath(t *testing.T) {
	in := &instance{baseURL: "https://api.example.com/v1"}

	for _, path := range []string{"/../admin", "/../../admin", "/shows/../../admin", "/..%2fadmin"} {
		if target, err := in.resolve(path); err == nil && target.Path != "/v1" && !hasPrefix(target.Path, "/v1/") {
			t.Errorf("resolve(%q) = %s, want it kept under /v1", path, target)
		}
	}
}

func TestResolveBuildsTheOrdinaryCall(t *testing.T) {
	in := &instance{baseURL: "https://api.example.com/v1"}

	cases := []struct{ path, want string }{
		{"/shows", "https://api.example.com/v1/shows"},
		{"/shows?limit=2", "https://api.example.com/v1/shows?limit=2"},
		{"/shows/vera-lune", "https://api.example.com/v1/shows/vera-lune"},
		// A dot segment inside the path is settled here rather than left for the
		// upstream to interpret.
		{"/shows/./vera-lune", "https://api.example.com/v1/shows/vera-lune"},
		{"/shows/a/../b", "https://api.example.com/v1/shows/b"},
	}
	for _, one := range cases {
		target, err := in.resolve(one.path)
		if err != nil {
			t.Errorf("resolve(%q): %v", one.path, err)
			continue
		}
		if target.String() != one.want {
			t.Errorf("resolve(%q) = %s, want %s", one.path, target, one.want)
		}
	}
}

// A base URL with no path of its own confines nothing but the host, which is the
// common case and must keep working.
func TestResolveWithABareBaseURL(t *testing.T) {
	in := &instance{baseURL: "https://api.example.com"}

	target, err := in.resolve("/shows")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if target.String() != "https://api.example.com/shows" {
		t.Errorf("resolve = %s", target)
	}
	if _, err := in.resolve("https://evil.example.net/x"); err == nil {
		t.Error("an absolute URL was accepted against a bare base URL")
	}
}

// The fragment is never sent, so a path carrying one loses it rather than
// smuggling it upstream.
func TestResolveDropsAFragment(t *testing.T) {
	in := &instance{baseURL: "https://api.example.com"}
	target, err := in.resolve("/shows#anchor")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if target.String() != "https://api.example.com/shows" {
		t.Errorf("resolve = %s", target)
	}
}

func hasPrefix(text, prefix string) bool {
	return len(text) >= len(prefix) && text[:len(prefix)] == prefix
}

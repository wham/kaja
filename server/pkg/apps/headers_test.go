package apps

import (
	"net/http"
	"testing"
)

func TestSurfaceHeaders(t *testing.T) {
	header := http.Header{
		"Authorization": {"Bearer secret"},
		"X-Api-Key":     {"abc123"},
		"Accept":        {"application/json"},
		"Set-Cookie":    {"a=1", "b=2"},
		"Content-Type":  {"application/json"},
	}

	got := SurfaceHeaders(header)

	if got["Authorization"] != RedactedValue {
		t.Errorf("Authorization = %q, want %q", got["Authorization"], RedactedValue)
	}
	if got["X-Api-Key"] != RedactedValue {
		t.Errorf("X-Api-Key = %q, want %q", got["X-Api-Key"], RedactedValue)
	}
	if got["Set-Cookie"] != RedactedValue {
		t.Errorf("Set-Cookie = %q, want %q", got["Set-Cookie"], RedactedValue)
	}
	if got["Accept"] != "application/json" {
		t.Errorf("Accept = %q, want application/json", got["Accept"])
	}
	if got["Content-Type"] != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got["Content-Type"])
	}
}

func TestSurfaceHeadersEmpty(t *testing.T) {
	if got := SurfaceHeaders(nil); got != nil {
		t.Errorf("SurfaceHeaders(nil) = %v, want nil", got)
	}
}

func TestIsSensitiveHeader(t *testing.T) {
	cases := map[string]bool{
		"Authorization":       true,
		"Proxy-Authorization": true,
		"Cookie":              true,
		"X-Api-Key":           true,
		"X-Auth-Token":        true,
		"api_key":             true,
		"X-Client-Secret":     true,
		"Accept":              false,
		"Content-Type":        false,
		"X-Request-Id":        false,
	}
	for name, want := range cases {
		if got := IsSensitiveHeader(name); got != want {
			t.Errorf("IsSensitiveHeader(%q) = %v, want %v", name, got, want)
		}
	}
}

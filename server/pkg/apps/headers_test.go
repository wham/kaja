package apps

import (
	"net/http"
	"testing"
)

func TestSurfaceHeaders(t *testing.T) {
	header := http.Header{
		"Authorization": {"Bearer secret"},
		"Accept":        {"application/json"},
		"Set-Cookie":    {"a=1", "b=2"},
	}

	got := SurfaceHeaders(header)

	if got["Authorization"] != "Bearer secret" {
		t.Errorf("Authorization = %q, want %q", got["Authorization"], "Bearer secret")
	}
	if got["Accept"] != "application/json" {
		t.Errorf("Accept = %q, want application/json", got["Accept"])
	}
	if got["Set-Cookie"] != "a=1, b=2" {
		t.Errorf("Set-Cookie = %q, want joined values", got["Set-Cookie"])
	}
}

func TestSurfaceHeadersEmpty(t *testing.T) {
	if got := SurfaceHeaders(nil); got != nil {
		t.Errorf("SurfaceHeaders(nil) = %v, want nil", got)
	}
}

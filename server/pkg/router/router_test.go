package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/api"
)

// The desktop mounts one more lane than this: a door that forwards whatever URL a
// caller names. A deployed kaja must not be a proxy for arbitrary URLs, so what the
// web serves is the two lanes and nothing else — a fetch there is the browser's own.
func TestTheWebHasNoDoorThatForwardsAnyURL(t *testing.T) {
	mux := http.NewServeMux()
	Mount(mux, api.NewApiService(t.TempDir()+"/kaja.json", true, "", "", nil))

	// Nothing is registered under it, so the mux has nowhere to send it.
	request := httptest.NewRequest("POST", "/fetch", strings.NewReader(""))
	request.Header.Set("X-Kaja-Fetch-Url", "https://api.example.com/orders")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("POST /fetch = %d, want 404", response.Code)
	}
}

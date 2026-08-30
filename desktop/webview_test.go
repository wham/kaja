package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/api"
)

// The window fetches its calls the way a browser does, so the handler it is given
// has to answer the same two lanes the web server does and leave everything else
// to the UI.
func TestWebviewHandlerServesTheCallLanesAndTheUI(t *testing.T) {
	configurationPath := filepath.Join(t.TempDir(), "kaja.json")
	if err := os.WriteFile(configurationPath, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	assets := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("the UI"))
	})
	handler := webviewHandler(api.NewApiService(configurationPath, true, "", "", nil), assets)

	// A gRPC-Web-text request body is one base64 blob: the five-byte frame header of
	// an empty message, which is what GetConfiguration takes.
	request := httptest.NewRequest("POST", "/Api/GetConfiguration", strings.NewReader("AAAAAAA="))
	request.Header.Set("Content-Type", "application/grpc-web-text")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("POST /Api/GetConfiguration = %d, want 200", response.Code)
	}
	if got := response.Header().Get("Content-Type"); got != "application/grpc-web+proto" {
		t.Fatalf("Content-Type = %q", got)
	}
	if !strings.Contains(response.Body.String(), "grpc-status: 0") {
		t.Fatalf("no OK trailer in %q", response.Body.String())
	}

	// No app named "nothing", so the app lane refuses the call rather than falling
	// through to the UI and answering a protobuf with HTML.
	request = httptest.NewRequest("POST", "/app/seating.Seating/GetSeatMap", strings.NewReader("AAAAAAA="))
	request.Header.Set("Content-Type", "application/grpc-web-text")
	request.Header.Set("X-Header-X-Kaja-App", "nothing")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if body := response.Body.String(); strings.Contains(body, "the UI") {
		t.Fatalf("POST /app/… reached the assets: %q", body)
	}

	// Everything else is the UI's. The Api lane is POST-only, so a GET under it is
	// the assets' too rather than a call that lost its body.
	for _, path := range []string{"/", "/main.js", "/Api/GetConfiguration"} {
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Body.String() != "the UI" {
			t.Fatalf("GET %s = %q, want the assets", path, response.Body.String())
		}
	}
}

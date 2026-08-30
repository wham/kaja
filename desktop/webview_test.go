package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/api"
)

// The window fetches everything the way a browser does, so the handler it is given
// has to answer the same lanes the web server does — the two call lanes and the agent
// switchboard it offers itself to — and leave everything else to the UI.
func TestWebviewHandlerServesTheCallLanesAndTheUI(t *testing.T) {
	configurationPath := filepath.Join(t.TempDir(), "kaja.json")
	if err := os.WriteFile(configurationPath, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	assets := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("the UI"))
	})
	kaja := NewApp(api.NewApiService(configurationPath, true, "", "", nil), nil, t.TempDir())
	handler := webviewHandler(kaja.api, kaja.agents, assets)

	// A gRPC-Web request body is binary frames: five zero bytes are the header of an
	// empty message, which is what GetConfiguration takes.
	emptyMessage := func() *bytes.Reader { return bytes.NewReader(make([]byte, 5)) }
	request := httptest.NewRequest("POST", "/Api/GetConfiguration", emptyMessage())
	request.Header.Set("Content-Type", "application/grpc-web+proto")
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
	request = httptest.NewRequest("POST", "/app/seating.Seating/GetSeatMap", emptyMessage())
	request.Header.Set("Content-Type", "application/grpc-web+proto")
	request.Header.Set("X-Header-X-Kaja-App", "nothing")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if body := response.Body.String(); strings.Contains(body, "the UI") {
		t.Fatalf("POST /app/… reached the assets: %q", body)
	}

	// The lane only the desktop has. Named no target, it refuses the call rather than
	// falling through to the UI and answering a script's fetch with HTML.
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("POST", fetchPath, nil))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("POST %s = %d, want 400", fetchPath, response.Code)
	}
	if response.Header().Get(fetchErrorHeader) == "" {
		t.Fatalf("POST %s was refused without saying why", fetchPath)
	}

	// The switchboard the window offers itself over. Nameless, it is refused rather
	// than falling through to the UI and answering the stream with HTML.
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("POST", "/agent-session/attach", nil))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("POST /agent-session/attach = %d, want 400", response.Code)
	}

	// Everything else is the UI's. The Api lane is POST-only, so a GET under it is
	// the assets' too rather than a call that lost its body. So is a GET on the fetch
	// lane, which is POST-only for the same reason.
	for _, path := range []string{"/", "/main.js", "/Api/GetConfiguration", fetchPath} {
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Body.String() != "the UI" {
			t.Fatalf("GET %s = %q, want the assets", path, response.Body.String())
		}
	}
}

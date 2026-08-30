package twirp

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wham/kaja/v2/pkg/apps"
)

// openTestApp opens a twirp app against a fake upstream and returns the live
// instance the manager would have registered.
func openTestApp(t *testing.T, url string) *instance {
	t.Helper()
	opened, err := New().Open(map[string]string{"url": url, "proto_dir": "quirks/proto"}, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if opened.Instance == nil {
		t.Fatal("expected an in-process instance")
	}
	if opened.ProtoDir != "quirks/proto" {
		t.Errorf("expected the configured proto directory, got %q", opened.ProtoDir)
	}
	return opened.Instance.(*instance)
}

func TestOpenRequiresUrlAndProtoDir(t *testing.T) {
	if _, err := New().Open(map[string]string{"proto_dir": "p"}, t.TempDir(), func(string) {}); err == nil {
		t.Error("expected an error for a missing url")
	}
	if _, err := New().Open(map[string]string{"url": "https://example.com"}, t.TempDir(), func(string) {}); err == nil {
		t.Error("expected an error for a missing proto_dir")
	}
}

// The bytes the client framed are the bytes the server gets: there is nothing to
// transcode, so a Twirp method is a POST of the request message verbatim.
func TestInvokePostsTheRequestVerbatim(t *testing.T) {
	var gotPath, gotMethod, gotContentType, gotAuthorization string
	var gotBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod = r.URL.Path, r.Method
		gotContentType = r.Header.Get("Content-Type")
		gotAuthorization = r.Header.Get("Authorization")
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("X-Request-Id", "abc123")
		w.Write([]byte{0x08, 0x05})
	}))
	defer server.Close()

	in := openTestApp(t, server.URL)
	result, err := invoke(in, "quirks.v1.Quirks/Sum", []byte{0x08, 0x02, 0x10, 0x03}, map[string]string{"Authorization": "Bearer t"})
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("expected a POST, got %s", gotMethod)
	}
	if gotPath != "/twirp/quirks.v1.Quirks/Sum" {
		t.Errorf("expected the twirp path, got %q", gotPath)
	}
	if gotContentType != contentType {
		t.Errorf("expected %q, got %q", contentType, gotContentType)
	}
	if gotAuthorization != "Bearer t" {
		t.Errorf("expected the app's header to be forwarded, got %q", gotAuthorization)
	}
	if string(gotBody) != string([]byte{0x08, 0x02, 0x10, 0x03}) {
		t.Errorf("expected the request bytes verbatim, got %v", gotBody)
	}
	if string(result.Body) != string([]byte{0x08, 0x05}) {
		t.Errorf("expected the response bytes verbatim, got %v", result.Body)
	}
	if result.ResponseHeaders["X-Request-Id"] != "abc123" {
		t.Errorf("expected the exchanged response headers, got %v", result.ResponseHeaders)
	}
	if result.RequestHeaders["Authorization"] == "" {
		t.Errorf("expected the exchanged request headers, got %v", result.RequestHeaders)
	}
}

// A header the app configures under a name kaja would set outranks kaja's, the rule
// every app applies to what it sets itself.
func TestConfiguredContentTypeOutranksTheDefault(t *testing.T) {
	var gotContentType string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotContentType = r.Header.Get("Content-Type")
	}))
	defer server.Close()

	in := openTestApp(t, server.URL)
	if _, err := invoke(in, "quirks.v1.Quirks/Sum", nil, map[string]string{"Content-Type": "application/json"}); err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if gotContentType != "application/json" {
		t.Errorf("expected the configured content type, got %q", gotContentType)
	}
}

// A Twirp error is an HTTP failure carrying a JSON body, so it is reported as the
// HTTP call that failed - with the exchanged headers, which is where a 401 explains
// itself - and its "msg" is the summary.
func TestTwirpErrorIsReportedAsAnUpstreamFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("WWW-Authenticate", "Bearer")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"code":"unauthenticated","msg":"token expired"}`))
	}))
	defer server.Close()

	in := openTestApp(t, server.URL)
	_, err := invoke(in, "quirks.v1.Quirks/Sum", nil, nil)

	var upstream *apps.UpstreamError
	if !errors.As(err, &upstream) {
		t.Fatalf("expected an UpstreamError, got %v", err)
	}
	if upstream.Status != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", upstream.Status)
	}
	if upstream.Message != "token expired" {
		t.Errorf("expected the twirp msg as the summary, got %q", upstream.Message)
	}
	if upstream.URL != server.URL+"/twirp/quirks.v1.Quirks/Sum" {
		t.Errorf("expected the request line to name the call, got %q", upstream.URL)
	}
	if upstream.ResponseHeaders["Www-Authenticate"] == "" {
		t.Errorf("expected the exchanged response headers, got %v", upstream.ResponseHeaders)
	}
}

// A bare host:port is http, the way it always was, and a trailing slash does not
// double up against the one the twirp path brings.
func TestBaseURL(t *testing.T) {
	for _, test := range []struct{ in, want string }{
		{"https://example.com", "https://example.com"},
		{"https://example.com/", "https://example.com"},
		{"https://example.com/api/", "https://example.com/api"},
		{"localhost:8080", "http://localhost:8080"},
		{"http://localhost:8080/", "http://localhost:8080"},
	} {
		if got := baseURL(test.in); got != test.want {
			t.Errorf("baseURL(%q) = %q, want %q", test.in, got, test.want)
		}
	}
}

// invoked is one call as these tests read it. Every app here answers with one message,
// so the stream a call hands back is collapsed to that message and the report beside it.
type invoked struct {
	Body            []byte
	RequestHeaders  map[string]string
	ResponseHeaders map[string]string
}

func invoke(in *instance, method string, request []byte, headers map[string]string) (*invoked, error) {
	stream, err := in.Invoke(context.Background(), &apps.Call{Method: method, Request: request, Headers: headers})
	if err != nil {
		return nil, err
	}
	body, err := stream.Recv()
	if err != nil {
		return nil, err
	}
	result := &invoked{Body: body}
	if report := stream.Report(); report != nil {
		result.RequestHeaders = report.RequestHeaders
		result.ResponseHeaders = report.ResponseHeaders
	}
	return result, nil
}

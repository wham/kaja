package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func laneRequest(target, method string, body string, headers map[string]string) *http.Request {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest("POST", fetchPath, reader)
	request.Header.Set(fetchURLHeader, target)
	request.Header.Set(fetchMethodHeader, method)
	for name, value := range headers {
		request.Header.Set(fetchHeaderPrefix+name, value)
	}
	return request
}

func lane() http.Handler {
	mux := http.NewServeMux()
	mountFetch(mux, &http.Client{})
	return mux
}

func TestFetchForwardsTheRequestAndAnswersWithTheAPIsOwnResponse(t *testing.T) {
	var got *http.Request
	var gotBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		read, _ := io.ReadAll(r.Body)
		gotBody = string(read)
		w.Header().Set("X-Request-Id", "r1")
		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"id":1}`))
	}))
	defer upstream.Close()

	response := httptest.NewRecorder()
	lane().ServeHTTP(response, laneRequest(upstream.URL+"/orders", "POST", `{"name":"x"}`, map[string]string{
		"Authorization": "Bearer t",
		"Content-Type":  "application/json",
	}))

	if got.Method != "POST" {
		t.Fatalf("upstream method = %q, want POST", got.Method)
	}
	if got.URL.Path != "/orders" {
		t.Fatalf("upstream path = %q", got.URL.Path)
	}
	if gotBody != `{"name":"x"}` {
		t.Fatalf("upstream body = %q", gotBody)
	}
	if got.Header.Get("Authorization") != "Bearer t" {
		t.Fatalf("the script's header did not reach the API: %q", got.Header.Get("Authorization"))
	}
	if got.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("Content-Type = %q", got.Header.Get("Content-Type"))
	}

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", response.Code)
	}
	if response.Header().Get("X-Request-Id") != "r1" {
		t.Fatalf("the API's own header is not on the response: %v", response.Header())
	}
	if response.Body.String() != `{"id":1}` {
		t.Fatalf("body = %q", response.Body.String())
	}
	if response.Header().Get(fetchErrorHeader) != "" {
		t.Fatalf("a response is not a failure: %q", response.Header().Get(fetchErrorHeader))
	}
	if response.Header().Get(fetchURLHeader) != upstream.URL+"/orders" {
		t.Fatalf("final URL = %q", response.Header().Get(fetchURLHeader))
	}
}

// A GET is a GET upstream: an empty body on the lane must not become a chunked one.
func TestFetchSendsNoBodyWhereThereIsNone(t *testing.T) {
	var length int64 = -2
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		length = r.ContentLength
		w.Write([]byte("ok"))
	}))
	defer upstream.Close()

	response := httptest.NewRecorder()
	lane().ServeHTTP(response, laneRequest(upstream.URL+"/status", "GET", "", nil))

	if length != 0 {
		t.Fatalf("upstream Content-Length = %d, want 0", length)
	}
	if response.Body.String() != "ok" {
		t.Fatalf("body = %q", response.Body.String())
	}
}

// The API's own failure is a response, so it comes back as one: the row goes red on
// the status, and the script still reads what the API sent.
func TestFetchCarriesAnAPIsOwnFailureAsAResponse(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte(`{"error":"upstream"}`))
	}))
	defer upstream.Close()

	response := httptest.NewRecorder()
	lane().ServeHTTP(response, laneRequest(upstream.URL, "GET", "", nil))

	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", response.Code)
	}
	if response.Header().Get(fetchErrorHeader) != "" {
		t.Fatalf("the API answered, so nothing failed: %q", response.Header().Get(fetchErrorHeader))
	}
	if response.Body.String() != `{"error":"upstream"}` {
		t.Fatalf("body = %q", response.Body.String())
	}
}

// A request that never completed. The header is what tells it from the status above,
// and the message is what "Load failed" never said.
func TestFetchReportsARequestThatNeverCompleted(t *testing.T) {
	response := httptest.NewRecorder()
	lane().ServeHTTP(response, laneRequest("http://127.0.0.1:1/nothing", "GET", "", nil))

	failure := response.Header().Get(fetchErrorHeader)
	if failure == "" {
		t.Fatal("an unreachable host is a failure of the lane, not a response")
	}
	if strings.ContainsAny(failure, "\r\n") {
		t.Fatalf("a header value with a newline in it: %q", failure)
	}
}

// The message rides as a header, and a header value is a byte string the Fetch API
// reads as Latin-1: the UTF-8 of a host, a certificate or an OS error with an accent
// in it arrives mangled, and a newline in one would be a second header. So it is
// percent-encoded, and the reader undoes it.
func TestFetchEscapesWhatAHeaderValueCannotCarry(t *testing.T) {
	message := "dial tcp: lookup café.example.com:\r\nno such host (100%)"

	response := httptest.NewRecorder()
	fetchFailed(response, http.StatusBadGateway, message)

	failure := response.Header().Get(fetchErrorHeader)
	for i := 0; i < len(failure); i++ {
		if failure[i] < 0x20 || failure[i] > 0x7e {
			t.Fatalf("byte %d of %q is not one a header value carries", i, failure)
		}
	}
	decoded, err := url.PathUnescape(failure)
	if err != nil {
		t.Fatalf("the reader cannot undo it: %v", err)
	}
	if decoded != message {
		t.Fatalf("decoded = %q, want the message as it was written", decoded)
	}
}

func TestFetchRefusesWhatAPageCouldNotAskForItself(t *testing.T) {
	for _, target := range []string{"", "file:///etc/passwd", "wails://localhost/main.js"} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest("POST", fetchPath, nil)
		request.Header.Set(fetchURLHeader, target)
		lane().ServeHTTP(response, request)

		if response.Code != http.StatusBadRequest {
			t.Fatalf("%q = %d, want 400", target, response.Code)
		}
		if response.Header().Get(fetchErrorHeader) == "" {
			t.Fatalf("%q was refused without saying why", target)
		}
	}
}

// Kaja's own channel is kaja's: an API that writes it must not be able to say where
// the response came from or that the call failed.
func TestFetchStripsItsOwnChannelFromWhatTheAPISent(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(fetchErrorHeader, "not really")
		w.Header().Set(fetchURLHeader, "https://elsewhere.example.com/")
		w.Write([]byte("ok"))
	}))
	defer upstream.Close()

	response := httptest.NewRecorder()
	lane().ServeHTTP(response, laneRequest(upstream.URL+"/thing", "GET", "", nil))

	if response.Header().Get(fetchErrorHeader) != "" {
		t.Fatalf("the API wrote kaja's failure channel: %q", response.Header().Get(fetchErrorHeader))
	}
	if response.Header().Get(fetchURLHeader) != upstream.URL+"/thing" {
		t.Fatalf("final URL = %q", response.Header().Get(fetchURLHeader))
	}
}

// A 307 keeps the verb and the body, so the body has to be sendable twice.
func TestFetchReplaysABodyAcrossARedirectThatKeepsIt(t *testing.T) {
	var landed string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/old" {
			http.Redirect(w, r, "/new", http.StatusTemporaryRedirect)
			return
		}
		read, _ := io.ReadAll(r.Body)
		landed = r.Method + " " + string(read)
	}))
	defer upstream.Close()

	response := httptest.NewRecorder()
	lane().ServeHTTP(response, laneRequest(upstream.URL+"/old", "POST", `{"name":"x"}`, nil))

	if response.Header().Get(fetchErrorHeader) != "" {
		t.Fatalf("the redirect was not followed: %q", response.Header().Get(fetchErrorHeader))
	}
	if landed != `POST {"name":"x"}` {
		t.Fatalf("upstream saw %q", landed)
	}
}

func TestFetchFollowsARedirectAndSaysWhereItLanded(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/old" {
			http.Redirect(w, r, "/new", http.StatusFound)
			return
		}
		w.Write([]byte("moved"))
	}))
	defer upstream.Close()

	response := httptest.NewRecorder()
	lane().ServeHTTP(response, laneRequest(upstream.URL+"/old", "GET", "", nil))

	if response.Body.String() != "moved" {
		t.Fatalf("body = %q", response.Body.String())
	}
	if response.Header().Get(fetchURLHeader) != upstream.URL+"/new" {
		t.Fatalf("final URL = %q", response.Header().Get(fetchURLHeader))
	}
}

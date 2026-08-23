package grpc

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/wham/kaja/v2/pkg/apps"
)

// grpcWebTextFrame builds a base64 gRPC-Web-text request body wrapping msg.
func grpcWebTextFrame(msg []byte) string {
	frame := make([]byte, 5+len(msg))
	binary.BigEndian.PutUint32(frame[1:5], uint32(len(msg)))
	copy(frame[5:], msg)
	return base64.StdEncoding.EncodeToString(frame)
}

// parseGRPCWebText splits a base64 gRPC-Web-text response into its data message
// (may be nil) and trailer text.
func parseGRPCWebText(t *testing.T, body string) (message []byte, trailers string) {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		t.Fatalf("decode base64: %v", err)
	}
	for len(raw) >= 5 {
		flag := raw[0]
		n := binary.BigEndian.Uint32(raw[1:5])
		payload := raw[5 : 5+n]
		if flag&0x80 != 0 {
			trailers = string(payload)
		} else {
			message = payload
		}
		raw = raw[5+n:]
	}
	return message, trailers
}

func serveText(method string, body string, invoke AppInvoker) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/target/"+method, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/grpc-web-text")
	w := httptest.NewRecorder()
	ServeAppGRPCWeb(w, r, method, invoke, nil)
	return w
}

func TestServeAppGRPCWebSuccess(t *testing.T) {
	var gotMethod string
	var gotMessage []byte
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1, 2, 3}), func(method string, message []byte, headers map[string]string) (*apps.InvokeResult, error) {
		gotMethod = method
		gotMessage = message
		return &apps.InvokeResult{Body: []byte{9, 8, 7}}, nil
	})

	if gotMethod != "svc/Method" {
		t.Errorf("method = %q, want svc/Method", gotMethod)
	}
	if string(gotMessage) != string([]byte{1, 2, 3}) {
		t.Errorf("de-framed message = %v, want [1 2 3]", gotMessage)
	}

	message, trailers := parseGRPCWebText(t, w.Body.String())
	if string(message) != string([]byte{9, 8, 7}) {
		t.Errorf("response message = %v, want [9 8 7]", message)
	}
	if !strings.Contains(trailers, "grpc-status: 0") {
		t.Errorf("trailers = %q, want grpc-status: 0", trailers)
	}
}

// TestServeAppGRPCWebUpstreamDuration locks in that the invocation's server-side
// timing rides its own trailer, on the success and the failure alike, so the
// client can show the API's time instead of its own round trip.
func TestServeAppGRPCWebUpstreamDuration(t *testing.T) {
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) (*apps.InvokeResult, error) {
		return &apps.InvokeResult{Body: []byte{9}, DurationMs: 42}, nil
	})
	_, trailers := parseGRPCWebText(t, w.Body.String())
	if got := trailerValue(t, trailers, "kaja-upstream-duration-ms"); got != "42" {
		t.Errorf("duration trailer = %q, want 42", got)
	}

	w = serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) (*apps.InvokeResult, error) {
		failure := apps.NewUpstreamError(http.MethodGet, "https://api.example.com/x", http.StatusNotFound, nil)
		failure.DurationMs = 17
		return nil, failure
	})
	_, trailers = parseGRPCWebText(t, w.Body.String())
	if got := trailerValue(t, trailers, "kaja-upstream-duration-ms"); got != "17" {
		t.Errorf("duration trailer on failure = %q, want 17", got)
	}
}

// TestServeAppGRPCWebUpstreamHeaders locks in that an app's exchanged upstream
// headers are surfaced as their own JSON trailers alongside the response.
func TestServeAppGRPCWebUpstreamHeaders(t *testing.T) {
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) (*apps.InvokeResult, error) {
		return &apps.InvokeResult{
			Body:            []byte{9},
			RequestHeaders:  map[string]string{"Authorization": "Bearer secret"},
			ResponseHeaders: map[string]string{"Content-Type": "application/json"},
		}, nil
	})

	_, trailers := parseGRPCWebText(t, w.Body.String())
	if !strings.Contains(trailers, `kaja-upstream-request-headers: {"Authorization":"Bearer secret"}`) {
		t.Errorf("trailers = %q, want request-headers trailer", trailers)
	}
	if !strings.Contains(trailers, `kaja-upstream-response-headers: {"Content-Type":"application/json"}`) {
		t.Errorf("trailers = %q, want response-headers trailer", trailers)
	}
}

func TestServeAppGRPCWebError(t *testing.T) {
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) (*apps.InvokeResult, error) {
		return nil, fmt.Errorf("upstream 404\nnot found")
	})

	message, trailers := parseGRPCWebText(t, w.Body.String())
	if message != nil {
		t.Errorf("expected no data frame on error, got %v", message)
	}
	if !strings.Contains(trailers, "grpc-status: 2") {
		t.Errorf("trailers = %q, want grpc-status: 2", trailers)
	}
	if got := trailerValue(t, trailers, "grpc-message"); got != "upstream 404\nnot found" {
		t.Errorf("grpc-message = %q, want the message round-tripped intact", got)
	}
	// The newline is escaped rather than dropped, so it cannot end the line early
	// and the message still reads as it was written once decoded.
	if strings.Count(trailers, "\n") != 2 {
		t.Errorf("grpc-message newline not escaped: %q", trailers)
	}
}

// TestServeAppGRPCWebUpstreamError locks in that an apps.UpstreamError maps to
// the matching gRPC status and that the failure itself — the status, message,
// request line and body the client shows instead of the gRPC error — rides whole
// in its own trailer.
func TestServeAppGRPCWebUpstreamError(t *testing.T) {
	body := `{"title":"Bad Request","detail":"request body has an error"}`
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) (*apps.InvokeResult, error) {
		return nil, apps.NewUpstreamError(http.MethodPost, "https://api.example.com/v1/events", http.StatusBadRequest, []byte(body)).
			WithHeaders(map[string]string{"Authorization": "Bearer secret"}, map[string]string{"Content-Type": "application/json"})
	})

	message, trailers := parseGRPCWebText(t, w.Body.String())
	if message != nil {
		t.Errorf("expected no data frame on error, got %v", message)
	}
	if !strings.Contains(trailers, "grpc-status: 3") {
		t.Errorf("trailers = %q, want grpc-status: 3 (INVALID_ARGUMENT)", trailers)
	}
	if !strings.Contains(trailers, "request body has an error") {
		t.Errorf("trailers = %q, want extracted message", trailers)
	}

	failure := map[string]any{}
	if err := json.Unmarshal([]byte(trailerValue(t, trailers, "kaja-upstream-error")), &failure); err != nil {
		t.Fatalf("upstream error trailer: %v\ntrailers = %q", err, trailers)
	}
	if failure["status"] != float64(400) || failure["statusText"] != "Bad Request" {
		t.Errorf("upstream error status = %v/%v, want 400/Bad Request", failure["status"], failure["statusText"])
	}
	if failure["message"] != "request body has an error" {
		t.Errorf("upstream error message = %v", failure["message"])
	}
	if failure["request"] != "POST https://api.example.com/v1/events" {
		t.Errorf("upstream error request = %v", failure["request"])
	}
	// The body stays JSON rather than a string of JSON, so the console shows it
	// as a value instead of an escaped blob.
	if nested, ok := failure["body"].(map[string]any); !ok || nested["title"] != "Bad Request" {
		t.Errorf("upstream error body = %#v, want the parsed problem document", failure["body"])
	}

	// The exchanged headers ride along on the error too (a 401/4xx is exactly
	// when they matter).
	if !strings.Contains(trailers, `kaja-upstream-request-headers: {"Authorization":"Bearer secret"}`) {
		t.Errorf("trailers = %q, want request-headers trailer on error", trailers)
	}
	if !strings.Contains(trailers, `kaja-upstream-response-headers: {"Content-Type":"application/json"}`) {
		t.Errorf("trailers = %q, want response-headers trailer on error", trailers)
	}
}

// TestTrailerValuesSurviveNonASCII locks in that a value with characters outside
// printable ASCII reaches the client intact. gRPC-Web trailers are a text block
// clients read byte by byte as Latin-1, so an unescaped em dash arrives as
// "â€"" — which is what used to show up in the console.
func TestTrailerValuesSurviveNonASCII(t *testing.T) {
	const detail = `no show "glass-mountainz" — list them all`
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) (*apps.InvokeResult, error) {
		return nil, apps.NewUpstreamError(http.MethodGet, "https://api.example.com/shows/x", http.StatusNotFound,
			[]byte(`{"detail":`+strconv.Quote(detail)+`}`))
	})

	_, trailers := parseGRPCWebText(t, w.Body.String())
	for _, line := range strings.Split(trailers, "\r\n") {
		for i := 0; i < len(line); i++ {
			if line[i] > 0x7e {
				t.Fatalf("trailer line is not ASCII: %q", line)
			}
		}
	}

	failure := map[string]any{}
	if err := json.Unmarshal([]byte(trailerValue(t, trailers, "kaja-upstream-error")), &failure); err != nil {
		t.Fatalf("upstream error trailer: %v", err)
	}
	if failure["message"] != detail {
		t.Errorf("message = %q, want %q", failure["message"], detail)
	}
}

// trailerValue reads one trailer by name, undoing the percent-escaping the
// client undoes with decodeURIComponent.
func trailerValue(t *testing.T, trailers string, name string) string {
	t.Helper()
	for _, line := range strings.Split(trailers, "\r\n") {
		key, value, found := strings.Cut(line, ": ")
		if !found || key != name {
			continue
		}
		decoded, err := url.QueryUnescape(value)
		if err != nil {
			t.Fatalf("trailer %q is not valid percent-encoding: %v", name, err)
		}
		return decoded
	}
	t.Fatalf("trailer %q missing from %q", name, trailers)
	return ""
}

func TestGRPCStatusFromHTTP(t *testing.T) {
	tests := map[int]int{400: 3, 401: 16, 403: 7, 404: 5, 409: 10, 429: 8, 418: 2, 500: 13, 501: 12, 502: 13, 503: 14, 504: 4}
	for httpStatus, want := range tests {
		if got := grpcStatusFromHTTP(httpStatus); got != want {
			t.Errorf("grpcStatusFromHTTP(%d) = %d, want %d", httpStatus, got, want)
		}
	}
}

// TestTrailerBlockIsBounded locks in that nothing an upstream sends can decide how big
// the trailer block gets. The failure is written before the headers that describe the
// hop, so a header set too big to carry is what gets left behind.
func TestTrailerBlockIsBounded(t *testing.T) {
	huge := strings.Repeat("x", 4*maxTrailerBytes)
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) (*apps.InvokeResult, error) {
		return nil, apps.NewUpstreamError(http.MethodGet, "https://api.example.com/x", http.StatusBadGateway, []byte(`{"detail":"gone"}`)).
			WithHeaders(map[string]string{"X-Huge": huge}, map[string]string{"X-Also-Huge": huge})
	})

	_, trailers := parseGRPCWebText(t, w.Body.String())
	if len(trailers) > maxTrailerBytes {
		t.Errorf("trailer block is %d bytes, want at most %d", len(trailers), maxTrailerBytes)
	}
	if !strings.Contains(trailers, "grpc-status: 13") {
		t.Errorf("trailers = %q, want the status to survive", trailers[:200])
	}
	// The failure is the one trailer that has to get through.
	failure := map[string]any{}
	if err := json.Unmarshal([]byte(trailerValue(t, trailers, "kaja-upstream-error")), &failure); err != nil {
		t.Fatalf("upstream error trailer: %v", err)
	}
	if failure["message"] != "gone" {
		t.Errorf("upstream error message = %v", failure["message"])
	}
	if strings.Contains(trailers, "X-Also-Huge") {
		t.Errorf("a header trailer that could not fit should be dropped whole")
	}
}

// grpc-message is cut before it is escaped, and escaping can triple what it is given,
// so the cut has to leave room for that.
func TestLongGRPCMessageFitsOnceEscaped(t *testing.T) {
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) (*apps.InvokeResult, error) {
		return nil, fmt.Errorf("%s", strings.Repeat("→", 4*maxTrailerBytes))
	})

	_, trailers := parseGRPCWebText(t, w.Body.String())
	if len(trailers) > maxTrailerBytes {
		t.Errorf("trailer block is %d bytes, want at most %d", len(trailers), maxTrailerBytes)
	}
	if !utf8.ValidString(trailerValue(t, trailers, "grpc-message")) {
		t.Error("the truncated message is not valid UTF-8")
	}
}

// A dropped trailer is dropped whole: a value cut in half would reach the client as
// JSON it cannot parse, which is worse than the trailer never arriving.
func TestOversizedTrailerIsDroppedNotCut(t *testing.T) {
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) (*apps.InvokeResult, error) {
		return &apps.InvokeResult{
			Body:           []byte{9},
			RequestHeaders: map[string]string{"X-Huge": strings.Repeat("y", 4*maxTrailerBytes)},
		}, nil
	})

	message, trailers := parseGRPCWebText(t, w.Body.String())
	if string(message) != string([]byte{9}) {
		t.Errorf("the response itself must be unaffected, got %v", message)
	}
	for _, line := range strings.Split(trailers, "\r\n") {
		if line == "" {
			continue
		}
		if _, _, found := strings.Cut(line, ": "); !found {
			t.Errorf("trailer line is not whole: %q", line)
		}
	}
	if strings.Contains(trailers, "X-Huge") {
		t.Errorf("trailers = %q, want the oversized one dropped", trailers)
	}
}

func TestCutKeepsRunesWhole(t *testing.T) {
	if got := cut("hello", 10); got != "hello" {
		t.Errorf("cut under the limit = %q", got)
	}
	// "é" is two bytes: cutting at 2 must not leave half of it behind.
	if got := cut("aé", 2); got != "a" {
		t.Errorf("cut = %q, want the partial rune dropped", got)
	}
	if !utf8.ValidString(cut(strings.Repeat("→", 100), 55)) {
		t.Error("cut produced invalid UTF-8")
	}
}

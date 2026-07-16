package grpc

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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

// TestServeAppGRPCWebUpstreamHeaders locks in that an app's exchanged upstream
// headers are surfaced as their own JSON trailers alongside the response.
func TestServeAppGRPCWebUpstreamHeaders(t *testing.T) {
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) (*apps.InvokeResult, error) {
		return &apps.InvokeResult{
			Body:            []byte{9},
			RequestHeaders:  map[string]string{"Authorization": apps.RedactedValue},
			ResponseHeaders: map[string]string{"Content-Type": "application/json"},
		}, nil
	})

	_, trailers := parseGRPCWebText(t, w.Body.String())
	if !strings.Contains(trailers, `kaja-upstream-request-headers: {"Authorization":"<redacted>"}`) {
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
	if !strings.Contains(trailers, "upstream 404 not found") {
		t.Errorf("trailers = %q, want sanitized grpc-message", trailers)
	}
	if strings.Count(trailers, "\n") != 2 {
		t.Errorf("grpc-message newline not sanitized: %q", trailers)
	}
}

// TestServeAppGRPCWebUpstreamError locks in that an apps.UpstreamError maps to
// the matching gRPC status with the extracted message, and that the raw
// upstream body rides in its own trailer.
func TestServeAppGRPCWebUpstreamError(t *testing.T) {
	body := `{"title":"Bad Request","detail":"request body has an error"}`
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) (*apps.InvokeResult, error) {
		return nil, apps.NewUpstreamError(http.MethodPost, "https://api.example.com/v1/events", http.StatusBadRequest, []byte(body))
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
	if !strings.Contains(trailers, "upstream-body: "+body) {
		t.Errorf("trailers = %q, want upstream-body trailer", trailers)
	}
}

func TestGRPCStatusFromHTTP(t *testing.T) {
	tests := map[int]int{400: 3, 401: 16, 403: 7, 404: 5, 409: 10, 429: 8, 418: 2, 500: 13, 501: 12, 502: 13, 503: 14, 504: 4}
	for httpStatus, want := range tests {
		if got := grpcStatusFromHTTP(httpStatus); got != want {
			t.Errorf("grpcStatusFromHTTP(%d) = %d, want %d", httpStatus, got, want)
		}
	}
}

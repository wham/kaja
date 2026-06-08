package grpc

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1, 2, 3}), func(method string, message []byte, headers map[string]string) ([]byte, error) {
		gotMethod = method
		gotMessage = message
		return []byte{9, 8, 7}, nil
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

func TestServeAppGRPCWebError(t *testing.T) {
	w := serveText("svc/Method", grpcWebTextFrame([]byte{1}), func(string, []byte, map[string]string) ([]byte, error) {
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

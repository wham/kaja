package grpc

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func serveService(method string, body string, invoke ServiceInvoker) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/Api/"+method, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/grpc-web-text")
	w := httptest.NewRecorder()
	ServeGRPCWeb(w, r, method, invoke)
	return w
}

func TestServeGRPCWebSuccess(t *testing.T) {
	var got string
	w := serveService("GetConfiguration", grpcWebTextFrame([]byte("request")), func(_ context.Context, methodPath string, message []byte) ([]byte, error) {
		got = methodPath + " " + string(message)
		return []byte("response"), nil
	})

	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	if got != "GetConfiguration request" {
		t.Errorf("invoked %q", got)
	}
	message, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
	if string(message) != "response" {
		t.Errorf("message %q", message)
	}
	if !strings.Contains(trailers, "grpc-status: 0") {
		t.Errorf("trailers %q", trailers)
	}
}

// A plain Go error is UNKNOWN, and one carrying a status keeps the code it named.
func TestServeGRPCWebError(t *testing.T) {
	for _, test := range []struct {
		err  error
		want string
	}{
		{errors.New("failed to save configuration"), "grpc-status: 2"},
		{status.Error(codes.InvalidArgument, "failed to save configuration"), "grpc-status: 3"},
	} {
		w := serveService("UpdateConfiguration", grpcWebTextFrame(nil), func(context.Context, string, []byte) ([]byte, error) {
			return nil, test.err
		})

		message, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
		if message != nil {
			t.Errorf("got a message on a failure: %q", message)
		}
		if !strings.Contains(trailers, test.want) {
			t.Errorf("trailers %q, want %q", trailers, test.want)
		}
		if !strings.Contains(trailers, "grpc-message: failed to save configuration") {
			t.Errorf("trailers %q", trailers)
		}
	}
}

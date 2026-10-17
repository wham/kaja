package mcp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A request body past the cap is a parse error rather than memory spent on it.
func TestRequestBodyIsCapped(t *testing.T) {
	server := NewServer(newFakeBridge(), token, version)
	body := `{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"` + strings.Repeat("x", maxRequestBody) + `"}}`
	request := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if !strings.Contains(recorder.Body.String(), "parse error") {
		t.Fatalf("expected the oversized body to be refused as a parse error, got %s", recorder.Body.String())
	}
}

package apps

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestUpstreamMessage(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{
			name:   "problem+json detail",
			status: 400,
			body:   `{"type":"about:blank","title":"Bad Request","status":400,"detail":"request body has an error: doesn't match schema"}`,
			want:   "request body has an error: doesn't match schema",
		},
		{
			name:   "problem+json title only",
			status: 400,
			body:   `{"type":"about:blank","title":"Bad Request","status":400}`,
			want:   "Bad Request",
		},
		{
			name:   "message envelope",
			status: 422,
			body:   `{"message":"name is required"}`,
			want:   "name is required",
		},
		{
			name:   "error string envelope",
			status: 500,
			body:   `{"error":"boom"}`,
			want:   "boom",
		},
		{
			name:   "error object envelope",
			status: 401,
			body:   `{"error":{"message":"invalid api key","type":"auth"}}`,
			want:   "invalid api key",
		},
		{
			name:   "short plain text body",
			status: 503,
			body:   "upstream unavailable",
			want:   "upstream unavailable",
		},
		{
			name:   "unrecognized JSON falls back to status text",
			status: 404,
			body:   `{"foo":"bar"}`,
			want:   "Not Found",
		},
		{
			name:   "empty body falls back to status text",
			status: 429,
			body:   "",
			want:   "Too Many Requests",
		},
		{
			name:   "long plain text falls back to status text",
			status: 502,
			body:   "<html>" + strings.Repeat("x", 300) + "</html>",
			want:   "Bad Gateway",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := NewUpstreamError("POST", "https://api.example.com/v1/events", tt.status, []byte(tt.body))
			if e.Message != tt.want {
				t.Errorf("Message = %q, want %q", e.Message, tt.want)
			}
		})
	}
}

func TestUpstreamErrorJSON(t *testing.T) {
	e := NewUpstreamError("POST", "https://api.example.com/v1/events", 400, []byte(`{"title":"Bad Request","detail":"bad body"}`))

	var got struct {
		Message    string          `json:"message"`
		Status     int             `json:"status"`
		StatusText string          `json:"statusText"`
		Request    string          `json:"request"`
		Body       json.RawMessage `json:"body"`
	}
	if err := json.Unmarshal(e.JSON(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Message != "bad body" {
		t.Errorf("message = %q", got.Message)
	}
	if got.Status != 400 || got.StatusText != "Bad Request" {
		t.Errorf("status = %d %q", got.Status, got.StatusText)
	}
	if got.Request != "POST https://api.example.com/v1/events" {
		t.Errorf("request = %q", got.Request)
	}
	var body map[string]string
	if err := json.Unmarshal(got.Body, &body); err != nil {
		t.Fatalf("body should stay JSON: %v", err)
	}
	if body["detail"] != "bad body" {
		t.Errorf("body = %v", body)
	}

	// A non-JSON body is carried as a JSON string.
	e = NewUpstreamError("GET", "https://api.example.com", 503, []byte("upstream unavailable"))
	if err := json.Unmarshal(e.JSON(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var text string
	if err := json.Unmarshal(got.Body, &text); err != nil || text != "upstream unavailable" {
		t.Errorf("body = %s, err = %v", got.Body, err)
	}

	if want := "GET https://api.example.com returned 503 Service Unavailable: upstream unavailable"; e.Error() != want {
		t.Errorf("Error() = %q, want %q", e.Error(), want)
	}
}

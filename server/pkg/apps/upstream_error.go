package apps

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// UpstreamError is an HTTP call an app made to its upstream API and could not turn
// into the method's response. Apps return it from Invoke instead of a flat error so
// the transports can surface the status code, a clean human message, and the raw
// response body.
type UpstreamError struct {
	Method     string // HTTP verb of the upstream request
	URL        string // full upstream URL
	Status     int    // HTTP status code, e.g. 400
	StatusText string // e.g. "Bad Request"
	Message    string // human summary of what went wrong
	Body       []byte // raw response body, truncated
	// Unreadable marks a response that arrived without an HTTP failure and still
	// could not be shaped into the method's response message. The API answered, so
	// Body is its answer and Message is kaja's reading of it rather than a summary
	// taken out of it - which is why both are shown, and why the status is reported
	// as the answer's rather than as the failure's.
	Unreadable bool
	// RequestHeaders/ResponseHeaders are the headers exchanged with the upstream,
	// surfaced in the client's Headers view even though the call failed. A 401 is
	// exactly when they matter most.
	RequestHeaders  map[string]string
	ResponseHeaders map[string]string
}

// WithHeaders attaches the upstream request/response headers to the error so the
// transports can surface them alongside the failure.
func (e *UpstreamError) WithHeaders(request, response map[string]string) *UpstreamError {
	e.RequestHeaders = request
	e.ResponseHeaders = response
	return e
}

const upstreamBodyLimit = 4000

// NewUpstreamError builds an UpstreamError from a failed (HTTP >= 400)
// upstream response, extracting the most useful human message the body offers.
func NewUpstreamError(method, url string, status int, body []byte) *UpstreamError {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > upstreamBodyLimit {
		trimmed = trimmed[:upstreamBodyLimit]
	}
	return &UpstreamError{
		Method:     method,
		URL:        url,
		Status:     status,
		StatusText: http.StatusText(status),
		Message:    upstreamMessage(status, trimmed),
		Body:       trimmed,
	}
}

// NewUnreadableResponse builds an UpstreamError for a response that arrived without
// an HTTP failure and still could not be shaped into the method's response message.
// The call reached the API, so what it sent back is the only thing that explains the
// failure: it travels whole, under a reason naming what could not be read.
func NewUnreadableResponse(method, url string, status int, body []byte, reason string) *UpstreamError {
	e := NewUpstreamError(method, url, status, body)
	e.Message = reason
	e.Unreadable = true
	return e
}

// TransportStatus is the status the transports gate on to tell a structured failure
// from a response: the desktop's TargetResult carries one field for both, and a
// success status there would be read as a call that worked. An unreadable response is
// kaja failing as the gateway it is here, which is what 502 means. The status the user
// is shown is the one in JSON, which is always the one the upstream sent.
func (e *UpstreamError) TransportStatus() int {
	if e.Status >= 400 {
		return e.Status
	}
	return http.StatusBadGateway
}

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("%s %s returned %d %s: %s", e.Method, e.URL, e.Status, e.StatusText, e.Message)
}

// JSON renders the error as the structured body the client transports hand to
// the UI: the message, the status, the request line, and the raw body (kept as
// JSON when it is JSON, carried as a string otherwise).
//
// An unreadable response names its status under a different key, because "status"
// is what the client reads as an HTTP failure - it labels the call with the code and
// drops the message in favour of the body. Here the message is the only thing that
// explains the failure and the status is a success, so neither reading holds.
func (e *UpstreamError) JSON() []byte {
	body := json.RawMessage(e.Body)
	if !json.Valid(e.Body) {
		body, _ = json.Marshal(string(e.Body))
	}
	payload := map[string]any{
		"message": e.Message,
		"request": e.Method + " " + e.URL,
		"body":    body,
	}
	if e.Unreadable {
		payload["responseStatus"] = e.Status
		payload["responseStatusText"] = e.StatusText
	} else {
		payload["status"] = e.Status
		payload["statusText"] = e.StatusText
	}
	encoded, _ := json.Marshal(payload)
	return encoded
}

// upstreamMessage extracts a human summary from an error response body. It
// understands RFC 7807 problem+json (detail/title) and the common {"message"}
// and {"error"} envelopes, falling back to the HTTP status text.
func upstreamMessage(status int, body []byte) string {
	var envelope struct {
		Detail  string          `json:"detail"`
		Title   string          `json:"title"`
		Message string          `json:"message"`
		Error   json.RawMessage `json:"error"`
	}
	if json.Unmarshal(body, &envelope) == nil {
		if envelope.Detail != "" {
			return envelope.Detail
		}
		if envelope.Message != "" {
			return envelope.Message
		}
		if s := errorEnvelopeMessage(envelope.Error); s != "" {
			return s
		}
		if envelope.Title != "" {
			return envelope.Title
		}
	} else if text := strings.TrimSpace(string(body)); text != "" && len(text) <= 200 {
		// A short plain-text body is its own best summary.
		return text
	}
	if text := http.StatusText(status); text != "" {
		return text
	}
	return fmt.Sprintf("upstream returned HTTP %d", status)
}

// errorEnvelopeMessage reads an "error" JSON value that is either a plain
// string or an object with a "message".
func errorEnvelopeMessage(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var nested struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &nested) == nil {
		return nested.Message
	}
	return ""
}

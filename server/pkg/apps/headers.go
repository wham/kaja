package apps

import (
	"net/http"
	"strings"
)

// RedactedValue replaces the value of a sensitive header before it is surfaced
// to the client.
const RedactedValue = "<redacted>"

// sensitiveHeaderNames are headers whose values carry credentials and are always
// masked, regardless of the substring heuristic below.
var sensitiveHeaderNames = map[string]bool{
	"authorization":       true,
	"proxy-authorization": true,
	"cookie":              true,
	"set-cookie":          true,
}

// sensitiveHeaderSubstrings match header names that conventionally carry a
// credential (e.g. "X-Api-Key", "X-Auth-Token").
var sensitiveHeaderSubstrings = []string{"api-key", "apikey", "api_key", "token", "secret", "password"}

// IsSensitiveHeader reports whether a header's value should be redacted before
// it is shown to the client.
func IsSensitiveHeader(name string) bool {
	lower := strings.ToLower(name)
	if sensitiveHeaderNames[lower] {
		return true
	}
	for _, s := range sensitiveHeaderSubstrings {
		if strings.Contains(lower, s) {
			return true
		}
	}
	return false
}

// SurfaceHeaders flattens an http.Header into a plain map for display, masking
// the value of any header that carries a credential. Multi-valued headers are
// comma-joined; empty values are left as-is (nothing to redact).
func SurfaceHeaders(header http.Header) map[string]string {
	if len(header) == 0 {
		return nil
	}
	out := make(map[string]string, len(header))
	for name, values := range header {
		value := strings.Join(values, ", ")
		if value != "" && IsSensitiveHeader(name) {
			value = RedactedValue
		}
		out[name] = value
	}
	return out
}

package apps

import (
	"net/http"
	"strings"
)

// SurfaceHeaders flattens an http.Header into a plain map for display in the
// client's Headers view. Multi-valued headers are comma-joined.
func SurfaceHeaders(header http.Header) map[string]string {
	if len(header) == 0 {
		return nil
	}
	out := make(map[string]string, len(header))
	for name, values := range header {
		out[name] = strings.Join(values, ", ")
	}
	return out
}

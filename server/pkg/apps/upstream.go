package apps

import "encoding/json"

// Upstream is everything kaja has to say about a call besides the response messages
// themselves: the hop it made on the call's behalf, how long that hop took, and the
// failure when there was one. It is the response side of the reserved X-Kaja-App
// request header — kaja's own channel, never something the upstream sent.
//
// It travels as one JSON object: the "kaja-upstream" gRPC-Web trailer on the web, the
// TargetResult field of the same name on the desktop. One object rather than a key
// each, because a trailer block is escaped, budgeted and parsed once per name, and
// four names bought nothing four fields of one object don't.
type Upstream struct {
	// RequestHeaders/ResponseHeaders are the headers an app exchanged with its
	// upstream, which the client shows as the API's own.
	RequestHeaders  map[string]string `json:"requestHeaders,omitempty"`
	ResponseHeaders map[string]string `json:"responseHeaders,omitempty"`
	// DurationMs is the exchange as this process measured it, which the client shows
	// in place of its own round-trip timing. Never omitted: a call that took no
	// measurable time is not a call nobody measured.
	DurationMs int64 `json:"durationMs"`
	// Error is the structured HTTP failure (UpstreamError.JSON), which the client
	// shows *instead of* the gRPC error the call was tunnelled through, so the tunnel
	// doesn't show through.
	Error json.RawMessage `json:"error,omitempty"`
}

// UpstreamOf is what a finished call has to say for itself.
func UpstreamOf(report *Report) *Upstream {
	if report == nil {
		return nil
	}
	return &Upstream{
		RequestHeaders:  report.RequestHeaders,
		ResponseHeaders: report.ResponseHeaders,
		DurationMs:      report.DurationMs,
	}
}

// UpstreamOfError is what a failed one has. The exchanged headers come along: a 401
// is exactly when they matter.
func UpstreamOfError(err *UpstreamError) *Upstream {
	return &Upstream{
		RequestHeaders:  err.RequestHeaders,
		ResponseHeaders: err.ResponseHeaders,
		DurationMs:      err.DurationMs,
		Error:           err.JSON(),
	}
}

// WithoutHeaders is the report without the headers describing the hop, which is what
// is left when the whole of it will not fit in the carrier: the failure and the timing
// are what the call has to say, the headers only say how it was made.
func (u *Upstream) WithoutHeaders() *Upstream {
	if u == nil {
		return nil
	}
	trimmed := *u
	trimmed.RequestHeaders = nil
	trimmed.ResponseHeaders = nil
	return &trimmed
}

// JSON renders the envelope for whichever carrier this build has. A call with nothing
// to report renders as nothing at all rather than as an empty object.
func (u *Upstream) JSON() string {
	if u == nil {
		return ""
	}
	encoded, err := json.Marshal(u)
	if err != nil {
		return ""
	}
	return string(encoded)
}

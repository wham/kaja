package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// The lane a script's own `fetch` goes out on, and the door only the desktop has.
//
// A fetch is the browser's call everywhere else, which is what keeps a deployed kaja
// from being a proxy for arbitrary URLs. In the desktop's webview it cannot be: the
// page is served from wails://, a scheme WebKit reads as insecure and opaque, so a
// request to any https API fails before it is sent — CORS the API could never allow,
// under an origin it has never heard of. The process behind that webview is the
// user's own machine, so it makes the call instead.
const fetchPath = "/fetch"

// Kaja's own channel on this lane, in both directions: the target going out, the URL
// the response was finally read from coming back, and the failure where there was no
// response at all. Stripped from what upstream sent before anything is copied, so an
// API cannot write kaja's own channel.
const (
	fetchMethodHeader = "X-Kaja-Fetch-Method"
	fetchURLHeader    = "X-Kaja-Fetch-Url"
	fetchErrorHeader  = "X-Kaja-Fetch-Error"
)

// The script's own headers, under the prefix the app lane already forwards them by.
const fetchHeaderPrefix = "X-Header-"

// Not the API's to state: the connection this hop was carried over is not the one the
// browser reads the response on. Content-Length goes with them because the body is
// written again here.
var hopByHopHeaders = map[string]bool{
	"Connection":          true,
	"Content-Length":      true,
	"Keep-Alive":          true,
	"Proxy-Authenticate":  true,
	"Proxy-Authorization": true,
	"Te":                  true,
	"Trailer":             true,
	"Transfer-Encoding":   true,
	"Upgrade":             true,
}

// mountFetch registers the lane on the webview's mux. It is registered here rather
// than in pkg/router, which both builds serve: a door that forwards any URL a caller
// names is one the web must not have.
func mountFetch(mux *http.ServeMux, client *http.Client) {
	mux.HandleFunc("POST "+fetchPath, func(w http.ResponseWriter, r *http.Request) {
		serveFetch(w, r, client)
	})
}

func serveFetch(w http.ResponseWriter, r *http.Request, client *http.Client) {
	request, err := upstreamRequest(r)
	if err != nil {
		fetchFailed(w, http.StatusBadRequest, err.Error())
		return
	}

	response, err := client.Do(request)
	if err != nil {
		// What a request that never completed is: fetch throws for this, and the
		// message is the whole diagnosis where "Load failed" was none.
		fetchFailed(w, http.StatusBadGateway, err.Error())
		return
	}
	defer response.Body.Close()

	copyUpstreamHeaders(w.Header(), response.Header)
	// Where the response was finally read from, which is what a script reads off
	// `response.url` after a redirect.
	w.Header().Set(fetchURLHeader, response.Request.URL.String())
	w.WriteHeader(response.StatusCode)
	io.Copy(w, response.Body)
}

func upstreamRequest(r *http.Request) (*http.Request, error) {
	target, err := fetchTarget(r.Header.Get(fetchURLHeader))
	if err != nil {
		return nil, err
	}
	method := r.Header.Get(fetchMethodHeader)
	if method == "" {
		method = http.MethodGet
	}

	// A GET the browser sent as an empty POST body must not go upstream as a chunked
	// one: a body is forwarded only where there are bytes to forward. Read into a
	// bytes.Reader rather than passed along, which is what gives the request a GetBody
	// — without one a 307 to another URL is refused for a body it cannot send twice.
	// It costs nothing: the browser framed the whole body before it sent it here.
	var body io.Reader
	if r.ContentLength > 0 {
		read, err := io.ReadAll(r.Body)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(read)
	}
	request, err := http.NewRequestWithContext(r.Context(), method, target.String(), body)
	if err != nil {
		return nil, err
	}
	for name, values := range r.Header {
		if strings.HasPrefix(name, fetchHeaderPrefix) && len(values) > 0 {
			request.Header.Set(strings.TrimPrefix(name, fetchHeaderPrefix), values[0])
		}
	}
	return request, nil
}

// Only what a page could have asked for itself. A scheme the browser cannot fetch is
// one this lane has no business reaching either.
func fetchTarget(raw string) (*url.URL, error) {
	if raw == "" {
		return nil, errNoTarget
	}
	target, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, errNotHTTP
	}
	return target, nil
}

type fetchError string

func (e fetchError) Error() string { return string(e) }

const (
	errNoTarget fetchError = "no URL to fetch"
	errNotHTTP  fetchError = "only http and https URLs can be fetched"
)

func copyUpstreamHeaders(destination, source http.Header) {
	for name, values := range source {
		canonical := http.CanonicalHeaderKey(name)
		if hopByHopHeaders[canonical] || strings.HasPrefix(canonical, "X-Kaja-Fetch-") {
			continue
		}
		for _, value := range values {
			destination.Add(canonical, value)
		}
	}
}

// A failure of the lane rather than a status the API answered with. The header is what
// tells the two apart, so an API's own 502 stays a response.
func fetchFailed(w http.ResponseWriter, status int, message string) {
	w.Header().Set(fetchErrorHeader, escapeHeaderValue(message))
	w.WriteHeader(status)
}

// escapeHeaderValue percent-encodes everything a header value cannot carry verbatim,
// the same rule and the same reason as a gRPC-Web trailer's: a header is a byte string
// the Fetch API reads as Latin-1, so the UTF-8 of a message naming a host, a
// certificate or an OS error in a language that has accents arrives mangled, and a
// newline in one would be a second header. Encoding the bytes outside printable ASCII
// - and "%" itself, so the escape is reversible - is what the reader undoes with
// decodeURIComponent.
func escapeHeaderValue(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < 0x20 || c > 0x7e || c == '%' {
			fmt.Fprintf(&b, "%%%02X", c)
			continue
		}
		b.WriteByte(c)
	}
	return b.String()
}

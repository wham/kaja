package openapi

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/wham/kaja/v2/pkg/apps"
)

// maxBody bounds what one response may bring back. A REST API is free to answer
// with a gigabyte, and the browser this is carried to has to hold it.
const maxBody = 64 << 20

// Forward makes one upstream call on behalf of a script that built the request
// itself.
//
// It is the whole of what this process does for a REST app now. The client read
// the document, so it knows the verb, the path, the query and the body; what it
// does not have is where the API lives and what credential opens it, and it must
// not — a kaja serving a browser over the network would otherwise be handing out
// the workspace's secrets.
//
// A status is data, not an outcome: an API that answers 404 has answered, and what
// to make of it is the script's business. Only a call that could not be made at all
// is an error here.
func (in *instance) Forward(request *apps.ForwardRequest) (*apps.ForwardResult, error) {
	if strings.Contains(request.Path, "://") || strings.HasPrefix(request.Path, "//") {
		return nil, fmt.Errorf("path %q is a URL; a forwarded call is addressed relative to the app", request.Path)
	}
	path := request.Path
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	target := strings.TrimSuffix(in.baseURL, "/") + path
	var body io.Reader
	if len(request.Body) > 0 {
		body = bytes.NewReader(request.Body)
	}

	outgoing, err := http.NewRequest(strings.ToUpper(request.Method), target, body)
	if err != nil {
		return nil, fmt.Errorf("building the upstream request: %w", err)
	}
	for name, value := range request.Headers {
		outgoing.Header.Set(name, value)
	}

	// The app's own credential goes on after the call's headers, the way it always
	// has: it is the app's, and a header the script wrote does not carry it.
	query := outgoing.URL.Query()
	in.auth.applyQuery(query)
	outgoing.URL.RawQuery = query.Encode()
	in.auth.applyRequest(outgoing)

	started := time.Now()
	response, err := in.client.Do(outgoing)
	if err != nil {
		return nil, fmt.Errorf("calling %s: %w", target, err)
	}
	defer response.Body.Close()

	answered, err := io.ReadAll(io.LimitReader(response.Body, maxBody))
	if err != nil {
		return nil, fmt.Errorf("reading the response from %s: %w", target, err)
	}

	return &apps.ForwardResult{
		Status:         response.StatusCode,
		Headers:        flatten(response.Header),
		Body:           answered,
		RequestHeaders: flatten(outgoing.Header),
		DurationMs:     time.Since(started).Milliseconds(),
	}, nil
}

// One value per name, which is what the Headers view shows and what a script reads
// back. A repeated header is joined the way HTTP itself allows.
func flatten(header http.Header) map[string]string {
	flat := make(map[string]string, len(header))
	for name, values := range header {
		flat[name] = strings.Join(values, ", ")
	}
	return flat
}

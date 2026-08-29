package openapi

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
	target, err := in.resolve(request.Path)
	if err != nil {
		return nil, err
	}

	var body io.Reader
	if len(request.Body) > 0 {
		body = bytes.NewReader(request.Body)
	}

	outgoing, err := http.NewRequest(strings.ToUpper(request.Method), target.String(), body)
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

// resolve turns the path a script asked for into the URL this process will call.
//
// The address is the security boundary of this whole lane: anything that reaches
// here has crossed from a browser, and on a deployed kaja that browser is not
// necessarily the workspace's owner. So the destination is not assembled from
// text — every part of the authority is taken from the app's own base URL, and
// the request supplies a path and a query and nothing else. Even a reference that
// parses as absolute contributes only its path, because there is no branch here
// that can read a host out of the input.
//
// Confining the result under the base path is the second half: a document mounted
// at /v1 is an API that begins at /v1, and `../..` climbing out of it reaches
// endpoints on that host the app was never opened for.
func (in *instance) resolve(path string) (*url.URL, error) {
	base, err := url.Parse(in.baseURL)
	if err != nil {
		return nil, fmt.Errorf("the app's base URL %q is not a URL: %w", in.baseURL, err)
	}

	reference, err := url.Parse(path)
	if err != nil {
		return nil, fmt.Errorf("path %q is not a path: %w", path, err)
	}
	if reference.IsAbs() || reference.Host != "" || reference.User != nil {
		return nil, fmt.Errorf("path %q names a destination; a forwarded call is addressed relative to the app", path)
	}

	// An operation's path hangs off the server URL, which is what an OpenAPI
	// document means by the two: /v1 and /shows are /v1/shows. So they are joined
	// rather than resolved against one another, where an absolute /shows would
	// replace the mount point instead of extending it.
	basePath := base.EscapedPath()
	if basePath == "" {
		basePath = "/"
	}
	joined := strings.TrimSuffix(basePath, "/") + "/" + strings.TrimPrefix(reference.EscapedPath(), "/")

	candidate, err := url.Parse(joined)
	if err != nil {
		return nil, fmt.Errorf("path %q is not a path: %w", path, err)
	}
	// Resolving the joined path against the base is what removes the dot segments,
	// so `..` is settled here rather than left for the upstream to interpret.
	candidate.RawQuery = reference.RawQuery
	resolved := base.ResolveReference(candidate)

	confined := strings.TrimSuffix(basePath, "/")
	if resolved.EscapedPath() != confined && !strings.HasPrefix(resolved.EscapedPath(), confined+"/") {
		return nil, fmt.Errorf("path %q reaches outside the app", path)
	}

	// Built from the base rather than from the reference, so the scheme, the host
	// and any credentials in the base URL are the only ones that can be used.
	target := *base
	target.Path = resolved.Path
	target.RawPath = resolved.RawPath
	target.RawQuery = resolved.RawQuery
	target.Fragment = ""
	target.RawFragment = ""
	return &target, nil
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

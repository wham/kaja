// Package twirp implements the built-in "twirp" app. A Twirp method is a POST of a
// protobuf body to <url>/twirp/<package.Service>/<Method>, so the app carries the
// bytes the client framed and hands back the ones the server answered with: there is
// nothing to transcode, and the request the browser wrote is the request that goes
// out.
//
// It is invoked in this process rather than by the browser because that is where the
// app's headers are expanded and what it exchanged upstream is reported from. The
// client speaks gRPC-Web to every app; which protocol reaches the API is this side's
// business.
package twirp

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/wham/kaja/v2/pkg/apps"
)

// contentType is what a Twirp method's protobuf body travels as, in both
// directions. Twirp's other encoding is JSON, which kaja never sends: the client
// frames protobuf.
const contentType = "application/protobuf"

// responseLimit bounds what is read back from an upstream, the way the chat app
// bounds its own.
const responseLimit = 16 << 20

// App opens "twirp" apps. Their proto surface is a directory on disk, resolved by
// the compiler against the workspace.
type App struct{}

func New() *App { return &App{} }

func (a *App) Open(parameters map[string]string, protoDir string, log func(string)) (*apps.Opened, error) {
	url := strings.TrimSpace(parameters["url"])
	if url == "" {
		return nil, fmt.Errorf("missing required parameter %q", "url")
	}
	log("TWIRP target: " + url)

	dir := strings.TrimSpace(parameters["proto_dir"])
	if dir == "" {
		return nil, fmt.Errorf("missing required parameter %q", "proto_dir")
	}
	log("Proto directory: " + dir)

	return &apps.Opened{
		ProtoDir: dir,
		Instance: &instance{baseURL: baseURL(url), client: &http.Client{Timeout: 120 * time.Second}},
	}, nil
}

// baseURL normalizes what the app was configured with into something a path can be
// appended to. A bare host:port is http, the way it always was; a trailing slash
// would double up against the one endpointFor writes.
func baseURL(url string) string {
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		url = "http://" + url
	}
	return strings.TrimRight(url, "/")
}

type instance struct {
	baseURL string
	client  *http.Client
}

func (in *instance) Invoke(methodPath string, request []byte, headers map[string]string) (*apps.InvokeResult, error) {
	endpoint := in.baseURL + "/twirp/" + strings.TrimPrefix(methodPath, "/")

	httpReq, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(request))
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	// The app's own headers go on first so one configured as Content-Type still
	// outranks kaja's, the rule every app applies to what it sets itself.
	for name, value := range headers {
		httpReq.Header.Set(name, value)
	}
	if httpReq.Header.Get("Content-Type") == "" {
		httpReq.Header.Set("Content-Type", contentType)
	}
	requestHeaders := apps.SurfaceHeaders(httpReq.Header)

	resp, err := in.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("calling %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	responseHeaders := apps.SurfaceHeaders(resp.Header)

	body, err := io.ReadAll(io.LimitReader(resp.Body, responseLimit))
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	// A Twirp error is an HTTP failure carrying a JSON body, which is what an
	// UpstreamError already is: the status labels the call and the body is shown as
	// what the API sent.
	if resp.StatusCode >= 400 {
		return nil, apps.NewUpstreamError(http.MethodPost, endpoint, resp.StatusCode, body).WithHeaders(requestHeaders, responseHeaders)
	}

	return &apps.InvokeResult{Body: body, RequestHeaders: requestHeaders, ResponseHeaders: responseHeaders}, nil
}

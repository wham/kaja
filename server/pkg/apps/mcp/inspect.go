package mcp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/wham/kaja/v2/pkg/apps"
)

// inspectTimeout is the leash on reading a server the form is asking about. It
// is much shorter than a tool call's: the form asks again on every keystroke
// that settles, so a slow answer is worse than no answer.
const inspectTimeout = 20 * time.Second

// ProblemKind classifies a server that couldn't be read, so the form can name
// the next move instead of printing a raw error.
type ProblemKind string

const (
	ProblemTarget       ProblemKind = "target"
	ProblemUnreachable  ProblemKind = "unreachable"
	ProblemTimeout      ProblemKind = "timeout"
	ProblemUnauthorized ProblemKind = "unauthorized"
	ProblemSignIn       ProblemKind = "signIn"
	ProblemForbidden    ProblemKind = "forbidden"
	ProblemHTTPError    ProblemKind = "httpError"
	ProblemNotMCP       ProblemKind = "notMcp"
	ProblemEmpty        ProblemKind = "empty"
	ProblemUnresolved   ProblemKind = "unresolved"
	ProblemLegacySSE    ProblemKind = "legacySse"
)

// Problem is a server that couldn't be read: a headline addressed to the user
// and the underlying error verbatim.
type Problem struct {
	Kind    ProblemKind
	Message string
	Detail  string
}

func (p *Problem) Error() string {
	if p.Detail == "" {
		return p.Message
	}
	return p.Message + ": " + p.Detail
}

// Inspect reads what a server exposes without creating an app, so the New MCP
// app form can fill itself in from what answered.
func Inspect(parameters map[string]string, authorizer *Authorizer) (*Surface, *Problem) {
	endpoint := strings.TrimSpace(parameters["url"])
	if endpoint == "" {
		return nil, &Problem{Kind: ProblemTarget, Message: "Enter the server's MCP endpoint."}
	}
	// The references were expanded before this was called, so one still here
	// names a variable this kaja doesn't define. The app can still be added: it
	// is read where it opens, which may be a kaja that does define it.
	if names := unresolvedReferences(endpoint); len(names) > 0 {
		return nil, &Problem{
			Kind:    ProblemUnresolved,
			Message: strings.Join(names, ", ") + " isn't defined here, so the server can't be read yet. Kaja reads it when the app opens.",
		}
	}
	if err := requireHTTPScheme(endpoint); err != nil {
		return nil, &Problem{Kind: ProblemTarget, Message: "That isn't an HTTP endpoint.", Detail: err.Error()}
	}

	credential, err := credentialSource(parameters, authorizer)
	if err != nil {
		return nil, &Problem{Kind: ProblemUnauthorized, Message: "This kaja cannot sign in to an MCP server.", Detail: err.Error()}
	}
	// Asked before the call rather than read out of the failure it would be: a
	// server that has never been signed in to refuses the read with the same 401 a
	// wrong token gets, and the answer to one is not the answer to the other.
	if strings.TrimSpace(parameters["auth"]) == AuthOAuth && !authorizer.SignedIn(endpoint) {
		return nil, &Problem{Kind: ProblemSignIn, Message: "Sign in to read this server."}
	}
	client := NewClient(endpoint, credential, &http.Client{Timeout: inspectTimeout})
	surface, err := client.ReadSurface(nil)
	if err != nil {
		problem := classify(err)
		if problem.Kind == ProblemNotMCP && speaksLegacySSE(endpoint, client.http) {
			return nil, &Problem{
				Kind:    ProblemLegacySSE,
				Message: "This server speaks the older HTTP+SSE transport, which Kaja doesn't. Ask for its Streamable HTTP endpoint, which usually ends in /mcp.",
				Detail:  problem.Detail,
			}
		}
		return nil, problem
	}
	if len(surface.Tools) == 0 && len(surface.Resources) == 0 && len(surface.ResourceTemplates) == 0 && len(surface.Prompts) == 0 {
		return surface, &Problem{
			Kind:    ProblemEmpty,
			Message: "The server answered but exposes no tools, resources or prompts.",
		}
	}
	return surface, nil
}

// classify turns a failure to read a server into the one line that says what to
// do about it.
func classify(err error) *Problem {
	detail := err.Error()

	var upstream *apps.UpstreamError
	if errors.As(err, &upstream) {
		detail = upstreamDetail(upstream)
		switch {
		case upstream.Status == http.StatusUnauthorized:
			return &Problem{Kind: ProblemUnauthorized, Message: "The server wants a credential.", Detail: detail}
		case upstream.Status == http.StatusForbidden:
			return &Problem{Kind: ProblemForbidden, Message: "The credential was rejected.", Detail: detail}
		case upstream.Status == http.StatusNotFound || upstream.Status == http.StatusMethodNotAllowed:
			return &Problem{
				Kind:    ProblemNotMCP,
				Message: "Nothing is serving MCP at that path. Most servers end in /mcp.",
				Detail:  detail,
			}
		}
		return &Problem{
			Kind:    ProblemHTTPError,
			Message: fmt.Sprintf("The server answered %d %s.", upstream.Status, upstream.StatusText),
			Detail:  detail,
		}
	}

	var rpcErr *jsonRPCError
	if errors.As(err, &rpcErr) {
		return &Problem{
			Kind:    ProblemNotMCP,
			Message: "That endpoint speaks JSON-RPC but not MCP.",
			Detail:  detail,
		}
	}

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return &Problem{Kind: ProblemTimeout, Message: "The server didn't answer in time.", Detail: detail}
	}
	if strings.Contains(detail, "is not JSON-RPC") {
		return &Problem{Kind: ProblemNotMCP, Message: "That endpoint answered, but not with MCP.", Detail: detail}
	}
	if isTransport(err) {
		return &Problem{Kind: ProblemUnreachable, Message: "The server couldn't be reached.", Detail: detail}
	}
	return &Problem{Kind: ProblemUnreachable, Message: "The server couldn't be read.", Detail: detail}
}

// unresolvedReferences names the ${NAME} references left in an endpoint after
// expansion, which are the variables nothing here defines.
func unresolvedReferences(endpoint string) []string {
	var names []string
	for _, match := range variableReference.FindAllStringSubmatch(endpoint, -1) {
		names = append(names, match[1])
	}
	return names
}

var variableReference = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// upstreamDetail is the failed exchange in one line. The body's own words are
// worth a line when they are words; a 404 page is markup nobody reads in a
// caption, and says nothing the status line hasn't.
func upstreamDetail(upstream *apps.UpstreamError) string {
	line := fmt.Sprintf("%s %s returned %d %s", upstream.Method, upstream.URL, upstream.Status, upstream.StatusText)
	message := strings.TrimSpace(upstream.Message)
	if message == "" || message == upstream.StatusText || strings.HasPrefix(message, "<") {
		return line
	}
	return line + ": " + message
}

// speaksLegacySSE asks whether an endpoint that refused a POST is the older
// transport's event stream: a GET that answers with an `endpoint` event is
// exactly that, and nothing else answers one. The stream stays open, so only
// its first bytes are read.
func speaksLegacySSE(endpoint string, httpClient *http.Client) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return false
	}
	request.Header.Set("Accept", "text/event-stream")
	response, err := httpClient.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if !strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
		return false
	}
	head := make([]byte, 512)
	n, _ := io.ReadAtLeast(response.Body, head, len("event: endpoint"))
	return strings.Contains(string(head[:n]), "event: endpoint")
}

func isTransport(err error) bool {
	var opErr *net.OpError
	var dnsErr *net.DNSError
	if errors.As(err, &opErr) || errors.As(err, &dnsErr) {
		return true
	}
	detail := err.Error()
	for _, marker := range []string{"connection refused", "no such host", "certificate", "tls:", "EOF"} {
		if strings.Contains(detail, marker) {
			return true
		}
	}
	return false
}

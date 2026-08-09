package mcp

import (
	"errors"
	"fmt"
	"net"
	"net/http"
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
	ProblemForbidden    ProblemKind = "forbidden"
	ProblemHTTPError    ProblemKind = "httpError"
	ProblemNotMCP       ProblemKind = "notMcp"
	ProblemEmpty        ProblemKind = "empty"
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
func Inspect(parameters map[string]string) (*Surface, *Problem) {
	endpoint := strings.TrimSpace(parameters["url"])
	if endpoint == "" {
		return nil, &Problem{Kind: ProblemTarget, Message: "Enter the server's MCP endpoint."}
	}
	if err := requireHTTPScheme(endpoint); err != nil {
		return nil, &Problem{Kind: ProblemTarget, Message: "That isn't an HTTP endpoint.", Detail: err.Error()}
	}

	client := NewClient(endpoint, Credential(parameters), &http.Client{Timeout: inspectTimeout})
	surface, err := client.ReadSurface(nil)
	if err != nil {
		return nil, classify(err)
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

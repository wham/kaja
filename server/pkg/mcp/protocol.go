package mcp

import (
	"encoding/json"
	"time"
)

// The revisions this server answers, newest first. ProtocolVersion is the one that
// dropped the handshake: a request carries its own version, the client's identity and
// its capabilities in `_meta`, there is no session, and a result says which kind of
// result it is. The rest open with `initialize` and may pin a session, which is what
// nearly every deployed client does today, so both eras are served.
const (
	ProtocolVersion = "2026-07-28"
	// legacyProtocolVersion is what a handshake that asked for nothing this server
	// knows is answered with.
	legacyProtocolVersion = "2025-06-18"
)

var supportedVersions = []string{ProtocolVersion, "2025-11-25", "2025-06-18", "2025-03-26"}

// modernVersions are the revisions with no handshake in them. The era is read off
// each request rather than held, so nothing about which one a client speaks is state
// this server keeps.
var modernVersions = map[string]bool{ProtocolVersion: true}

func supportsVersion(version string) bool {
	for _, candidate := range supportedVersions {
		if candidate == version {
			return true
		}
	}
	return false
}

// The `_meta` keys the modern era carries. The prefix is reserved by the
// specification, which is why these are spelled out rather than derived.
const (
	metaProtocolVersion    = "io.modelcontextprotocol/protocolVersion"
	metaClientInfo         = "io.modelcontextprotocol/clientInfo"
	metaServerInfo         = "io.modelcontextprotocol/serverInfo"
	metaClientCapabilities = "io.modelcontextprotocol/clientCapabilities"
)

// codeUnsupportedProtocolVersion is what a request naming a revision this server does
// not speak is refused with. The versions it does speak ride in the error's data,
// because a refusal a client cannot retry on costs it the whole connection.
const codeUnsupportedProtocolVersion = -32022

// serverName is what this server calls itself in every era.
const serverName = "kaja-scripts"

// unknownVersion is what a build that was not stamped reports. A version is required
// of an implementation, and an empty string reads as a server that failed to say.
const unknownVersion = "dev"

// How long an answer may be cached, in the two speeds anything here moves at. A
// listing carries them because the caller has no other way to know which of the two
// it is holding.
const (
	// What this server is: settled at process start and held until it exits.
	staticTTL = time.Hour
	// Anything read off the workspace. Apps compile at their own pace and the tools
	// follow whether the workspace may be written, so a minute is as long as an
	// answer about it is worth trusting.
	workspaceTTL = time.Minute
)

// cacheScope is private, always: the token is a browser's session, so what is listed
// under it is that session's catalog and the workspace it opened. The spec allows only
// "public" and "private", and a client validating the result refuses anything else.
const cacheScope = "private"

// cacheable adds the cache directives to a result. It is the answer these describe
// rather than the era it was asked in, so they are written by the handler and not by
// the framing below.
func cacheable(result map[string]interface{}, ttl time.Duration) map[string]interface{} {
	result["ttlMs"] = ttl.Milliseconds()
	result["cacheScope"] = cacheScope
	return result
}

// complete frames a result for the modern era: it says the call finished rather than
// asking the client for something back, and it names the server, which has no
// handshake left to do that in. A result that already says which kind it is - one
// asking for input - keeps its word. A legacy result is handed back as it is.
func complete(result interface{}, modern bool, version string) interface{} {
	fields, ok := result.(map[string]interface{})
	if !ok || !modern {
		return result
	}
	if _, said := fields["resultType"]; !said {
		fields["resultType"] = "complete"
	}
	meta, ok := fields["_meta"].(map[string]interface{})
	if !ok {
		meta = map[string]interface{}{}
		fields["_meta"] = meta
	}
	meta[metaServerInfo] = implementation(version)
	return fields
}

func implementation(version string) map[string]interface{} {
	if version == "" {
		version = unknownVersion
	}
	return map[string]interface{}{"name": serverName, "version": version}
}

// inputRequired is the modern era's way of asking the client for something: the call
// ends with the requests it needs answered and an opaque state, and the client asks
// the same call again carrying both. The key names the request so the answer can be
// found under it on the retry.
func inputRequired(key string, request map[string]interface{}, state string) map[string]interface{} {
	return map[string]interface{}{
		"resultType":    "input_required",
		"inputRequests": map[string]interface{}{key: request},
		"requestState":  state,
	}
}

// urlElicitation is the one request this server makes of a client: open a page. Form
// mode is deliberately not asked for - the page is Kaja's own form, which already
// knows every choice an app needs, and a token typed into it never passes through
// the agent.
func urlElicitation(url string, message string) map[string]interface{} {
	return map[string]interface{}{
		"method": "elicitation/create",
		"params": map[string]interface{}{"mode": "url", "url": url, "message": message},
	}
}

// clientOpensURLs is whether the request came from a client that can be asked to
// open a page. Only the modern era declares capabilities per request, so a handshake
// client answers false and is told what is missing in text instead. An empty
// `elicitation` means form mode alone, so the `url` key has to be there.
func clientOpensURLs(params json.RawMessage) bool {
	var capabilities struct {
		Elicitation map[string]json.RawMessage `json:"elicitation"`
	}
	if json.Unmarshal(metaFields(params)[metaClientCapabilities], &capabilities) != nil {
		return false
	}
	_, ok := capabilities.Elicitation["url"]
	return ok
}

// retry is what a client carries when it asks a call again after an input_required
// answer: the state the server handed it, and what the client got for each request.
type retry struct {
	State     string
	Responses map[string]inputResponse
}

type inputResponse struct {
	Action string `json:"action"`
}

func readRetry(params json.RawMessage) retry {
	var fields struct {
		RequestState   string                   `json:"requestState"`
		InputResponses map[string]inputResponse `json:"inputResponses"`
	}
	_ = json.Unmarshal(params, &fields)
	return retry{State: fields.RequestState, Responses: fields.InputResponses}
}

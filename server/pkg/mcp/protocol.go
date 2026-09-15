package mcp

import "time"

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
	metaProtocolVersion = "io.modelcontextprotocol/protocolVersion"
	metaClientInfo      = "io.modelcontextprotocol/clientInfo"
	metaServerInfo      = "io.modelcontextprotocol/serverInfo"
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

// cacheScope is the session, always: a browser's catalog is the session's own, and the
// tools follow the workspace that session opened.
const cacheScope = "session"

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
// handshake left to do that in. A legacy result is handed back as it is.
func complete(result interface{}, modern bool, version string) interface{} {
	fields, ok := result.(map[string]interface{})
	if !ok || !modern {
		return result
	}
	fields["resultType"] = "complete"
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

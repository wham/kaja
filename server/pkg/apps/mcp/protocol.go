package mcp

import "encoding/json"

// The protocol versions this client speaks, newest first. ProtocolVersion is the
// revision that removed the initialize handshake: every request carries its own
// version and capabilities in `_meta`, and there is no session. The legacy
// versions still establish a session with `initialize`, which is what nearly
// every deployed server does today, so both eras are implemented.
const (
	ProtocolVersion       = "2026-07-28"
	LegacyProtocolVersion = "2025-11-25"
)

// supportedVersions is what the client offers when a server rejects the version
// it asked for, newest first.
var supportedVersions = []string{ProtocolVersion, LegacyProtocolVersion, "2025-06-18", "2025-03-26"}

// The `_meta` keys the modern era carries on every request. The prefix is
// reserved by the specification.
const (
	metaProtocolVersion    = "io.modelcontextprotocol/protocolVersion"
	metaClientInfo         = "io.modelcontextprotocol/clientInfo"
	metaClientCapabilities = "io.modelcontextprotocol/clientCapabilities"
	metaServerInfo         = "io.modelcontextprotocol/serverInfo"
)

// The one MCP error code kaja reads: it is what identifies a server as speaking
// the modern revision, and what names the versions to retry on. The rest are
// surfaced by their message alone.
const codeUnsupportedProtocolVersion = -32022

const clientName = "kaja"

// jsonRPCError is a JSON-RPC error object as it arrives from the server.
type jsonRPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *jsonRPCError) Error() string {
	if e.Message == "" {
		return "the server returned an error"
	}
	return e.Message
}

// supportedVersionsFrom reads the versions an UnsupportedProtocolVersionError
// lists in its data, which is what the client retries with.
func (e *jsonRPCError) supportedVersions() []string {
	var data struct {
		Supported []string `json:"supported"`
	}
	if json.Unmarshal(e.Data, &data) != nil {
		return nil
	}
	return data.Supported
}

// Implementation is the name and version a peer reports for itself. It is
// self-reported and only ever displayed.
type Implementation struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// Capabilities is what a server says it serves. Only the presence of a block
// matters here, so each is a raw message rather than a shape.
type Capabilities struct {
	Tools     *struct{} `json:"tools,omitempty"`
	Resources *struct{} `json:"resources,omitempty"`
	Prompts   *struct{} `json:"prompts,omitempty"`
	Logging   *struct{} `json:"logging,omitempty"`
	Completio *struct{} `json:"completions,omitempty"`
}

// Tool is one tool the server exposes.
type Tool struct {
	Name         string          `json:"name"`
	Title        string          `json:"title,omitempty"`
	Description  string          `json:"description,omitempty"`
	InputSchema  json.RawMessage `json:"inputSchema,omitempty"`
	OutputSchema json.RawMessage `json:"outputSchema,omitempty"`
	Annotations  *ToolAnnotation `json:"annotations,omitempty"`
}

// ToolAnnotation is the server's own hint about what a tool does. It is
// untrusted - kaja shows it, and never decides anything on it.
type ToolAnnotation struct {
	Title           string `json:"title,omitempty"`
	ReadOnlyHint    *bool  `json:"readOnlyHint,omitempty"`
	DestructiveHint *bool  `json:"destructiveHint,omitempty"`
	IdempotentHint  *bool  `json:"idempotentHint,omitempty"`
	OpenWorldHint   *bool  `json:"openWorldHint,omitempty"`
}

// Resource is one resource the server lists.
type Resource struct {
	URI         string `json:"uri"`
	Name        string `json:"name,omitempty"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
	Size        int64  `json:"size,omitempty"`
}

// ResourceTemplate is a parameterized resource URI the server lists.
type ResourceTemplate struct {
	URITemplate string `json:"uriTemplate"`
	Name        string `json:"name,omitempty"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
}

// Prompt is one prompt template the server exposes.
type Prompt struct {
	Name        string           `json:"name"`
	Title       string           `json:"title,omitempty"`
	Description string           `json:"description,omitempty"`
	Arguments   []PromptArgument `json:"arguments,omitempty"`
}

type PromptArgument struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Required    bool   `json:"required,omitempty"`
}

// Surface is everything a server exposes, read in one pass: what it says it is,
// and the tools, resources and prompts it lists.
type Surface struct {
	ServerInfo        Implementation
	Instructions      string
	ProtocolVersion   string
	SupportedVersions []string
	Capabilities      Capabilities
	// Legacy reports whether the server answered the `initialize` handshake
	// instead of the per-request metadata of the modern era.
	Legacy            bool
	Tools             []Tool
	Resources         []Resource
	ResourceTemplates []ResourceTemplate
	Prompts           []Prompt
}

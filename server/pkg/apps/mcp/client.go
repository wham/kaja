package mcp

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/wham/kaja/v2/pkg/apps"
)

// Client speaks MCP to one server over the Streamable HTTP transport.
//
// It is dual-era. The modern revision carries the protocol version, the client's
// identity and its capabilities in every request's `_meta` and has no session at
// all; the legacy revisions open with an `initialize` handshake and may pin a
// session to a header. Which one a server speaks is settled once, by trying the
// modern request first and reading what comes back - a recognized modern error
// identifies a modern server, anything else a legacy one - and then held for the
// life of the client.
type Client struct {
	endpoint string
	http     *http.Client
	// headers the app sends with every request, credential included.
	headers map[string]string

	mu sync.Mutex
	// version is the protocol version settled on, legacy whether the handshake
	// was used, and session the id a legacy server pinned (empty otherwise).
	version   string
	legacy    bool
	session   string
	handshook bool
	nextID    int64
	// greeting is what the server said about itself while the era was settled -
	// a DiscoverResult or an InitializeResult - kept so reading the surface
	// doesn't ask twice.
	greeting json.RawMessage
}

// NewClient builds a client for an MCP endpoint. It performs no I/O: the era and
// the protocol version are settled by the first call.
func NewClient(endpoint string, headers map[string]string, httpClient *http.Client) *Client {
	return &Client{endpoint: endpoint, http: httpClient, headers: headers, version: ProtocolVersion}
}

// Exchange is what one JSON-RPC call exchanged with the server, surfaced in the
// client's Headers view.
type Exchange struct {
	RequestHeaders  map[string]string
	ResponseHeaders map[string]string
}

// Call sends one JSON-RPC request and returns the result object. The `_meta`
// request metadata (modern) or the `initialize` handshake (legacy) is applied
// here, so callers only ever name a method and its params.
func (c *Client) Call(method string, params map[string]any, extra map[string]string) (json.RawMessage, *Exchange, error) {
	if err := c.ensureEra(); err != nil {
		return nil, nil, err
	}
	return c.send(method, params, extra)
}

// send issues one request in the era already settled on, re-running a legacy
// handshake once if the server has forgotten the session.
func (c *Client) send(method string, params map[string]any, extra map[string]string) (json.RawMessage, *Exchange, error) {
	result, exchange, err := c.attempt(method, params, extra)
	if err == nil {
		return result, exchange, nil
	}

	// A legacy server that has dropped the session answers 404; one handshake
	// later the same request works. Anything else is the caller's to see.
	var upstream *apps.UpstreamError
	c.mu.Lock()
	legacy, session := c.legacy, c.session
	c.mu.Unlock()
	if legacy && session != "" && asUpstream(err, &upstream) && upstream.Status == http.StatusNotFound {
		c.mu.Lock()
		c.session, c.handshook = "", false
		c.mu.Unlock()
		if err := c.handshake(); err != nil {
			return nil, nil, err
		}
		return c.attempt(method, params, extra)
	}

	// A server that rejects the version names the ones it has; retry on the best
	// of them, which may put us in the other era.
	var rpcErr *jsonRPCError
	if asRPC(err, &rpcErr) && rpcErr.Code == codeUnsupportedProtocolVersion {
		if version := pickVersion(rpcErr.supportedVersions()); version != "" && version != c.currentVersion() {
			c.mu.Lock()
			c.version, c.legacy, c.handshook, c.session = version, version != ProtocolVersion, false, ""
			c.mu.Unlock()
			if err := c.ensureEra(); err != nil {
				return nil, nil, err
			}
			return c.attempt(method, params, extra)
		}
	}
	return nil, exchange, err
}

func (c *Client) currentVersion() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.version
}

// ensureEra settles which era the server speaks, once. The modern era needs no
// opening request, so the probe doubles as the discovery call; a server that
// answers anything but a modern error is served the legacy handshake instead.
func (c *Client) ensureEra() error {
	c.mu.Lock()
	settled := c.handshook
	legacy := c.legacy
	c.mu.Unlock()
	if settled {
		return nil
	}
	if legacy {
		return c.handshake()
	}

	result, _, err := c.attempt("server/discover", nil, nil)
	if err == nil {
		c.mu.Lock()
		c.handshook, c.greeting = true, result
		c.mu.Unlock()
		return nil
	}

	// Only an error the modern revision defines identifies a modern server.
	// Anything else - an unknown method, a rejected `_meta`, a bare HTTP status,
	// a transport failure - is a server from the handshake era, or not a server
	// at all, and only the handshake can tell those two apart.
	var rpcErr *jsonRPCError
	if asRPC(err, &rpcErr) && rpcErr.Code == codeUnsupportedProtocolVersion {
		version := pickVersion(rpcErr.supportedVersions())
		if version == "" {
			return err
		}
		c.mu.Lock()
		c.version, c.legacy = version, version != ProtocolVersion
		c.mu.Unlock()
		if version == ProtocolVersion {
			c.mu.Lock()
			c.handshook = true
			c.mu.Unlock()
			return nil
		}
		return c.handshake()
	}
	return c.toLegacy()
}

func (c *Client) toLegacy() error {
	c.mu.Lock()
	c.legacy, c.version = true, LegacyProtocolVersion
	c.mu.Unlock()
	return c.handshake()
}

// handshake runs the legacy `initialize` exchange and records the session the
// server pins, if any.
func (c *Client) handshake() error {
	c.mu.Lock()
	if c.handshook {
		c.mu.Unlock()
		return nil
	}
	version := c.version
	c.mu.Unlock()

	result, exchange, err := c.attempt("initialize", map[string]any{
		"protocolVersion": version,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": clientName, "version": "2"},
	}, nil)
	if err != nil {
		return err
	}

	var payload struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	_ = json.Unmarshal(result, &payload)

	c.mu.Lock()
	c.handshook = true
	c.legacy = true
	c.greeting = result
	if payload.ProtocolVersion != "" {
		c.version = payload.ProtocolVersion
	}
	if exchange != nil {
		if id := headerValue(exchange.ResponseHeaders, "Mcp-Session-Id"); id != "" {
			c.session = id
		}
	}
	c.mu.Unlock()

	// The handshake is only complete once the server has been told so. It is a
	// notification, so nothing is expected back and a server that refuses it is
	// not worth failing the whole app over.
	_, _, _ = c.attempt("notifications/initialized", nil, nil)
	return nil
}

// attempt performs one HTTP POST carrying one JSON-RPC message. A notification
// (a method with no id) returns no result.
func (c *Client) attempt(method string, params map[string]any, extra map[string]string) (json.RawMessage, *Exchange, error) {
	notification := strings.HasPrefix(method, "notifications/")

	c.mu.Lock()
	version, legacy, session := c.version, c.legacy, c.session
	c.nextID++
	id := c.nextID
	c.mu.Unlock()

	message := map[string]any{"jsonrpc": "2.0", "method": method}
	if !notification {
		message["id"] = id
	}
	if params == nil {
		params = map[string]any{}
	}
	if !legacy && method != "initialize" {
		// The modern era carries the protocol metadata in the body; the headers
		// below only mirror it.
		params["_meta"] = map[string]any{
			metaProtocolVersion:    version,
			metaClientInfo:         map[string]any{"name": clientName, "version": "2"},
			metaClientCapabilities: map[string]any{},
		}
	}
	if len(params) > 0 {
		message["params"] = params
	}

	body, err := json.Marshal(message)
	if err != nil {
		return nil, nil, fmt.Errorf("encoding %s request: %w", method, err)
	}

	request, err := http.NewRequest(http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, nil, fmt.Errorf("building %s request: %w", method, err)
	}
	// The app's own headers are the more specific instruction: a header written
	// out by hand outranks the credential kaja derived.
	for name, value := range c.headers {
		request.Header.Set(name, value)
	}
	for name, value := range extra {
		request.Header.Set(name, value)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if method != "initialize" {
		request.Header.Set("MCP-Protocol-Version", version)
	}
	if legacy {
		if session != "" {
			request.Header.Set("Mcp-Session-Id", session)
		}
	} else {
		// The transport mirrors the routed fields so an intermediary can read
		// them without parsing the body. They must match it exactly.
		request.Header.Set("Mcp-Method", method)
		if name := routedName(params); name != "" {
			request.Header.Set("Mcp-Name", encodeHeaderValue(name))
		}
	}

	requestHeaders := apps.SurfaceHeaders(request.Header)
	response, err := c.http.Do(request)
	if err != nil {
		return nil, &Exchange{RequestHeaders: requestHeaders}, fmt.Errorf("calling %s: %w", c.endpoint, err)
	}
	defer response.Body.Close()

	exchange := &Exchange{RequestHeaders: requestHeaders, ResponseHeaders: apps.SurfaceHeaders(response.Header)}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if err != nil {
		return nil, exchange, fmt.Errorf("reading %s response: %w", method, err)
	}

	if notification {
		return nil, exchange, nil
	}

	// A JSON-RPC error may arrive under a 4xx status, so the body is read before
	// the status is judged.
	result, rpcErr, decodeErr := decodeResponse(response.Header.Get("Content-Type"), payload)
	if rpcErr != nil {
		return nil, exchange, rpcErr
	}
	if response.StatusCode >= 400 {
		return nil, exchange, apps.NewUpstreamError(http.MethodPost, c.endpoint, response.StatusCode, payload).
			WithHeaders(requestHeaders, exchange.ResponseHeaders)
	}
	if decodeErr != nil {
		return nil, exchange, decodeErr
	}
	return result, exchange, nil
}

// decodeResponse reads the JSON-RPC message out of a response body, which is
// either a single JSON object or an SSE stream whose last data event carries the
// response.
func decodeResponse(contentType string, payload []byte) (json.RawMessage, *jsonRPCError, error) {
	if strings.Contains(strings.ToLower(contentType), "text/event-stream") {
		payload = lastSSEData(payload)
		if payload == nil {
			return nil, nil, fmt.Errorf("the event stream carried no response")
		}
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *jsonRPCError   `json:"error"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(payload), &envelope); err != nil {
		return nil, nil, fmt.Errorf("the response is not JSON-RPC: %s", summarize(payload))
	}
	if envelope.Error != nil {
		return nil, envelope.Error, nil
	}
	if envelope.Result == nil {
		return nil, nil, fmt.Errorf("the response carried neither a result nor an error")
	}
	return envelope.Result, nil, nil
}

// lastSSEData returns the data of the last SSE event in the stream, which is
// where the final response sits. Notifications sent ahead of it (progress, log
// messages) are passed over: kaja has nowhere to put them mid-call.
func lastSSEData(payload []byte) []byte {
	scanner := bufio.NewScanner(bytes.NewReader(payload))
	scanner.Buffer(make([]byte, 0, 64*1024), 32<<20)

	var last []byte
	var current []string
	flush := func() {
		if len(current) == 0 {
			return
		}
		data := []byte(strings.Join(current, "\n"))
		current = nil
		if isJSONRPCResponse(data) {
			last = data
		}
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		switch {
		case line == "":
			flush()
		case strings.HasPrefix(line, ":"):
			// A comment, used as a keep-alive.
		case strings.HasPrefix(line, "data:"):
			current = append(current, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	flush()
	return last
}

// isJSONRPCResponse reports whether an SSE event's data is a response rather
// than one of the notifications the server may send ahead of it.
func isJSONRPCResponse(data []byte) bool {
	var message struct {
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if json.Unmarshal(bytes.TrimSpace(data), &message) != nil {
		return false
	}
	return message.Result != nil || message.Error != nil
}

// routedName is the value the Mcp-Name header mirrors: the tool or prompt being
// called, or the resource being read.
func routedName(params map[string]any) string {
	for _, key := range []string{"name", "uri"} {
		if value, ok := params[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

// encodeHeaderValue renders a value for a mirrored header. Anything that isn't
// printable ASCII travels in the base64 sentinel form the transport defines, so
// the server can still compare it against the body.
func encodeHeaderValue(value string) string {
	if headerSafe(value) {
		return value
	}
	return "=?base64?" + base64Encode(value) + "?="
}

func headerSafe(value string) bool {
	if value == "" || strings.HasPrefix(value, "=?base64?") {
		return false
	}
	if value != strings.TrimSpace(value) {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r > 0x7e {
			return false
		}
	}
	return true
}

func headerValue(headers map[string]string, name string) string {
	for key, value := range headers {
		if strings.EqualFold(key, name) {
			return value
		}
	}
	return ""
}

// pickVersion chooses the newest version both sides speak.
func pickVersion(offered []string) string {
	for _, candidate := range supportedVersions {
		for _, version := range offered {
			if version == candidate {
				return version
			}
		}
	}
	return ""
}

func asRPC(err error, target **jsonRPCError) bool { return errors.As(err, target) }

func asUpstream(err error, target **apps.UpstreamError) bool { return errors.As(err, target) }

func base64Encode(value string) string {
	return base64.StdEncoding.EncodeToString([]byte(value))
}

func summarize(payload []byte) string {
	text := strings.TrimSpace(string(payload))
	if text == "" {
		return "the response was empty"
	}
	if len(text) > 200 {
		return text[:200] + "…"
	}
	return text
}

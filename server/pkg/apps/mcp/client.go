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
	"net/url"
	"strconv"
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
	// credential is what the app sends with every request. It is asked for per
	// request rather than held, because an OAuth token renews itself: a token
	// replaced between two calls has to reach the second one without the app
	// being opened again.
	credential func() (map[string]string, error)

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
func NewClient(endpoint string, credential func() (map[string]string, error), httpClient *http.Client) *Client {
	if credential == nil {
		credential = func() (map[string]string, error) { return nil, nil }
	}
	return &Client{endpoint: endpoint, http: httpClient, credential: credential, version: ProtocolVersion}
}

// Exchange is what one JSON-RPC call exchanged with the server, surfaced in the
// client's Headers view.
type Exchange struct {
	RequestHeaders  map[string]string
	ResponseHeaders map[string]string
	// Request and Status are the HTTP call under the JSON-RPC one, which the Headers
	// view states around those headers. A call that never reached the server has the
	// request line and no status.
	Request    string
	Status     int
	StatusText string
	// Notices are what the server said while it was working: the progress and log
	// notifications it sent on the response stream ahead of the response itself.
	Notices []string
}

// Call sends one JSON-RPC request and returns the result object. The `_meta`
// request metadata (modern) or the `initialize` handshake (legacy) is applied
// here, so callers only ever name a method and its params.
//
// mirrored is the tool's `x-mcp-header` parameters and their values, keyed by
// the name portion of the `Mcp-Param-{Name}` header each travels under. The
// transport decides whether they are sent, since the era decides whether the
// server expects them at all.
func (c *Client) Call(method string, params map[string]any, extra map[string]string, mirrored map[string]string) (json.RawMessage, *Exchange, error) {
	if err := c.ensureEra(); err != nil {
		return nil, nil, err
	}
	return c.send(method, params, extra, mirrored)
}

// send issues one request in the era already settled on, re-running a legacy
// handshake once if the server has forgotten the session.
func (c *Client) send(method string, params map[string]any, extra map[string]string, mirrored map[string]string) (json.RawMessage, *Exchange, error) {
	result, exchange, err := c.attempt(method, params, extra, mirrored)
	if err == nil {
		return result, exchange, nil
	}

	// A legacy server that has dropped the session refuses the request; one
	// handshake later the same request works. Anything else is the caller's to see.
	c.mu.Lock()
	legacy, session := c.legacy, c.session
	c.mu.Unlock()
	if legacy && session != "" && sessionLost(err) {
		c.mu.Lock()
		c.session, c.handshook = "", false
		c.mu.Unlock()
		if err := c.handshake(); err != nil {
			return nil, nil, err
		}
		return c.attempt(method, params, extra, mirrored)
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
			return c.attempt(method, params, extra, mirrored)
		}
	}
	return nil, exchange, err
}

// sessionLost reads a refusal as the server having forgotten the session. The
// specification says a terminated session is a 404, and the reference server
// answers an unknown one with a 400 that names the session; either arrives as a
// bare status or as a JSON-RPC error under it, and every server built on the
// reference SDK answers with the second.
func sessionLost(err error) bool {
	var upstream *apps.UpstreamError
	var rpcErr *jsonRPCError
	status, message := 0, ""
	switch {
	case asUpstream(err, &upstream):
		status, message = upstream.Status, string(upstream.Body)
	case asRPC(err, &rpcErr):
		status, message = rpcErr.Status, rpcErr.Message
	}
	switch status {
	case http.StatusNotFound:
		return true
	case http.StatusBadRequest:
		return strings.Contains(strings.ToLower(message), "session")
	}
	return false
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

	result, _, err := c.attempt("server/discover", nil, nil, nil)
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
	// A server that never answered has said nothing about its era, and the
	// handshake would be the same wait a second time: a server that hangs cost
	// the form twice its timeout before it said so.
	var transport *url.Error
	if errors.As(err, &transport) {
		return err
	}
	return c.toLegacy()
}

// notMCP is an answer that is not a JSON-RPC message. Whatever is at the
// endpoint, it is not speaking MCP, and the form says so rather than reporting
// a server that could not be read.
type notMCP struct{ reason string }

func (e *notMCP) Error() string { return e.reason }

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
	}, nil, nil)
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
	_, _, _ = c.attempt("notifications/initialized", nil, nil, nil)
	return nil
}

// attempt performs one HTTP POST carrying one JSON-RPC message. A notification
// (a method with no id) returns no result.
func (c *Client) attempt(method string, params map[string]any, extra map[string]string, mirrored map[string]string) (json.RawMessage, *Exchange, error) {
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
	meta := map[string]any{}
	if !legacy && method != "initialize" {
		// The modern era carries the protocol metadata in the body; the headers
		// below only mirror it.
		meta[metaProtocolVersion] = version
		meta[metaClientInfo] = map[string]any{"name": clientName, "version": "2"}
		meta[metaClientCapabilities] = map[string]any{}
	}
	if reportsProgress[method] {
		// A server sends progress only to a caller that asked for it, and the
		// token is what asks. The request id is as good a token as any: one
		// request travels per exchange, so nothing has to match them up.
		meta["progressToken"] = id
	}
	if len(meta) > 0 {
		params["_meta"] = meta
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
	headers, err := c.credential()
	if err != nil {
		return nil, nil, err
	}
	// The app's own headers are the more specific instruction: a header written
	// out by hand outranks the credential kaja derived.
	for name, value := range headers {
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
		// A mirrored parameter is the server's own instruction about its tool, so
		// it is written last: a header configured under the same name would send
		// an intermediary somewhere the body does not agree with.
		for name, value := range mirrored {
			request.Header.Set(headerParamPrefix+name, encodeHeaderValue(value))
		}
	}

	requestHeaders := apps.SurfaceHeaders(request.Header)
	response, err := c.http.Do(request)
	if err != nil {
		return nil, &Exchange{RequestHeaders: requestHeaders, Request: http.MethodPost + " " + c.endpoint}, fmt.Errorf("calling %s: %w", c.endpoint, err)
	}
	defer response.Body.Close()

	exchange := &Exchange{
		RequestHeaders:  requestHeaders,
		ResponseHeaders: apps.SurfaceHeaders(response.Header),
		Request:         http.MethodPost + " " + c.endpoint,
		Status:          response.StatusCode,
		StatusText:      http.StatusText(response.StatusCode),
	}
	if notification {
		return nil, exchange, nil
	}

	// A JSON-RPC error may arrive under a 4xx status, so the body is read before
	// the status is judged.
	payload, result, notices, rpcErr, decodeErr := decodeResponse(response.Header.Get("Content-Type"), io.LimitReader(response.Body, 32<<20))
	exchange.Notices = notices
	if rpcErr != nil {
		rpcErr.Status = response.StatusCode
		return nil, exchange, rpcErr
	}
	if response.StatusCode >= 400 {
		// The headers ride on the Exchange, not on the error. A failed call has
		// two destinations and only one of them has a Headers view to put them
		// in: `Invoke` attaches them (`withExchange`), and opening the app - whose
		// failures are text in the compile log - leaves them where they are.
		return nil, exchange, apps.NewUpstreamError(http.MethodPost, c.endpoint, response.StatusCode, payload)
	}
	if decodeErr != nil {
		return nil, exchange, decodeErr
	}
	return result, exchange, nil
}

// reportsProgress names the requests a server does work for, which are the ones
// worth hearing about while they run.
var reportsProgress = map[string]bool{"tools/call": true, "prompts/get": true, "resources/read": true}

// decodeResponse reads the JSON-RPC message out of a response body, which is
// either a single JSON object or an SSE stream carrying the response after the
// notifications the server sent on the way there. The message's bytes come back
// beside what was read out of them, because a body that isn't JSON-RPC usually
// arrived under a failure status, and the failure wants it whole.
func decodeResponse(contentType string, body io.Reader) (payload []byte, result json.RawMessage, notices []string, rpcErr *jsonRPCError, err error) {
	if strings.Contains(strings.ToLower(contentType), "text/event-stream") {
		payload, notices = readSSE(body)
		if payload == nil {
			return nil, nil, notices, nil, fmt.Errorf("the event stream carried no response")
		}
	} else if payload, err = io.ReadAll(body); err != nil {
		return nil, nil, nil, nil, fmt.Errorf("reading the response: %w", err)
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *jsonRPCError   `json:"error"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(payload), &envelope); err != nil {
		return payload, nil, notices, nil, &notMCP{"the response is not JSON-RPC: " + summarize(payload)}
	}
	if envelope.Error != nil {
		return payload, nil, notices, envelope.Error, nil
	}
	if envelope.Result == nil {
		return payload, nil, notices, nil, &notMCP{"the response carried neither a result nor an error: " + summarize(payload)}
	}
	return payload, envelope.Result, notices, nil, nil
}

// readSSE reads a response stream: the data of the event carrying the response,
// and a line for each notification the server sent ahead of it. Those
// notifications are what a slow call has to say about itself while it is being
// made, and a call that says nothing for a minute is indistinguishable from one
// that failed.
//
// It stops at the response rather than at the end of the stream. A server is
// meant to close the stream once it has answered, and one that keeps it open to
// send keep-alives instead would otherwise hold the call until it timed out.
func readSSE(body io.Reader) ([]byte, []string) {
	// A notice rides in the same trailer the exchange does, so a server that logs
	// in a loop must not be what pushes the failure out of it.
	const (
		noticeLimit = 50
		noticeChars = 500
	)
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 32<<20)

	var last []byte
	var notices []string
	var current []string
	flush := func() {
		if len(current) == 0 {
			return
		}
		data := []byte(strings.Join(current, "\n"))
		current = nil
		if isJSONRPCResponse(data) {
			last = data
			return
		}
		if notice := noticeOf(data); notice != "" && len(notices) < noticeLimit {
			if len(notice) > noticeChars {
				notice = notice[:noticeChars] + "…"
			}
			notices = append(notices, notice)
		}
	}
	for last == nil && scanner.Scan() {
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
	return last, notices
}

// noticeOf renders one notification as the line the call reports it as. Only the
// two the specification scopes to the request are read: a log message and a
// progress report are about the call being made, and anything else on the stream
// is about the server rather than about this call.
func noticeOf(data []byte) string {
	var message struct {
		Method string `json:"method"`
		Params struct {
			Level    string          `json:"level"`
			Logger   string          `json:"logger"`
			Data     json.RawMessage `json:"data"`
			Message  string          `json:"message"`
			Progress float64         `json:"progress"`
			Total    *float64        `json:"total"`
		} `json:"params"`
	}
	if json.Unmarshal(bytes.TrimSpace(data), &message) != nil {
		return ""
	}
	params := message.Params
	switch message.Method {
	case "notifications/message":
		parts := []string{}
		if params.Level != "" {
			parts = append(parts, params.Level)
		}
		if params.Logger != "" {
			parts = append(parts, params.Logger)
		}
		text := noticeText(params.Data)
		if text == "" {
			text = "(no message)"
		}
		if len(parts) == 0 {
			return text
		}
		return strings.Join(parts, " ") + ": " + text
	case "notifications/progress":
		if params.Message == "" && params.Total == nil && params.Progress == 0 {
			// A count of nothing towards no total: the server has said it is
			// working, which is what the running indicator already says.
			return ""
		}
		measure := trimFloat(params.Progress)
		if params.Total != nil {
			measure += "/" + trimFloat(*params.Total)
		}
		if params.Message != "" {
			return params.Message + " (" + measure + ")"
		}
		return measure
	}
	return ""
}

// noticeText is a log notification's data as one line. A string is the line; a
// structure the server chose to log is its own JSON, which is more than a
// placeholder saying something was logged.
func noticeText(data json.RawMessage) string {
	if len(data) == 0 {
		return ""
	}
	var text string
	if json.Unmarshal(data, &text) == nil {
		return strings.TrimSpace(text)
	}
	var compact bytes.Buffer
	if json.Compact(&compact, data) != nil {
		return ""
	}
	return compact.String()
}

func trimFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
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

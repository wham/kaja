package openai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"

	"github.com/wham/kaja/v2/pkg/apps"
)

// instance is a live opened chat app. It is a gRPC app: a ChatCompletion call
// arrives as protobuf, is transcoded into a POST against the endpoint, and the
// JSON response is shaped back into the protobuf response. The wire says which
// API's shapes those are.
type instance struct {
	endpoint string
	wire     wire
	auth     string
	token    string
	keyName  string
	input    protoreflect.MessageDescriptor
	output   protoreflect.MessageDescriptor
	client   *http.Client
}

func (in *instance) Invoke(methodPath string, request []byte, headers map[string]string) (*apps.InvokeResult, error) {
	if lastSegment(methodPath) != "ChatCompletion" {
		return nil, fmt.Errorf("unknown method %q", methodPath)
	}

	reqMsg := dynamicpb.NewMessage(in.input)
	if len(request) > 0 {
		if err := proto.Unmarshal(request, reqMsg); err != nil {
			return nil, fmt.Errorf("decoding request: %w", err)
		}
	}

	call, err := in.readChat(reqMsg)
	if err != nil {
		return nil, err
	}
	body, err := in.wire.request(call)
	if err != nil {
		return nil, err
	}

	respBody, status, reqHeaders, respHeaders, err := in.call(body, headers)
	if err != nil {
		return nil, err
	}

	respMsg := dynamicpb.NewMessage(in.output)
	if status >= 400 {
		// Surface the upstream failure as a structured error on the response
		// rather than a flat transport error, so the status code, the OpenAI
		// error type/code/param and the raw body are all visible in the response.
		return in.encodeError(respMsg, parseUpstreamError(status, respBody), reqHeaders, respHeaders)
	}

	shaped, err := in.wire.response(respBody)
	if err != nil {
		return nil, fmt.Errorf("decoding response JSON: %w", err)
	}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(shaped, respMsg); err != nil {
		return nil, fmt.Errorf("decoding response JSON: %w", err)
	}
	setReplyContent(respMsg)
	out, err := proto.Marshal(respMsg)
	if err != nil {
		return nil, err
	}
	return &apps.InvokeResult{Body: out, RequestHeaders: reqHeaders, ResponseHeaders: respHeaders}, nil
}

// encodeError populates the response's "error" field from the structured upstream
// error and marshals it into an InvokeResult that still carries the upstream
// headers exchanged.
func (in *instance) encodeError(respMsg *dynamicpb.Message, upstream map[string]any, reqHeaders, respHeaders map[string]string) (*apps.InvokeResult, error) {
	payload, err := json.Marshal(map[string]any{"error": upstream})
	if err != nil {
		return nil, fmt.Errorf("encoding error response: %w", err)
	}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(payload, respMsg); err != nil {
		return nil, fmt.Errorf("encoding error response: %w", err)
	}
	out, err := proto.Marshal(respMsg)
	if err != nil {
		return nil, err
	}
	return &apps.InvokeResult{Body: out, RequestHeaders: reqHeaders, ResponseHeaders: respHeaders}, nil
}

// readChat reads the decoded ChatCompletion request off the proto surface. The
// optional sampling fields stay optional - an unset one is left for the wire to
// omit or to default - which is why they come back as pointers.
func (in *instance) readChat(reqMsg *dynamicpb.Message) (chat, error) {
	fields := in.input.Fields()
	getString := func(name string) string {
		return reqMsg.Get(fields.ByName(protoreflect.Name(name))).String()
	}

	model := strings.TrimSpace(getString("model"))
	if model == "" {
		return chat{}, fmt.Errorf("model is required")
	}

	call := chat{
		model:        model,
		systemPrompt: getString("system_prompt"),
		userPrompt:   getString("user_prompt"),
	}
	if fd := fields.ByName("temperature"); reqMsg.Has(fd) {
		value := reqMsg.Get(fd).Float()
		call.temperature = &value
	}
	if fd := fields.ByName("max_tokens"); reqMsg.Has(fd) {
		value := reqMsg.Get(fd).Int()
		call.maxTokens = &value
	}
	if fd := fields.ByName("top_p"); reqMsg.Has(fd) {
		value := reqMsg.Get(fd).Float()
		call.topP = &value
	}
	return call, nil
}

// call POSTs the request body to the configured endpoint, returning the raw
// response body, HTTP status code, and the headers exchanged with the upstream.
// An error is returned only for transport failures (the upstream could not be
// reached); HTTP error responses are returned with their status so the caller
// can shape them into a structured error.
func (in *instance) call(body []byte, headers map[string]string) ([]byte, int, map[string]string, map[string]string, error) {
	httpReq, err := http.NewRequest(http.MethodPost, in.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, nil, nil, fmt.Errorf("building request: %w", err)
	}
	// What the API insists on and the credential go on first, so a header the app
	// configures under the same name outranks them - the same rule the other apps
	// apply to their own credentials. The content type is kaja's either way: the
	// body it just encoded is JSON whatever the app says.
	for name, value := range in.wire.required() {
		httpReq.Header.Set(name, value)
	}
	in.setCredential(httpReq.Header)
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Content-Type", "application/json")
	reqHeaders := apps.SurfaceHeaders(httpReq.Header)

	resp, err := in.client.Do(httpReq)
	if err != nil {
		return nil, 0, reqHeaders, nil, fmt.Errorf("calling %s: %w", in.endpoint, err)
	}
	defer resp.Body.Close()
	respHeaders := apps.SurfaceHeaders(resp.Header)

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, resp.StatusCode, reqHeaders, respHeaders, fmt.Errorf("reading response: %w", err)
	}
	return respBody, resp.StatusCode, reqHeaders, respHeaders, nil
}

// setCredential applies the app's one credential in the shape its API asks for.
// Nothing is sent when there is no token to send.
func (in *instance) setCredential(header http.Header) {
	if in.auth == authNone || in.token == "" {
		return
	}
	switch in.auth {
	case authAPIKey:
		header.Set(in.keyName, in.token)
	default:
		header.Set("Authorization", "Bearer "+in.token)
	}
}

// parseUpstreamError turns a failed (HTTP >= 400) upstream response into the
// structured error shape exposed on ChatCompletionResponse.error. It understands
// the OpenAI error envelope ({"error": {"message", "type", "code", "param"}}),
// which the Claude API shares, and falls back to the raw body for anything else.
func parseUpstreamError(status int, body []byte) map[string]any {
	result := map[string]any{
		"status": status,
		"body":   truncate(body, 4000),
	}

	var envelope struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
	}
	if json.Unmarshal(body, &envelope) == nil {
		if len(bytes.TrimSpace(envelope.Error)) > 0 {
			var detail struct {
				Message string          `json:"message"`
				Type    string          `json:"type"`
				Code    json.RawMessage `json:"code"`
				Param   json.RawMessage `json:"param"`
			}
			if json.Unmarshal(envelope.Error, &detail) == nil && detail.Message != "" {
				result["message"] = detail.Message
				result["type"] = detail.Type
				result["code"] = rawString(detail.Code)
				result["param"] = rawString(detail.Param)
			} else if s := rawString(envelope.Error); s != "" {
				result["message"] = s
			}
		} else if envelope.Message != "" {
			result["message"] = envelope.Message
		}
	}
	if _, ok := result["message"]; !ok {
		if text := http.StatusText(status); text != "" {
			result["message"] = text
		} else {
			result["message"] = fmt.Sprintf("upstream returned HTTP %d", status)
		}
	}
	return result
}

// rawString renders a JSON value as a plain string, treating null/absent as "".
func rawString(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return trimmed
}

// setReplyContent copies the first choice's message content into the top-level
// convenience "content" field of the response.
func setReplyContent(respMsg *dynamicpb.Message) {
	desc := respMsg.Descriptor()
	choicesFd := desc.Fields().ByName("choices")
	contentFd := desc.Fields().ByName("content")
	if choicesFd == nil || contentFd == nil {
		return
	}
	choices := respMsg.Get(choicesFd).List()
	if choices.Len() == 0 {
		return
	}
	choice := choices.Get(0).Message()
	messageFd := choicesFd.Message().Fields().ByName("message")
	if messageFd == nil || !choice.Has(messageFd) {
		return
	}
	message := choice.Get(messageFd).Message()
	msgContentFd := messageFd.Message().Fields().ByName("content")
	if msgContentFd == nil {
		return
	}
	respMsg.Set(contentFd, protoreflect.ValueOfString(message.Get(msgContentFd).String()))
}

func lastSegment(s string) string {
	if i := strings.LastIndex(s, "/"); i >= 0 {
		return s[i+1:]
	}
	return s
}

func truncate(b []byte, n int) string {
	s := strings.TrimSpace(string(b))
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

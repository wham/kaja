package openai

import (
	"bytes"
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

	// Whatever comes back, what is reported is the HTTP call that was made: the
	// request line, the status, the headers exchanged and the body verbatim. The
	// app models none of it in its own response, so nothing it can't model is lost.
	if status >= 400 {
		return nil, apps.NewUpstreamError(http.MethodPost, in.endpoint, status, respBody).WithHeaders(reqHeaders, respHeaders)
	}

	respMsg := dynamicpb.NewMessage(in.output)
	shaped, err := in.wire.response(respBody)
	if err == nil {
		err = (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(shaped, respMsg)
	}
	if err != nil {
		// The API answered and what it answered is not what this one answers - usually
		// an endpoint speaking the other API. Saying so with the body attached is what
		// tells the two apart; a codec error on its own names neither.
		reason := fmt.Sprintf("the response is not %s: %v", in.wire.answer(), err)
		return nil, apps.NewUnreadableResponse(http.MethodPost, in.endpoint, status, respBody, reason).WithHeaders(reqHeaders, respHeaders)
	}
	setReplyContent(respMsg)
	out, err := proto.Marshal(respMsg)
	if err != nil {
		return nil, err
	}
	return &apps.InvokeResult{Body: out, RequestHeaders: reqHeaders, ResponseHeaders: respHeaders}, nil
}

// The optional sampling fields come back as pointers because an unset one is
// left for the wire to omit or to default.
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

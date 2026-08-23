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

// instance is a live opened OpenAI app. It is a gRPC app: a ChatCompletion call
// arrives as protobuf, is transcoded into a POST against the chat completions
// endpoint, and the JSON response is shaped back into the protobuf response.
type instance struct {
	endpoint string
	token    string
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

	body, err := in.buildRequestBody(reqMsg)
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
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(respBody, respMsg); err != nil {
		// The API answered and what it answered is not a chat completion - usually an
		// endpoint that speaks a different API. Saying so with the body attached is what
		// tells the two apart; a codec error on its own names neither.
		reason := fmt.Sprintf("the response is not an OpenAI chat completion: %v", err)
		return nil, apps.NewUnreadableResponse(http.MethodPost, in.endpoint, status, respBody, reason).WithHeaders(reqHeaders, respHeaders)
	}
	setReplyContent(respMsg)
	out, err := proto.Marshal(respMsg)
	if err != nil {
		return nil, err
	}
	return &apps.InvokeResult{Body: out, RequestHeaders: reqHeaders, ResponseHeaders: respHeaders}, nil
}

// buildRequestBody turns the decoded ChatCompletion request into the JSON body
// the OpenAI chat completions endpoint expects: the system and user prompts are
// folded into a messages array and the optional sampling fields are passed
// through only when the caller set them.
func (in *instance) buildRequestBody(reqMsg *dynamicpb.Message) ([]byte, error) {
	fields := in.input.Fields()
	getString := func(name string) string {
		return reqMsg.Get(fields.ByName(protoreflect.Name(name))).String()
	}

	model := strings.TrimSpace(getString("model"))
	if model == "" {
		return nil, fmt.Errorf("model is required")
	}

	messages := []map[string]string{}
	if system := getString("system_prompt"); system != "" {
		messages = append(messages, map[string]string{"role": "system", "content": system})
	}
	messages = append(messages, map[string]string{"role": "user", "content": getString("user_prompt")})

	payload := map[string]any{
		"model":    model,
		"messages": messages,
	}
	if fd := fields.ByName("temperature"); reqMsg.Has(fd) {
		payload["temperature"] = reqMsg.Get(fd).Float()
	}
	if fd := fields.ByName("max_tokens"); reqMsg.Has(fd) {
		payload["max_tokens"] = reqMsg.Get(fd).Int()
	}
	if fd := fields.ByName("top_p"); reqMsg.Has(fd) {
		payload["top_p"] = reqMsg.Get(fd).Float()
	}

	return json.Marshal(payload)
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
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Content-Type", "application/json")
	if in.token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+in.token)
	}
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

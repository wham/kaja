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
)

// instance is a live opened OpenAI app. It is a gRPC app: a ChatCompletion call
// arrives as protobuf, is transcoded into a POST against the chat completions
// endpoint, and the JSON response is shaped back into the protobuf response.
type instance struct {
	baseURL string
	token   string
	input   protoreflect.MessageDescriptor
	output  protoreflect.MessageDescriptor
	client  *http.Client
}

func (in *instance) Invoke(methodPath string, request []byte, headers map[string]string) ([]byte, error) {
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

	respJSON, err := in.call(body, headers)
	if err != nil {
		return nil, err
	}

	respMsg := dynamicpb.NewMessage(in.output)
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(respJSON, respMsg); err != nil {
		return nil, fmt.Errorf("decoding response JSON: %w", err)
	}
	setReplyContent(respMsg)
	return proto.Marshal(respMsg)
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

// call POSTs the request body to <base_url>/chat/completions, returning the raw
// JSON response body.
func (in *instance) call(body []byte, headers map[string]string) ([]byte, error) {
	endpoint := in.baseURL + "/chat/completions"
	httpReq, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Content-Type", "application/json")
	if in.token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+in.token)
	}

	resp, err := in.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("calling %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("upstream %s returned %s: %s", endpoint, resp.Status, truncate(respBody, 500))
	}
	return respBody, nil
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

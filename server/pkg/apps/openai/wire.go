package openai

import (
	"encoding/json"
	"fmt"
	"strings"
)

// The APIs this app speaks. The method surface is the same either way; what
// differs is the body sent, the response read back, and the header the credential
// travels under.
const (
	apiOpenAI    = "openai"
	apiAnthropic = "anthropic"
)

// The credential kinds an app can send.
const (
	authBearer = "bearer"
	authAPIKey = "apikey"
	authNone   = "none"
)

// The header an API key travels under when the app doesn't name one.
const defaultAPIKeyName = "x-api-key"

// The Claude API rejects a request that doesn't state which version of it the
// caller was written against.
const anthropicVersion = "2023-06-01"

// The Claude API requires max_tokens, so a caller who left the optional field
// unset gets this rather than a 400.
const anthropicDefaultMaxTokens = 4096

// chat is a ChatCompletion request read off kaja's own proto surface, before
// either API has had its say about how to write it down.
type chat struct {
	model        string
	systemPrompt string
	userPrompt   string
	temperature  *float64
	maxTokens    *int64
	topP         *float64
}

// wire is the pair of translations that differ between the two APIs: what a
// ChatCompletion becomes on the way out, and what the upstream's JSON becomes on
// the way back. Both ends speak kaja's own proto surface, so a script that swaps
// one app for the other keeps working.
type wire interface {
	// name is the value written in the app's `api` parameter.
	name() string
	// endpoint the API is served at when the app names none.
	endpoint() string
	// defaultAuth is the credential the API's own dashboard hands you.
	defaultAuth() string
	// required is what the API insists on beside the credential.
	required() map[string]string
	// request encodes the call as the API's own request body.
	request(call chat) ([]byte, error)
	// response reshapes the API's own response into ChatCompletionResponse's
	// shape. It hands back bytes rather than a message so protojson stays the one
	// place the proto surface is written.
	response(body []byte) ([]byte, error)
}

// wireFor resolves the app's `api` parameter. An empty value is the OpenAI API,
// which is the only one this app spoke before there was a choice.
func wireFor(name string) (wire, error) {
	switch strings.TrimSpace(strings.ToLower(name)) {
	case "", apiOpenAI:
		return openAIWire{}, nil
	case apiAnthropic:
		return anthropicWire{}, nil
	default:
		return nil, fmt.Errorf("unknown api %q (use %q or %q)", name, apiOpenAI, apiAnthropic)
	}
}

// openAIWire is the OpenAI chat completions API, which is also what every
// OpenAI-compatible endpoint speaks.
type openAIWire struct{}

func (openAIWire) name() string     { return apiOpenAI }
func (openAIWire) endpoint() string { return "https://api.openai.com/v1/chat/completions" }
func (openAIWire) defaultAuth() string {
	return authBearer
}
func (openAIWire) required() map[string]string { return nil }

// request folds the system and user prompts into a messages array and passes the
// optional sampling fields through only when the caller set them.
func (openAIWire) request(call chat) ([]byte, error) {
	messages := []map[string]string{}
	if call.systemPrompt != "" {
		messages = append(messages, map[string]string{"role": "system", "content": call.systemPrompt})
	}
	messages = append(messages, map[string]string{"role": "user", "content": call.userPrompt})

	payload := map[string]any{"model": call.model, "messages": messages}
	if call.temperature != nil {
		payload["temperature"] = *call.temperature
	}
	if call.maxTokens != nil {
		payload["max_tokens"] = *call.maxTokens
	}
	if call.topP != nil {
		payload["top_p"] = *call.topP
	}
	return json.Marshal(payload)
}

// The response already is the shape the proto surface was written from.
func (openAIWire) response(body []byte) ([]byte, error) { return body, nil }

// anthropicWire is the Claude Messages API. The system prompt is a top-level
// field rather than a message, max_tokens is required, and the reply arrives as a
// list of content blocks.
type anthropicWire struct{}

func (anthropicWire) name() string        { return apiAnthropic }
func (anthropicWire) endpoint() string    { return "https://api.anthropic.com/v1/messages" }
func (anthropicWire) defaultAuth() string { return authAPIKey }
func (anthropicWire) required() map[string]string {
	return map[string]string{"anthropic-version": anthropicVersion}
}

func (anthropicWire) request(call chat) ([]byte, error) {
	maxTokens := int64(anthropicDefaultMaxTokens)
	if call.maxTokens != nil {
		maxTokens = *call.maxTokens
	}
	payload := map[string]any{
		"model":      call.model,
		"max_tokens": maxTokens,
		"messages":   []map[string]string{{"role": "user", "content": call.userPrompt}},
	}
	if call.systemPrompt != "" {
		payload["system"] = call.systemPrompt
	}
	if call.temperature != nil {
		payload["temperature"] = *call.temperature
	}
	if call.topP != nil {
		payload["top_p"] = *call.topP
	}
	return json.Marshal(payload)
}

// response turns a Message into the one-choice completion the proto surface
// describes. stop_reason travels as the finish reason verbatim rather than
// translated into OpenAI's vocabulary: what the API said is what the response tab
// should show.
func (anthropicWire) response(body []byte) ([]byte, error) {
	var message struct {
		ID      string `json:"id"`
		Model   string `json:"model"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
		Usage      struct {
			InputTokens  int64 `json:"input_tokens"`
			OutputTokens int64 `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &message); err != nil {
		return nil, err
	}

	var reply strings.Builder
	for _, block := range message.Content {
		if block.Type == "text" {
			reply.WriteString(block.Text)
		}
	}

	return json.Marshal(map[string]any{
		"id":    message.ID,
		"model": message.Model,
		"choices": []any{map[string]any{
			"index":         0,
			"message":       map[string]any{"role": "assistant", "content": reply.String()},
			"finish_reason": message.StopReason,
		}},
		"usage": map[string]any{
			"prompt_tokens":     message.Usage.InputTokens,
			"completion_tokens": message.Usage.OutputTokens,
			"total_tokens":      message.Usage.InputTokens + message.Usage.OutputTokens,
		},
	})
}

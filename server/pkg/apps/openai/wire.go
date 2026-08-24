package openai

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	apiOpenAI    = "openai"
	apiAnthropic = "anthropic"
)

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

type chat struct {
	model        string
	systemPrompt string
	userPrompt   string
	temperature  *float64
	maxTokens    *int64
	topP         *float64
}

// wire is the pair of translations that differ between the two APIs. Both ends
// speak kaja's own proto surface, so a script that swaps one app for the other
// keeps working.
type wire interface {
	name() string
	endpoint() string
	// answer names what a good response is, for the report on one that isn't.
	answer() string
	// recognizes says whether a body is this API's own answer. A request meant for
	// one API is often accepted by the other - they agree on model, messages and
	// max_tokens - so the response is where the mix-up surfaces, and naming the API
	// that did answer is the diagnosis a codec error cannot give.
	recognizes(body []byte) bool
	// defaultAuth is the credential the API's own dashboard hands you.
	defaultAuth() string
	// required is what the API insists on beside the credential.
	required() map[string]string
	request(call chat) ([]byte, error)
	// response reshapes the API's own response into ChatCompletionResponse's
	// shape. It hands back bytes rather than a message so protojson stays the one
	// place the proto surface is written.
	response(body []byte) ([]byte, error)
}

// An empty api is the OpenAI one, which is all this app spoke before there was a
// choice.
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

// otherWire is the API a body did come from, where that is the other one this app
// speaks.
func otherWire(body []byte, current wire) wire {
	for _, candidate := range []wire{openAIWire{}, anthropicWire{}} {
		if candidate.name() != current.name() && candidate.recognizes(body) {
			return candidate
		}
	}
	return nil
}

// openAIWire is also what every OpenAI-compatible endpoint speaks.
type openAIWire struct{}

func (openAIWire) name() string                { return apiOpenAI }
func (openAIWire) answer() string              { return "an OpenAI chat completion" }
func (openAIWire) endpoint() string            { return "https://api.openai.com/v1/chat/completions" }
func (openAIWire) defaultAuth() string         { return authBearer }
func (openAIWire) required() map[string]string { return nil }

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

func (openAIWire) recognizes(body []byte) bool {
	var completion struct {
		Object  string `json:"object"`
		Choices []struct {
			Message *struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &completion); err != nil {
		return false
	}
	if completion.Object == "chat.completion" {
		return true
	}
	return len(completion.Choices) > 0 && completion.Choices[0].Message != nil
}

type anthropicWire struct{}

func (anthropicWire) name() string        { return apiAnthropic }
func (anthropicWire) answer() string      { return "a Claude message" }
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
		// The system prompt is a field of its own here, not a message.
		"messages": []map[string]string{{"role": "user", "content": call.userPrompt}},
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

type anthropicMessage struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
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

func (anthropicWire) recognizes(body []byte) bool {
	var message anthropicMessage
	return json.Unmarshal(body, &message) == nil && message.Type == "message"
}

func (anthropicWire) response(body []byte) ([]byte, error) {
	var message anthropicMessage
	if err := json.Unmarshal(body, &message); err != nil {
		return nil, err
	}
	// Every field here is optional to a JSON decoder, so a chat completion decodes
	// into an empty message rather than failing. The discriminator is what stops an
	// endpoint speaking the other API from coming back as a blank reply.
	if message.Type != "message" {
		return nil, fmt.Errorf("no message in the response (its type is %q)", message.Type)
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
			"index":   0,
			"message": map[string]any{"role": "assistant", "content": reply.String()},
			// Verbatim rather than translated into OpenAI's vocabulary: what the
			// API said is what the response tab should show.
			"finish_reason": message.StopReason,
		}},
		"usage": map[string]any{
			"prompt_tokens":     message.Usage.InputTokens,
			"completion_tokens": message.Usage.OutputTokens,
			"total_tokens":      message.Usage.InputTokens + message.Usage.OutputTokens,
		},
	})
}

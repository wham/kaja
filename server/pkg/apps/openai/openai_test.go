package openai

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/dynamicpb"

	"github.com/wham/kaja/v2/pkg/apps"
)

// openTestApp opens the app against a fake upstream and returns the live instance.
func openTestApp(t *testing.T, endpoint, token string) *instance {
	t.Helper()
	return openTestAppWith(t, map[string]string{"endpoint": endpoint, "token": token})
}

// openTestAppWith is openTestApp for a test that has more than the endpoint and
// the token to say about the app.
func openTestAppWith(t *testing.T, parameters map[string]string) *instance {
	t.Helper()
	opened, err := New().Open(parameters, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return opened.Instance.(*instance)
}

// encodeRequest builds the protobuf ChatCompletion request bytes from a JSON object.
func encodeRequest(t *testing.T, in *instance, requestJSON string) []byte {
	t.Helper()
	msg := dynamicpb.NewMessage(in.input)
	if err := protojson.Unmarshal([]byte(requestJSON), msg); err != nil {
		t.Fatalf("build request: %v", err)
	}
	b, err := proto.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	return b
}

// decodeResponse turns the protobuf response bytes back into JSON.
func decodeResponse(t *testing.T, in *instance, result *apps.InvokeResult) map[string]any {
	t.Helper()
	msg := dynamicpb.NewMessage(in.output)
	if err := proto.Unmarshal(result.Body, msg); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	j, err := protojson.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal response json: %v", err)
	}
	out := map[string]any{}
	if err := json.Unmarshal(j, &out); err != nil {
		t.Fatalf("decode response json: %v", err)
	}
	return out
}

func TestChatCompletion(t *testing.T) {
	var gotBody map[string]any
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(b, &gotBody); err != nil {
			t.Errorf("decode upstream body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{
			"id": "chatcmpl-1",
			"model": "gpt-4o-mini",
			"choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello there!"}, "finish_reason": "stop"}],
			"usage": {"prompt_tokens": 9, "completion_tokens": 3, "total_tokens": 12}
		}`)
	}))
	defer server.Close()

	in := openTestApp(t, server.URL+"/chat/completions", "secret-token")

	req := encodeRequest(t, in, `{
		"model": "gpt-4o-mini",
		"system_prompt": "Be nice",
		"user_prompt": "Hi",
		"temperature": 0.5,
		"max_tokens": 64
	}`)
	resp, err := in.Invoke("openai.OpenAI/ChatCompletion", req, nil)
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}

	if gotAuth != "Bearer secret-token" {
		t.Errorf("Authorization = %q, want Bearer secret-token", gotAuth)
	}
	if gotBody["model"] != "gpt-4o-mini" {
		t.Errorf("upstream model = %v", gotBody["model"])
	}
	if gotBody["temperature"] != 0.5 {
		t.Errorf("upstream temperature = %v", gotBody["temperature"])
	}
	if gotBody["max_tokens"].(float64) != 64 {
		t.Errorf("upstream max_tokens = %v", gotBody["max_tokens"])
	}
	if _, ok := gotBody["top_p"]; ok {
		t.Errorf("top_p should be omitted when unset, got %v", gotBody["top_p"])
	}
	messages, ok := gotBody["messages"].([]any)
	if !ok || len(messages) != 2 {
		t.Fatalf("messages = %v", gotBody["messages"])
	}
	system := messages[0].(map[string]any)
	if system["role"] != "system" || system["content"] != "Be nice" {
		t.Errorf("system message = %v", system)
	}
	user := messages[1].(map[string]any)
	if user["role"] != "user" || user["content"] != "Hi" {
		t.Errorf("user message = %v", user)
	}

	out := decodeResponse(t, in, resp)
	if out["content"] != "Hello there!" {
		t.Errorf("content = %v, want Hello there!", out["content"])
	}
	if out["id"] != "chatcmpl-1" {
		t.Errorf("id = %v", out["id"])
	}
	usage, ok := out["usage"].(map[string]any)
	if !ok || usage["total_tokens"].(float64) != 12 {
		t.Errorf("usage = %v", out["usage"])
	}
}

func TestChatCompletionOmitsSystemPromptWhenEmpty(t *testing.T) {
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &gotBody)
		io.WriteString(w, `{"choices":[{"message":{"content":"ok"}}]}`)
	}))
	defer server.Close()

	in := openTestApp(t, server.URL+"/chat/completions", "")
	req := encodeRequest(t, in, `{"model": "m", "user_prompt": "yo"}`)
	if _, err := in.Invoke("openai.OpenAI/ChatCompletion", req, nil); err != nil {
		t.Fatalf("Invoke: %v", err)
	}

	messages := gotBody["messages"].([]any)
	if len(messages) != 1 {
		t.Fatalf("expected only the user message, got %v", messages)
	}
	if messages[0].(map[string]any)["role"] != "user" {
		t.Errorf("message = %v", messages[0])
	}
}

func TestChatCompletionUpstreamError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"error":{"message":"Incorrect API key provided","type":"invalid_request_error","code":"invalid_api_key","param":null}}`)
	}))
	defer server.Close()

	in := openTestApp(t, server.URL+"/chat/completions", "nope")
	req := encodeRequest(t, in, `{"model": "m", "user_prompt": "yo"}`)
	resp, err := in.Invoke("openai.OpenAI/ChatCompletion", req, nil)
	if err != nil {
		t.Fatalf("an HTTP error should be returned as a structured response, not a transport error: %v", err)
	}

	out := decodeResponse(t, in, resp)
	errObj, ok := out["error"].(map[string]any)
	if !ok {
		t.Fatalf("expected a structured error field, got %v", out)
	}
	if errObj["status"].(float64) != 401 {
		t.Errorf("status = %v, want 401", errObj["status"])
	}
	if errObj["message"] != "Incorrect API key provided" {
		t.Errorf("message = %v", errObj["message"])
	}
	if errObj["type"] != "invalid_request_error" {
		t.Errorf("type = %v", errObj["type"])
	}
	if errObj["code"] != "invalid_api_key" {
		t.Errorf("code = %v", errObj["code"])
	}
	if body, _ := errObj["body"].(string); body == "" {
		t.Errorf("expected the raw body to be included, got %v", errObj["body"])
	}
}

func TestChatCompletionUpstreamErrorPlainBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		io.WriteString(w, "upstream unavailable")
	}))
	defer server.Close()

	in := openTestApp(t, server.URL+"/chat/completions", "x")
	req := encodeRequest(t, in, `{"model": "m", "user_prompt": "yo"}`)
	resp, err := in.Invoke("openai.OpenAI/ChatCompletion", req, nil)
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}

	out := decodeResponse(t, in, resp)
	errObj := out["error"].(map[string]any)
	if errObj["status"].(float64) != 502 {
		t.Errorf("status = %v, want 502", errObj["status"])
	}
	// No JSON envelope: message falls back to the HTTP status text, body keeps the raw text.
	if errObj["message"] != "Bad Gateway" {
		t.Errorf("message = %v, want Bad Gateway", errObj["message"])
	}
	if errObj["body"] != "upstream unavailable" {
		t.Errorf("body = %v", errObj["body"])
	}
}

func TestChatCompletionTransportError(t *testing.T) {
	// Port 1 refuses connections, so the upstream cannot be reached at all and the
	// call surfaces as a transport error rather than a structured response.
	in := openTestApp(t, "http://127.0.0.1:1", "x")
	req := encodeRequest(t, in, `{"model": "m", "user_prompt": "yo"}`)
	if _, err := in.Invoke("openai.OpenAI/ChatCompletion", req, nil); err == nil {
		t.Fatal("expected a transport error when the upstream is unreachable")
	}
}

func TestDefaultEndpoint(t *testing.T) {
	// An app that names neither the API nor the endpoint is the OpenAI one, which
	// is all this app could reach before there was a choice.
	in := openTestAppWith(t, map[string]string{"token": "x"})
	if got, want := in.endpoint, (openAIWire{}).endpoint(); got != want {
		t.Errorf("endpoint = %q, want %q", got, want)
	}
	if in.auth != authBearer {
		t.Errorf("auth = %q, want %q", in.auth, authBearer)
	}

	// Naming the API is enough to reach it: the endpoint and the credential the
	// API's own dashboard hands you both follow from it.
	in = openTestAppWith(t, map[string]string{"api": apiAnthropic, "token": "x"})
	if got, want := in.endpoint, (anthropicWire{}).endpoint(); got != want {
		t.Errorf("endpoint = %q, want %q", got, want)
	}
	if in.auth != authAPIKey {
		t.Errorf("auth = %q, want %q", in.auth, authAPIKey)
	}
	if in.keyName != defaultAPIKeyName {
		t.Errorf("keyName = %q, want %q", in.keyName, defaultAPIKeyName)
	}
}

func TestUnknownApiAndAuthAreRefused(t *testing.T) {
	if _, err := New().Open(map[string]string{"api": "gemini"}, t.TempDir(), func(string) {}); err == nil {
		t.Error("expected an API kaja does not speak to be refused rather than guessed at")
	}
	if _, err := New().Open(map[string]string{"auth": "hmac"}, t.TempDir(), func(string) {}); err == nil {
		t.Error("expected a credential kaja cannot send to be refused")
	}
}

func TestAnthropicChatCompletion(t *testing.T) {
	var gotBody map[string]any
	var gotHeaders http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeaders = r.Header.Clone()
		b, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(b, &gotBody); err != nil {
			t.Errorf("decode upstream body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{
			"id": "msg_1",
			"type": "message",
			"role": "assistant",
			"model": "claude-opus-4-5",
			"content": [{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": "Hello "}, {"type": "text", "text": "there!"}],
			"stop_reason": "end_turn",
			"usage": {"input_tokens": 9, "output_tokens": 3}
		}`)
	}))
	defer server.Close()

	in := openTestAppWith(t, map[string]string{
		"api":      apiAnthropic,
		"endpoint": server.URL + "/v1/messages",
		"token":    "sk-ant-secret",
	})

	req := encodeRequest(t, in, `{
		"model": "claude-opus-4-5",
		"system_prompt": "Be nice",
		"user_prompt": "Hi",
		"temperature": 0.5
	}`)
	resp, err := in.Invoke("openai.OpenAI/ChatCompletion", req, nil)
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}

	// The credential is a key under its own header, not a bearer token, and the
	// API refuses a request that doesn't say which version it was written against.
	if got := gotHeaders.Get(defaultAPIKeyName); got != "sk-ant-secret" {
		t.Errorf("%s = %q, want the key", defaultAPIKeyName, got)
	}
	if got := gotHeaders.Get("Authorization"); got != "" {
		t.Errorf("Authorization = %q, want nothing", got)
	}
	if got := gotHeaders.Get("anthropic-version"); got != anthropicVersion {
		t.Errorf("anthropic-version = %q, want %q", got, anthropicVersion)
	}

	// The system prompt is a field of its own here rather than a message, and
	// max_tokens is required, so an unset one is supplied rather than sent empty.
	if gotBody["system"] != "Be nice" {
		t.Errorf("system = %v, want the system prompt", gotBody["system"])
	}
	if gotBody["max_tokens"].(float64) != anthropicDefaultMaxTokens {
		t.Errorf("max_tokens = %v, want the default", gotBody["max_tokens"])
	}
	messages, ok := gotBody["messages"].([]any)
	if !ok || len(messages) != 1 {
		t.Fatalf("messages = %v, want just the user turn", gotBody["messages"])
	}
	if user := messages[0].(map[string]any); user["role"] != "user" || user["content"] != "Hi" {
		t.Errorf("user message = %v", user)
	}

	// The reply arrives as content blocks and reads back through the same response
	// a script written against the OpenAI app already reads.
	out := decodeResponse(t, in, resp)
	if out["content"] != "Hello there!" {
		t.Errorf("content = %v, want the text blocks joined", out["content"])
	}
	if out["id"] != "msg_1" {
		t.Errorf("id = %v", out["id"])
	}
	choices, ok := out["choices"].([]any)
	if !ok || len(choices) != 1 {
		t.Fatalf("choices = %v", out["choices"])
	}
	if reason := choices[0].(map[string]any)["finish_reason"]; reason != "end_turn" {
		t.Errorf("finish_reason = %v, want what the API said", reason)
	}
	usage, ok := out["usage"].(map[string]any)
	if !ok || usage["prompt_tokens"].(float64) != 9 || usage["completion_tokens"].(float64) != 3 || usage["total_tokens"].(float64) != 12 {
		t.Errorf("usage = %v", out["usage"])
	}
}

func TestAnthropicUpstreamError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}}`)
	}))
	defer server.Close()

	in := openTestAppWith(t, map[string]string{"api": apiAnthropic, "endpoint": server.URL, "token": "nope"})
	resp, err := in.Invoke("openai.OpenAI/ChatCompletion", encodeRequest(t, in, `{"model": "m", "user_prompt": "hi"}`), nil)
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	out := decodeResponse(t, in, resp)
	failure, ok := out["error"].(map[string]any)
	if !ok {
		t.Fatalf("error = %v, want the failure on the response", out["error"])
	}
	if failure["status"].(float64) != 401 || failure["message"] != "invalid x-api-key" || failure["type"] != "authentication_error" {
		t.Errorf("error = %v", failure)
	}
}

func TestApiKeyCredentialAndHeaderPrecedence(t *testing.T) {
	var gotHeaders http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeaders = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id": "1", "choices": []}`)
	}))
	defer server.Close()

	in := openTestAppWith(t, map[string]string{
		"endpoint":     server.URL,
		"auth":         authAPIKey,
		"api_key_name": "api-key",
		"token":        "secret",
	})
	if _, err := in.Invoke("openai.OpenAI/ChatCompletion", encodeRequest(t, in, `{"model": "m", "user_prompt": "hi"}`), map[string]string{
		"Api-Key":  "written by hand",
		"X-Tenant": "acme",
	}); err != nil {
		t.Fatalf("Invoke: %v", err)
	}

	// A header the app configures under the credential's own name is the more
	// specific instruction, so it outranks what kaja would have sent.
	if got := gotHeaders.Get("api-key"); got != "written by hand" {
		t.Errorf("api-key = %q, want the configured header kept", got)
	}
	if got := gotHeaders.Get("X-Tenant"); got != "acme" {
		t.Errorf("X-Tenant = %q, want the app's header forwarded", got)
	}
	if got := gotHeaders.Get("Authorization"); got != "" {
		t.Errorf("Authorization = %q, want nothing: the credential is a key", got)
	}
}

func TestNoCredentialIsSent(t *testing.T) {
	var gotHeaders http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeaders = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id": "1", "choices": []}`)
	}))
	defer server.Close()

	in := openTestAppWith(t, map[string]string{"endpoint": server.URL, "auth": authNone, "token": "secret"})
	if _, err := in.Invoke("openai.OpenAI/ChatCompletion", encodeRequest(t, in, `{"model": "m", "user_prompt": "hi"}`), nil); err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if got := gotHeaders.Get("Authorization"); got != "" {
		t.Errorf("Authorization = %q, want nothing sent", got)
	}
	if got := gotHeaders.Get(defaultAPIKeyName); got != "" {
		t.Errorf("%s = %q, want nothing sent", defaultAPIKeyName, got)
	}
}

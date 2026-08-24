package openai

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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

// asUpstreamError asserts a failed Invoke reported the HTTP call it made.
func asUpstreamError(t *testing.T, err error) *apps.UpstreamError {
	t.Helper()
	var upstream *apps.UpstreamError
	if !errors.As(err, &upstream) {
		t.Fatalf("expected an *apps.UpstreamError, got %v", err)
	}
	return upstream
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
	_, err := in.Invoke("openai.OpenAI/ChatCompletion", req, nil)

	upstream := asUpstreamError(t, err)
	if upstream.Status != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", upstream.Status)
	}
	if upstream.Message != "Incorrect API key provided" {
		t.Errorf("message = %q", upstream.Message)
	}
	if upstream.Method != http.MethodPost || upstream.URL != server.URL+"/chat/completions" {
		t.Errorf("request = %s %s", upstream.Method, upstream.URL)
	}
	if upstream.Unreadable {
		t.Error("an HTTP failure is not an unreadable response")
	}
	// The API's own body reaches the console whole, rather than being picked apart
	// into fields the app declares.
	if !strings.Contains(string(upstream.Body), "invalid_api_key") {
		t.Errorf("body = %q", upstream.Body)
	}
	if upstream.RequestHeaders["Authorization"] == "" {
		t.Errorf("expected the exchanged request headers, got %v", upstream.RequestHeaders)
	}
	if upstream.ResponseHeaders["Content-Type"] == "" {
		t.Errorf("expected the exchanged response headers, got %v", upstream.ResponseHeaders)
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
	_, err := in.Invoke("openai.OpenAI/ChatCompletion", req, nil)

	upstream := asUpstreamError(t, err)
	if upstream.Status != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", upstream.Status)
	}
	// A short plain-text body is its own best summary.
	if upstream.Message != "upstream unavailable" {
		t.Errorf("message = %q", upstream.Message)
	}
	if string(upstream.Body) != "upstream unavailable" {
		t.Errorf("body = %q", upstream.Body)
	}
}

// An endpoint that answers 200 with something other than a chat completion - another
// API at the same address, most often - is reported as the call it was, with the body
// it answered with, rather than as a codec error naming neither.
func TestChatCompletionUnreadableResponse(t *testing.T) {
	const answer = `{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"Hello"}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, answer)
	}))
	defer server.Close()

	in := openTestApp(t, server.URL+"/messages", "x")
	req := encodeRequest(t, in, `{"model": "m", "user_prompt": "yo"}`)
	_, err := in.Invoke("openai.OpenAI/ChatCompletion", req, nil)

	upstream := asUpstreamError(t, err)
	if !upstream.Unreadable {
		t.Error("expected the response to be reported as unreadable")
	}
	if upstream.Status != http.StatusOK {
		t.Errorf("status = %d, want the status the API answered with", upstream.Status)
	}
	if !strings.Contains(upstream.Message, "not an OpenAI chat completion") {
		t.Errorf("message = %q", upstream.Message)
	}
	if string(upstream.Body) != answer {
		t.Errorf("body = %q, want the answer verbatim", upstream.Body)
	}
	if upstream.URL != server.URL+"/messages" {
		t.Errorf("url = %q", upstream.URL)
	}
	if upstream.ResponseHeaders["Content-Type"] == "" {
		t.Errorf("expected the exchanged response headers, got %v", upstream.ResponseHeaders)
	}
	// The desktop's TargetResult has one field for "this is a failure" and "this is
	// the status", so an unreadable response has to read as a failure there.
	if upstream.TransportStatus() < 400 {
		t.Errorf("TransportStatus() = %d, want a failure status", upstream.TransportStatus())
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
	_, err := in.Invoke("openai.OpenAI/ChatCompletion", encodeRequest(t, in, `{"model": "m", "user_prompt": "hi"}`), nil)

	upstream := asUpstreamError(t, err)
	if upstream.Status != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", upstream.Status)
	}
	if upstream.Message != "invalid x-api-key" {
		t.Errorf("message = %q", upstream.Message)
	}
	if upstream.Unreadable {
		t.Error("an HTTP failure is not an unreadable response")
	}
	if !strings.Contains(string(upstream.Body), "authentication_error") {
		t.Errorf("body = %q", upstream.Body)
	}
	if upstream.RequestHeaders[http.CanonicalHeaderKey(defaultAPIKeyName)] == "" {
		t.Errorf("expected the key among the exchanged request headers, got %v", upstream.RequestHeaders)
	}
}

// The failure the two APIs make easy: a request meant for one is accepted by the
// other - they agree on model, messages and max_tokens - so the app only finds out
// at the response. The report has to name the API that answered and the setting
// that reads it, or it says nothing a reader can act on.
func TestResponseFromTheOtherApi(t *testing.T) {
	completion := `{"id": "chatcmpl-1", "object": "chat.completion", "choices": [{"index": 0, "message": {"role": "assistant", "content": "hi"}}]}`
	message := `{"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-4-5", "content": [{"type": "text", "text": "hi"}]}`

	for _, test := range []struct {
		name   string
		api    string
		answer string
		want   string
	}{
		// A chat completion read as a Claude message: content is an array there, so the
		// decode fails rather than quietly handing back an empty reply.
		{name: "completion from a Claude app", api: apiAnthropic, answer: completion, want: `the response is an OpenAI chat completion, not a Claude message: set the app's api to "openai"`},
		{name: "message from an OpenAI app", api: apiOpenAI, answer: message, want: `the response is a Claude message, not an OpenAI chat completion: set the app's api to "anthropic"`},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				io.WriteString(w, test.answer)
			}))
			defer server.Close()

			in := openTestAppWith(t, map[string]string{"api": test.api, "endpoint": server.URL, "token": "x"})
			_, err := in.Invoke("openai.OpenAI/ChatCompletion", encodeRequest(t, in, `{"model": "m", "user_prompt": "hi"}`), nil)

			upstream := asUpstreamError(t, err)
			if !upstream.Unreadable {
				t.Error("a 200 that could not be read is an unreadable response, not an HTTP failure")
			}
			if upstream.Message != test.want {
				t.Errorf("message = %q, want %q", upstream.Message, test.want)
			}
			if string(upstream.Body) != test.answer {
				t.Errorf("body = %q, want what the endpoint actually answered", upstream.Body)
			}
		})
	}
}

// A body neither API would have sent is still reported as the call it was, with the
// codec error saying what could not be read.
func TestUnrecognizedResponseKeepsTheCodecError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"detail": "not found"}`)
	}))
	defer server.Close()

	in := openTestAppWith(t, map[string]string{"api": apiAnthropic, "endpoint": server.URL, "token": "x"})
	_, err := in.Invoke("openai.OpenAI/ChatCompletion", encodeRequest(t, in, `{"model": "m", "user_prompt": "hi"}`), nil)

	upstream := asUpstreamError(t, err)
	if !strings.Contains(upstream.Message, "not a Claude message") {
		t.Errorf("message = %q, want it to name the answer that was expected", upstream.Message)
	}
	if strings.Contains(upstream.Message, "set the app's api") {
		t.Errorf("message = %q, want no setting named for a body neither API sent", upstream.Message)
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

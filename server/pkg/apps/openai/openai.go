// Package openai implements the built-in "openai" app: it exposes the standard
// OpenAI chat completions API as a small gRPC surface kaja can render and invoke.
//
// The app has two creation parameters: "endpoint" (the full chat completions URL,
// e.g. https://api.openai.com/v1/chat/completions) and "token" (the API key sent
// as a Bearer token). Method calls arrive as protobuf, are transcoded into a POST
// against the endpoint, and the JSON response is shaped back into the method's
// protobuf response.
package openai

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/protoc-go/protoc"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
)

const (
	serviceTypeName = "openai.OpenAI"
	defaultEndpoint = "https://api.openai.com/v1/chat/completions"
)

// protoSource is the static proto surface the openai app renders: a single
// ChatCompletion method exposing the most common chat completion inputs (model,
// system/user prompt, temperature, ...) and a response carrying the assistant's
// reply alongside the raw choices and token usage.
const protoSource = `syntax = "proto3";

package openai;

message Message {
  string role = 1 [json_name = "role"];
  string content = 2 [json_name = "content"];
}

message ChatCompletionRequest {
  // Model name, e.g. "gpt-4o-mini".
  string model = 1 [json_name = "model"];
  // System prompt that sets the assistant's behavior (optional).
  string system_prompt = 2 [json_name = "system_prompt"];
  // User prompt sent to the model.
  string user_prompt = 3 [json_name = "user_prompt"];
  // Sampling temperature between 0 and 2. Higher is more random.
  optional float temperature = 4 [json_name = "temperature"];
  // Maximum number of tokens to generate in the reply.
  optional int32 max_tokens = 5 [json_name = "max_tokens"];
  // Nucleus sampling probability mass between 0 and 1.
  optional float top_p = 6 [json_name = "top_p"];
}

message Usage {
  int32 prompt_tokens = 1 [json_name = "prompt_tokens"];
  int32 completion_tokens = 2 [json_name = "completion_tokens"];
  int32 total_tokens = 3 [json_name = "total_tokens"];
}

message Choice {
  int32 index = 1 [json_name = "index"];
  Message message = 2 [json_name = "message"];
  string finish_reason = 3 [json_name = "finish_reason"];
}

// Error carries the details of a failed upstream request. It mirrors the
// standard OpenAI error envelope so the status code, message, type, code and raw
// body are all visible on the response.
message Error {
  // HTTP status code returned by the upstream API, e.g. 401.
  int32 status = 1 [json_name = "status"];
  // Human-readable error message.
  string message = 2 [json_name = "message"];
  // Error category, e.g. "invalid_request_error".
  string type = 3 [json_name = "type"];
  // Machine-readable error code, e.g. "invalid_api_key".
  string code = 4 [json_name = "code"];
  // The request parameter the error relates to, if any.
  string param = 5 [json_name = "param"];
  // Raw response body, for any detail not captured above.
  string body = 6 [json_name = "body"];
}

message ChatCompletionResponse {
  string id = 1 [json_name = "id"];
  string model = 2 [json_name = "model"];
  // The assistant's reply: the content of the first choice's message.
  string content = 3 [json_name = "content"];
  repeated Choice choices = 4 [json_name = "choices"];
  Usage usage = 5 [json_name = "usage"];
  // Set when the upstream API returns an error (HTTP >= 400) instead of a
  // completion. The other fields are empty in that case.
  Error error = 6 [json_name = "error"];
}

service OpenAI {
  // Create a chat completion using the standard OpenAI chat completions API.
  rpc ChatCompletion(ChatCompletionRequest) returns (ChatCompletionResponse);
}
`

// App is the openai app factory. Register it with the apps.Manager.
type App struct{}

func New() *App { return &App{} }

func (a *App) Open(parameters map[string]string, protoDir string, log func(string)) (*apps.Opened, error) {
	endpoint := strings.TrimSpace(parameters["endpoint"])
	if endpoint == "" {
		endpoint = defaultEndpoint
	}
	if err := requireHTTPScheme(endpoint); err != nil {
		return nil, err
	}
	log("OpenAI endpoint: " + endpoint)

	token := strings.TrimSpace(parameters["token"])
	if token == "" {
		log("No token configured; requests will be sent without an Authorization header")
	}

	if err := os.WriteFile(filepath.Join(protoDir, "openai.proto"), []byte(protoSource), 0o644); err != nil {
		return nil, fmt.Errorf("writing proto: %w", err)
	}

	input, output, err := compile(protoDir)
	if err != nil {
		return nil, err
	}
	log("Generated service " + serviceTypeName + " with method ChatCompletion")

	return &apps.Opened{Instance: &instance{
		endpoint: endpoint,
		token:    token,
		input:    input,
		output:   output,
		client:   &http.Client{Timeout: 120 * time.Second},
	}}, nil
}

// compile compiles the static proto and resolves ChatCompletion's request and
// response descriptors, used to decode the request and encode the response.
func compile(protoDir string) (protoreflect.MessageDescriptor, protoreflect.MessageDescriptor, error) {
	result, err := protoc.New(protoc.WithProtoPaths(protoDir)).Compile("openai.proto")
	if err != nil {
		return nil, nil, fmt.Errorf("compiling generated proto: %w", err)
	}
	files, err := protodesc.NewFiles(result.AsFileDescriptorSet())
	if err != nil {
		return nil, nil, fmt.Errorf("building descriptors: %w", err)
	}
	descriptor, err := files.FindDescriptorByName(protoreflect.FullName(serviceTypeName))
	if err != nil {
		return nil, nil, fmt.Errorf("finding service %s: %w", serviceTypeName, err)
	}
	service, ok := descriptor.(protoreflect.ServiceDescriptor)
	if !ok {
		return nil, nil, fmt.Errorf("%s is not a service", serviceTypeName)
	}
	method := service.Methods().ByName("ChatCompletion")
	if method == nil {
		return nil, nil, fmt.Errorf("method ChatCompletion missing from compiled descriptors")
	}
	return method.Input(), method.Output(), nil
}

// requireHTTPScheme rejects URLs that are not plain HTTP(S), so a base URL can't
// make the app issue requests over other schemes (file://, etc.).
func requireHTTPScheme(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL %q: %w", rawURL, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("unsupported URL scheme %q in %q (only http and https are allowed)", u.Scheme, rawURL)
	}
	return nil
}

// Package openai implements the built-in "openai" app: it exposes a chat model as
// a small gRPC surface kaja can render and invoke.
//
// It speaks two APIs, named by the "api" parameter: OpenAI chat completions
// ("openai", the default) and the Claude Messages API ("anthropic"). They differ
// in the request body, the response and the header the credential travels under,
// so the endpoint alone cannot settle which one is meant. The proto surface is
// the same either way, so swapping one app for the other leaves a script working.
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

const serviceTypeName = "openai.OpenAI"

// protoSource is the static proto surface the app renders, the same for either
// API it speaks.
//
// A failed call has no shape here. It is reported as the HTTP call it was, through
// apps.UpstreamError, the same as any other app that speaks HTTP - so the status, the
// request line, the headers exchanged and the API's own body all reach the console,
// and none of it has to be squeezed through a message this proto declares.
const protoSource = `syntax = "proto3";

package openai;

message Message {
  string role = 1 [json_name = "role"];
  string content = 2 [json_name = "content"];
}

message ChatCompletionRequest {
  // Model name, e.g. "gpt-4o-mini" or "claude-opus-4-5".
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

message ChatCompletionResponse {
  string id = 1 [json_name = "id"];
  string model = 2 [json_name = "model"];
  // The assistant's reply: the content of the first choice's message.
  string content = 3 [json_name = "content"];
  repeated Choice choices = 4 [json_name = "choices"];
  Usage usage = 5 [json_name = "usage"];
}

service OpenAI {
  // Send one prompt to a chat model and read its reply.
  rpc ChatCompletion(ChatCompletionRequest) returns (ChatCompletionResponse);
}
`

// App is the openai app factory. Register it with the apps.Manager.
type App struct{}

func New() *App { return &App{} }

func (a *App) Open(parameters map[string]string, protoDir string, log func(string)) (*apps.Opened, error) {
	format, err := wireFor(parameters["api"])
	if err != nil {
		return nil, err
	}

	endpoint := strings.TrimSpace(parameters["endpoint"])
	if endpoint == "" {
		endpoint = format.endpoint()
	}
	if err := requireHTTPScheme(endpoint); err != nil {
		return nil, err
	}
	log("Endpoint: " + endpoint + " (" + format.name() + " API)")

	auth, err := authFor(parameters["auth"], format)
	if err != nil {
		return nil, err
	}
	keyName := strings.TrimSpace(parameters["api_key_name"])
	if keyName == "" {
		keyName = defaultAPIKeyName
	}

	token := strings.TrimSpace(parameters["token"])
	switch {
	case auth == authNone:
		log("Sending no credentials")
	case token == "":
		log("No token configured; requests will be sent without a credential")
	case auth == authAPIKey:
		log("Sending the API key as " + keyName)
	default:
		log("Sending the token as Authorization: Bearer")
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
		wire:     format,
		auth:     auth,
		token:    token,
		keyName:  keyName,
		input:    input,
		output:   output,
		client:   &http.Client{Timeout: 120 * time.Second},
	}}, nil
}

// An empty auth is whichever credential the chosen API's own dashboard hands you.
func authFor(value string, format wire) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "":
		return format.defaultAuth(), nil
	case authBearer:
		return authBearer, nil
	case authAPIKey:
		return authAPIKey, nil
	case authNone:
		return authNone, nil
	default:
		return "", fmt.Errorf("unknown auth %q (use %q, %q or %q)", value, authBearer, authAPIKey, authNone)
	}
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

// Package mcp implements the built-in "mcp" app: it connects to another Model
// Context Protocol server, reads what that server exposes, and renders it as a
// proto surface kaja can browse and call.
//
// The server's tools become the methods of a Tools service - a tool's
// inputSchema becomes the request message and its outputSchema, where it
// declares one, the shape of the result - its prompts become the methods of a
// Prompts service, and its resources the fixed list/read methods of a Resources
// service. Calls are transcoded back into `tools/call`, `prompts/get` and
// `resources/*` on the way out.
//
// The transport is Streamable HTTP, in both eras of the protocol: the modern
// revision, which carries the version and the client's capabilities in every
// request and has no session, and the handshake revisions that came before it.
package mcp

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

// callTimeout bounds one exchange with the server. A tool that reaches an API of
// its own can be slow, so it is generous; reading the surface uses its own,
// shorter one.
const callTimeout = 120 * time.Second

// App is the mcp app factory. Register it with the apps.Manager.
type App struct{}

func New() *App { return &App{} }

func (a *App) Open(parameters map[string]string, protoDir string, log func(string)) (*apps.Opened, error) {
	endpoint := strings.TrimSpace(parameters["url"])
	if endpoint == "" {
		return nil, fmt.Errorf("missing required parameter %q", "url")
	}
	if err := requireHTTPScheme(endpoint); err != nil {
		return nil, err
	}
	log("MCP endpoint: " + endpoint)

	client := NewClient(endpoint, Credential(parameters), &http.Client{Timeout: callTimeout})
	surface, err := client.ReadSurface(log)
	if err != nil {
		return nil, err
	}

	gen, err := generateProto(surface)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(protoDir, "mcp.proto"), []byte(gen.proto), 0o644); err != nil {
		return nil, fmt.Errorf("writing proto: %w", err)
	}
	log(fmt.Sprintf("Generated %d service(s) with %d method(s)", len(gen.serviceTypeNames), len(gen.bindings)))

	methods, err := compileMethods(protoDir, gen)
	if err != nil {
		return nil, err
	}

	return &apps.Opened{Instance: &instance{client: client, methods: methods}}, nil
}

// Credential turns an mcp app's authentication parameters into the headers the
// call carries. It is resolved here rather than in the browser, so a "${secret}"
// token is applied where kaja holds it.
func Credential(parameters map[string]string) map[string]string {
	token := strings.TrimSpace(parameters["token"])
	if token == "" {
		return nil
	}
	switch strings.TrimSpace(parameters["auth"]) {
	case "none":
		return nil
	case "apikey":
		name := strings.TrimSpace(parameters["api_key_name"])
		if name == "" {
			name = "X-API-Key"
		}
		return map[string]string{name: token}
	default:
		// An MCP server behind a login is behind an OAuth bearer token in all but
		// name, which is why it is the default and the only other choice.
		return map[string]string{"Authorization": "Bearer " + token}
	}
}

// boundMethod is one generated method: what it does on the wire, and the
// descriptors its request and response are decoded and encoded with.
type boundMethod struct {
	binding *binding
	input   protoreflect.MessageDescriptor
	output  protoreflect.MessageDescriptor
}

// compileMethods compiles the generated proto and resolves each method's request
// and response descriptors, keyed by the gRPC method path.
func compileMethods(protoDir string, gen *generated) (map[string]*boundMethod, error) {
	result, err := protoc.New(protoc.WithProtoPaths(protoDir), protoc.WithIncludeImports()).Compile("mcp.proto")
	if err != nil {
		return nil, fmt.Errorf("compiling generated proto: %w", err)
	}
	files, err := protodesc.NewFiles(result.AsFileDescriptorSet())
	if err != nil {
		return nil, fmt.Errorf("building descriptors: %w", err)
	}

	services := make(map[string]protoreflect.ServiceDescriptor, len(gen.serviceTypeNames))
	for _, name := range gen.serviceTypeNames {
		descriptor, err := files.FindDescriptorByName(protoreflect.FullName(name))
		if err != nil {
			return nil, fmt.Errorf("finding service %s: %w", name, err)
		}
		service, ok := descriptor.(protoreflect.ServiceDescriptor)
		if !ok {
			return nil, fmt.Errorf("%s is not a service", name)
		}
		services[name] = service
	}

	methods := make(map[string]*boundMethod, len(gen.bindings))
	for path, bound := range gen.bindings {
		service := services[serviceOfMethodPath(path)]
		if service == nil {
			return nil, fmt.Errorf("no service for method path %s", path)
		}
		method := service.Methods().ByName(protoreflect.Name(lastSegment(path)))
		if method == nil {
			return nil, fmt.Errorf("method %s missing from compiled descriptors", path)
		}
		methods[path] = &boundMethod{binding: bound, input: method.Input(), output: method.Output()}
	}
	return methods, nil
}

// requireHTTPScheme rejects endpoints that are not plain HTTP(S), so a
// configuration can't make the app issue requests over other schemes.
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

func lastSegment(s string) string {
	if i := strings.LastIndex(s, "/"); i >= 0 {
		return s[i+1:]
	}
	return s
}

func serviceOfMethodPath(path string) string {
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[:i]
	}
	return path
}

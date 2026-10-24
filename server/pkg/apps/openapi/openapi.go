// Package openapi implements the built-in "openapi" app: it reads an OpenAPI 3.x
// document, converts its operations into a proto service kaja can render, and
// transcodes method calls into HTTP requests against the upstream REST API.
package openapi

import (
	"context"
	_ "embed"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/kaja/v2/pkg/grpc"
	"github.com/wham/kaja/v2/pkg/oauth"
	"github.com/wham/protoc-go/protoc"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// httpProto declares the kaja options the generated proto marks its methods and
// fields with - the HTTP request a method stands for, where a field travels, and
// which envelope fields exist only to hold a payload protobuf has no shape for.
// It is written next to the generated service so the marks survive into the
// compiled descriptors and reach the client.
//
//go:embed http.proto
var httpProto []byte

// write lays the generated proto surface out in protoDir: the services, the
// messages they take and return, and kaja/http.proto, which both depend on. Both
// the app's own compile and the client-facing one read the directory, so the
// marks survive into the descriptors the client is generated from.
func (gen *generated) write(protoDir string) error {
	if err := os.WriteFile(filepath.Join(protoDir, "service.proto"), []byte(gen.service), 0o644); err != nil {
		return fmt.Errorf("writing proto: %w", err)
	}
	if err := os.WriteFile(filepath.Join(protoDir, typesFile), []byte(gen.types), 0o644); err != nil {
		return fmt.Errorf("writing proto: %w", err)
	}
	dir := filepath.Join(protoDir, "kaja")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating kaja proto directory: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "http.proto"), httpProto, 0o644); err != nil {
		return fmt.Errorf("writing kaja/http.proto: %w", err)
	}
	return nil
}

// App is the openapi app factory. Register it with the apps.Manager.
type App struct {
	// authorizer is what a scheme kaja signs in to reads its token from. A build
	// without one cannot sign in, and a call that needs it says so.
	authorizer *oauth.Authorizer
}

func New() *App { return &App{} }

// WithAuthorizer is how the process that owns this machine's stored tokens hands
// them to the app type.
func (a *App) WithAuthorizer(authorizer *oauth.Authorizer) *App {
	a.authorizer = authorizer
	return a
}

func (a *App) Open(ctx context.Context, parameters map[string]string, protoDir string, log func(string)) (*apps.Opened, error) {
	specURL := strings.TrimSpace(parameters["spec_url"])
	specContent := strings.TrimSpace(parameters["spec_content"])

	var s *spec
	var p *problem
	switch {
	case specContent != "":
		// The spec was uploaded as a file; parse it directly (JSON or YAML).
		log("Parsing uploaded OpenAPI spec")
		s, p = readSpec([]byte(specContent), "")
	case specURL != "":
		if err := requireHTTPScheme(specURL); err != nil {
			return nil, err
		}
		var fetched *fetchedSpec
		if fetched, p = fetchSpec(ctx, specURL, specFetchCredentials(parameters), log); p == nil {
			s = fetched.spec
		}
	default:
		return nil, fmt.Errorf("missing required parameter: provide %q or %q", "spec_url", "spec_content")
	}
	if p != nil {
		return nil, p
	}
	log(fmt.Sprintf("Loaded %q (OpenAPI %s) with %d path(s)", s.Info.Title, s.OpenAPI, len(s.Paths)))

	gen, err := generateProto(s)
	if err != nil {
		return nil, err
	}
	log(fmt.Sprintf("Generated %d service(s) with %d method(s)", len(gen.serviceTypeNames), len(gen.bindings)))

	if err := gen.write(protoDir); err != nil {
		return nil, err
	}

	// Compile the generated proto to descriptors so invocations can decode the
	// protobuf request and encode the protobuf response (the app is a gRPC app).
	log("Compiling generated proto to descriptors")
	methods, err := compileMethods(protoDir, gen)
	if err != nil {
		return nil, err
	}

	baseURL, err := resolveBaseURL(specURL, parameters["base_url"], s)
	if err != nil {
		return nil, err
	}
	if err := requireHTTPScheme(baseURL); err != nil {
		return nil, err
	}
	log("Upstream base URL: " + baseURL)

	authentication := authFor(s, parameters)
	if summary := authentication.describe(); summary != "" {
		log("Authentication: " + summary)
	}

	return &apps.Opened{Instance: &instance{
		baseURL:    baseURL,
		methods:    methods,
		client:     &http.Client{Timeout: 30 * time.Second},
		spec:       s,
		auth:       authentication,
		authorizer: a.authorizer,
	}}, nil
}

// authFor is the credential the app's parameters describe, resolved against the
// schemes the document declares. It is read again on every call, so a token replaced
// in kaja.json reaches the next call rather than the next compile.
func authFor(s *spec, parameters map[string]string) *auth {
	return resolveAuth(s,
		strings.TrimSpace(parameters["security_scheme"]),
		strings.TrimSpace(parameters["token"]),
		strings.TrimSpace(parameters["username"]),
		strings.TrimSpace(parameters["password"]),
	)
}

// compileMethods compiles the generated proto and resolves each method's input
// and output message descriptors, keyed by the gRPC method path.
func compileMethods(protoDir string, gen *generated) (map[string]*boundMethod, error) {
	// WithIncludeImports keeps imported descriptors (google/protobuf/struct.proto,
	// pulled in when a field maps to google.protobuf.Value) in the set so
	// protodesc.NewFiles can resolve them. The comments are kept and the set written
	// beside the source, because the manifest is compiled off it rather than off the
	// .proto a second time.
	result, err := protoc.New(protoc.WithProtoPaths(protoDir), protoc.WithIncludeImports(), protoc.WithIncludeSourceInfo()).Compile("service.proto")
	if err != nil {
		return nil, fmt.Errorf("compiling generated proto: %w", err)
	}
	if err := grpc.WriteDescriptors(result.AsFileDescriptorSet(), protoDir); err != nil {
		return nil, err
	}
	files, err := protodesc.NewFiles(result.AsFileDescriptorSet())
	if err != nil {
		return nil, fmt.Errorf("building descriptors: %w", err)
	}

	services := make(map[string]protoreflect.ServiceDescriptor, len(gen.serviceTypeNames))
	for _, serviceTypeName := range gen.serviceTypeNames {
		descriptor, err := files.FindDescriptorByName(protoreflect.FullName(serviceTypeName))
		if err != nil {
			return nil, fmt.Errorf("finding service %s: %w", serviceTypeName, err)
		}
		service, ok := descriptor.(protoreflect.ServiceDescriptor)
		if !ok {
			return nil, fmt.Errorf("%s is not a service", serviceTypeName)
		}
		services[serviceTypeName] = service
	}

	methods := make(map[string]*boundMethod, len(gen.bindings))
	for key, binding := range gen.bindings {
		service := services[serviceOfMethodPath(key)]
		if service == nil {
			return nil, fmt.Errorf("no service for method path %s", key)
		}
		name := lastSegment(key)
		method := service.Methods().ByName(protoreflect.Name(name))
		if method == nil {
			return nil, fmt.Errorf("method %s missing from compiled descriptors", name)
		}
		methods[key] = &boundMethod{binding: binding, input: method.Input(), output: method.Output()}
	}
	return methods, nil
}

// requireHTTPScheme rejects URLs that are not plain HTTP(S), so a spec can't make
// the app issue requests over other schemes (file://, etc.). Hosts are still
// user-controlled by design - the same as a regular app's target.
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

// resolveBaseURL determines the upstream base URL. An explicit override (the
// base_url app parameter) wins over the spec's servers list. Otherwise it uses
// the spec's servers list, resolving relative server URLs against the document
// URL. When the spec was uploaded (specURL is empty) there is no document URL to
// resolve against, so the spec must declare an absolute server URL or an override
// must be provided.
func resolveBaseURL(specURL string, override string, s *spec) (string, error) {
	if override = strings.TrimSpace(override); override != "" {
		return strings.TrimRight(override, "/"), nil
	}

	var serverURL string
	if len(s.Servers) > 0 {
		serverURL = applyServerDefaults(s.Servers[0])
	}

	if specURL == "" {
		if serverURL == "" {
			return "", fmt.Errorf("uploaded spec has no servers; add an absolute server URL to the spec")
		}
		ref, err := url.Parse(serverURL)
		if err != nil {
			return "", fmt.Errorf("invalid server URL %q: %w", serverURL, err)
		}
		if !ref.IsAbs() {
			return "", fmt.Errorf("uploaded spec has relative server URL %q; use an absolute server URL", serverURL)
		}
		return strings.TrimRight(serverURL, "/"), nil
	}

	docURL, err := url.Parse(specURL)
	if err != nil {
		return "", fmt.Errorf("invalid spec URL: %w", err)
	}

	if serverURL == "" {
		return docURL.Scheme + "://" + docURL.Host, nil
	}

	ref, err := url.Parse(serverURL)
	if err != nil {
		return "", fmt.Errorf("invalid server URL %q: %w", serverURL, err)
	}
	if ref.IsAbs() {
		return strings.TrimRight(serverURL, "/"), nil
	}
	return strings.TrimRight(docURL.ResolveReference(ref).String(), "/"), nil
}

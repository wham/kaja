// Package apps implements kaja "apps": built-in integrations that expose a proto
// surface kaja renders and invokes the same way as a regular gRPC/Twirp app.
//
// Apps are built in today, but the App/Instance interfaces are shaped like a future
// generic gRPC "App" service so remote apps — separate processes speaking a standard
// contract — can be added without changing how the UI consumes them: Open generates
// the proto surface to render, Invoke executes a single method.
package apps

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"
	"sync"
)

// TargetScheme is the URL scheme used as an app's URL for an opened app
// instance. Method calls whose X-Target uses this scheme are routed back into
// the app manager for invocation instead of being proxied to an external host.
const TargetScheme = "kaja-app"

// AppHeader is the reserved header the client sends alongside the app's own, naming
// the app a call belongs to. It never reaches the wire: both request routers take it
// out and use it to look up the credential and transport kaja holds for that app.
// That is what keeps a "${secret}" token where it lives, and what makes Basic's
// base64 kaja's to do rather than yours.
const AppHeader = "X-Kaja-App"

// TakeAppName removes the reserved header and returns the app it named. Header case
// is whatever the transport made of it, so it is matched without regard to case.
func TakeAppName(headers map[string]string) string {
	for name, value := range headers {
		if strings.EqualFold(name, AppHeader) {
			delete(headers, name)
			return value
		}
	}
	return ""
}

// MergeMetadata adds an app's credential to the headers it sends, leaving a header
// the app configures under the same name alone: writing one out by hand is the more
// specific instruction of the two.
func MergeMetadata(headers map[string]string, metadata map[string]string) map[string]string {
	if len(metadata) == 0 {
		return headers
	}
	if headers == nil {
		headers = map[string]string{}
	}
	for name, value := range metadata {
		configured := false
		for existing := range headers {
			if strings.EqualFold(existing, name) {
				configured = true
				break
			}
		}
		if !configured {
			headers[name] = value
		}
	}
	return headers
}

// App is the contract every app type satisfies. An App is a factory: Open turns
// creation parameters into an Opened result, describing the proto surface to
// compile and how the app is invoked.
type App interface {
	Open(parameters map[string]string, protoDir string, log func(string)) (*Opened, error)
}

// Opened is the result of opening an app: where its proto surface lives and how
// its methods are invoked.
type Opened struct {
	// ProtoDir overrides where the proto surface to compile lives. Empty means the
	// protoDir passed to Open. A relative path ("seating/proto") is resolved by the
	// compiler against the workspace, which is what grpc/twirp apps with on-disk protos use.
	ProtoDir string
	// Instance, when non-nil, makes the app invocable in-process: the Manager
	// registers it and the client reaches it through a kaja-app:// target.
	Instance Instance
	// Target and Protocol describe apps whose methods the client invokes directly
	// (grpc/twirp): Target is the upstream URL and Protocol the transport ("grpc"
	// or "twirp"). Ignored when Instance is non-nil.
	Target   string
	Protocol string
	// Document is the app's own description, as JSON, for an app the client drives
	// as HTTP. The client reads it into the surface a script writes against, which
	// is why nothing here compiles a proto for one.
	Document []byte
}

// OpenResult tells the caller how a freshly opened app is compiled and invoked.
type OpenResult struct {
	ProtoDir string
	Target   string
	Protocol string
	Document []byte
}

// Instance is a live, opened app that can invoke its generated methods.
type Instance interface {
	// Invoke runs the method identified by its Twirp path, e.g.
	// "openapi.petstore.PetstoreApi/GetPet". request is the proto3-JSON request body;
	// headers are forwarded upstream.
	Invoke(methodPath string, request []byte, headers map[string]string) (*InvokeResult, error)
}

// Forwarder is an app the client drives as HTTP rather than as RPC. The client has
// read the document and knows the shape of every call; what it does not have, and
// must not, is where the API is and what credential reaches it. So it sends a path
// and this fills in the rest — which is the whole of what the server does for a
// REST app.
type Forwarder interface {
	// Forward makes one upstream call. path is relative to the app's base URL and
	// is never a URL: a script that could name the destination could aim this
	// process at anything the machine can reach.
	Forward(request *ForwardRequest) (*ForwardResult, error)
}

// ForwardRequest is one HTTP call, as the browser asked for it.
type ForwardRequest struct {
	Method string
	// Relative to the app's base URL, query string included.
	Path    string
	Headers map[string]string
	Body    []byte
}

// ForwardResult is what the API answered, whole. A status is data here rather than
// a failure: an API that answers 404 has answered, and the script decides.
type ForwardResult struct {
	Status  int
	Headers map[string]string
	Body    []byte
	// What was actually sent upstream, with the resolved secrets masked back out,
	// for the Headers view.
	RequestHeaders map[string]string
	DurationMs     int64
}

// Documented is an app that can show where one of its methods came from. Optional:
// an app whose surface it generated out of a document has one to show, and an app
// that reflects a live server has nothing but what it already reported.
type Documented interface {
	// Documentation answers for one operation, named the way the app's methods name
	// theirs — "GET /shows/{showId}" for an app built from a REST document.
	Documentation(operation string) (*Documentation, bool)
}

// Documentation is one method as the document that generated it states it. The
// generated proto carries what could be modelled; this is the rest, which is most of
// what a person reads before writing the call.
type Documentation struct {
	Summary     string
	Description string
	Deprecated  bool
	// The declaration as written, ready to show.
	Document string
	// What Document is written in, so an editor can colour it: "yaml", "json".
	Language string
}

// InvokeResult is the outcome of a single Invoke. Body is the proto3-JSON response.
// RequestHeaders/ResponseHeaders are what the app actually exchanged with its
// upstream, which the transports surface to the Headers view; an in-process app with
// no upstream hop leaves them empty.
type InvokeResult struct {
	Body            []byte
	RequestHeaders  map[string]string
	ResponseHeaders map[string]string
	// DurationMs is the wall-clock time of the invocation as this process measured
	// it — the upstream exchange plus the app's own encode/decode, and nothing of the
	// trip between the UI and here. Stamped by ApiService.InvokeApp, the one door both
	// request routers call, so an app never fills it in itself.
	DurationMs int64
}

// Manager owns the registry of app types and the set of live instances.
type Manager struct {
	mu        sync.Mutex
	types     map[string]App
	instances map[string]Instance
}

// NewManager builds a Manager with the given built-in app types registered.
func NewManager(types map[string]App) *Manager {
	return &Manager{
		types:     types,
		instances: map[string]Instance{},
	}
}

// Open instantiates an app of the given type. In-process apps are registered and
// reached through a "kaja-app://<id>" target; grpc/twirp apps return their upstream
// URL and transport directly. Generated protos are written into protoDir.
func (m *Manager) Open(appType string, parameters map[string]string, protoDir string, log func(string)) (*OpenResult, error) {
	m.mu.Lock()
	app, ok := m.types[appType]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("unknown app type %q", appType)
	}

	opened, err := app.Open(parameters, protoDir, log)
	if err != nil {
		return nil, err
	}

	result := &OpenResult{ProtoDir: protoDir, Target: opened.Target, Protocol: opened.Protocol, Document: opened.Document}
	if opened.ProtoDir != "" {
		result.ProtoDir = opened.ProtoDir
	}

	if opened.Instance != nil {
		id, err := newID()
		if err != nil {
			return nil, err
		}
		m.mu.Lock()
		m.instances[id] = opened.Instance
		m.mu.Unlock()
		// In-process apps are gRPC apps reached through the app target scheme.
		result.Target = TargetScheme + "://" + id
		result.Protocol = "grpc"
	}

	return result, nil
}

// IsAppTarget reports whether target refers to an opened app instance.
func IsAppTarget(target string) bool {
	return strings.HasPrefix(target, TargetScheme+"://")
}

// Invoke routes a method call to the instance referenced by target.
func (m *Manager) Invoke(target string, methodPath string, request []byte, headers map[string]string) (*InvokeResult, error) {
	u, err := url.Parse(target)
	if err != nil {
		return nil, fmt.Errorf("invalid app target %q: %w", target, err)
	}
	id := u.Host

	m.mu.Lock()
	instance, ok := m.instances[id]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("app instance %q not found (the app may need to be recompiled)", id)
	}

	return instance.Invoke(methodPath, request, headers)
}

// Forward routes one HTTP call to the app behind a target. An app type that is not
// driven as HTTP has no Forward, which is an error rather than a miss: a call has
// to go somewhere.
func (m *Manager) Forward(target string, request *ForwardRequest) (*ForwardResult, error) {
	u, err := url.Parse(target)
	if err != nil {
		return nil, fmt.Errorf("invalid app target %q: %w", target, err)
	}

	m.mu.Lock()
	instance, ok := m.instances[u.Host]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("app instance %q not found (the app may need to be recompiled)", u.Host)
	}

	forwarder, ok := instance.(Forwarder)
	if !ok {
		return nil, fmt.Errorf("app instance %q is not driven as HTTP", u.Host)
	}
	return forwarder.Forward(request)
}

// Documentation answers for one of a live app's operations, or reports that the app
// has nothing to show for it — an app type that documents nothing, an operation the
// document does not declare, or an instance that has since been replaced. A miss is
// not an error: the caller is a hover, and a hover with nothing to say says nothing.
func (m *Manager) Documentation(target string, operation string) (*Documentation, bool) {
	u, err := url.Parse(target)
	if err != nil {
		return nil, false
	}

	m.mu.Lock()
	instance, ok := m.instances[u.Host]
	m.mu.Unlock()
	if !ok {
		return nil, false
	}

	documented, ok := instance.(Documented)
	if !ok {
		return nil, false
	}
	return documented.Documentation(operation)
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

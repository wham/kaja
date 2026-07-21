// Package apps implements kaja "apps": built-in integrations that expose a proto
// surface kaja renders and invokes the same way as a regular gRPC/Twirp app.
//
// Today apps are built in (Go code in this package). The App/Instance interfaces
// are intentionally shaped like a future generic gRPC "App" service so that
// remote apps - separate processes speaking a standard contract - can be added
// later without changing how the UI consumes them:
//
//	Open   -> generate the proto surface to render (cf. a future rpc Open/Reflect)
//	Invoke -> execute a single method            (cf. a future rpc Invoke)
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

// App is the contract every app type satisfies. An App is a factory: Open turns
// creation parameters into an Opened result, describing the proto surface to
// compile and how the app is invoked.
type App interface {
	Open(parameters map[string]string, protoDir string, log func(string)) (*Opened, error)
}

// Opened is the result of opening an app: where its proto surface lives and how
// its methods are invoked.
type Opened struct {
	// ProtoDir overrides where the proto surface to compile lives. Empty means
	// "use the protoDir passed to Open" (the temp directory the app wrote into). A
	// relative path (e.g. "seating/proto") is resolved by the compiler against the
	// workspace and is used by grpc/twirp apps pointing at static, on-disk protos.
	ProtoDir string
	// Instance, when non-nil, makes the app invocable in-process: the Manager
	// registers it and the client reaches it through a kaja-app:// target.
	Instance Instance
	// Target and Protocol describe apps whose methods the client invokes directly
	// (grpc/twirp): Target is the upstream URL and Protocol the transport ("grpc"
	// or "twirp"). Ignored when Instance is non-nil.
	Target   string
	Protocol string
}

// OpenResult tells the caller how a freshly opened app is compiled and invoked.
type OpenResult struct {
	ProtoDir string
	Target   string
	Protocol string
}

// Instance is a live, opened app that can invoke its generated methods.
type Instance interface {
	// Invoke runs the method identified by its Twirp path, e.g.
	// "openapi.petstore.PetstoreApi/GetPet". request is the proto3-JSON request
	// body sent by the client and headers are forwarded to the upstream service.
	// An error is returned for upstream/transcoding failures.
	Invoke(methodPath string, request []byte, headers map[string]string) (*InvokeResult, error)
}

// InvokeResult is the outcome of a single Invoke. Body is the proto3-JSON
// response body. RequestHeaders/ResponseHeaders, when set, are the headers the
// app actually exchanged with its upstream service, which the transports
// surface to the client's Headers view. In-process apps with no upstream hop
// (e.g. the local Markdown app) leave them empty.
type InvokeResult struct {
	Body            []byte
	RequestHeaders  map[string]string
	ResponseHeaders map[string]string
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

// Open instantiates an app of the given type and returns how it is compiled and
// invoked. In-process apps are registered and reached through a "kaja-app://<id>"
// target; grpc/twirp apps return their upstream URL and transport directly. Any
// generated proto files are written into protoDir.
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

	result := &OpenResult{ProtoDir: protoDir, Target: opened.Target, Protocol: opened.Protocol}
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

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

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

// Freezer is an app that can write down what it read, so a copy of it opens
// from what travels with it rather than from the network. An export asks every
// app type for this and takes what it gets: an app that reads a document can
// carry the document, an app that talks to a server can only be that server's
// client, and the difference is the app's to state rather than the exporter's
// to guess.
//
// It returns the parameters to change — a value of "" removes one, which is how
// a frozen app stops reading the source it was frozen from.
type Freezer interface {
	Freeze(parameters map[string]string) (map[string]string, error)
}

// Freeze asks the named app type to freeze what it read. An app type that can't
// reports nothing to change and no error: needing the network at startup is a
// fact about the app, not a failure of the export.
func (m *Manager) Freeze(appType string, parameters map[string]string) (map[string]string, error) {
	m.mu.Lock()
	app, ok := m.types[appType]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("unknown app type %q", appType)
	}
	freezer, ok := app.(Freezer)
	if !ok {
		return nil, nil
	}
	return freezer.Freeze(parameters)
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
	// "openapi.petstore.PetstoreApi/GetPet". request is the proto3-JSON request body;
	// headers are forwarded upstream.
	Invoke(methodPath string, request []byte, headers map[string]string) (*InvokeResult, error)
}

// InvokeResult is the outcome of a single Invoke. Body is the proto3-JSON response.
// RequestHeaders/ResponseHeaders are what the app actually exchanged with its
// upstream, which the transports surface to the Headers view; an in-process app with
// no upstream hop leaves them empty.
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

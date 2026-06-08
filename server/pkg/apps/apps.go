// Package apps implements kaja "apps": built-in integrations that expose a proto
// surface kaja renders and invokes the same way as a regular gRPC/Twirp project.
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

// TargetScheme is the URL scheme used as a project's URL for an opened app
// instance. Method calls whose X-Target uses this scheme are routed back into
// the app manager for invocation instead of being proxied to an external host.
const TargetScheme = "kaja-app"

// App is the contract every app type satisfies. An App is a factory: Open turns
// creation parameters into a live Instance and writes the generated .proto files
// into protoDir, ready to be picked up by the existing Compile pipeline.
type App interface {
	Open(parameters map[string]string, protoDir string, log func(string)) (Instance, error)
}

// Instance is a live, opened app that can invoke its generated methods.
type Instance interface {
	// Invoke runs the method identified by its Twirp path, e.g.
	// "openapi.petstore.PetstoreApi/GetPet". request is the proto3-JSON request
	// body sent by the client and headers are forwarded to the upstream service;
	// the returned bytes are the proto3-JSON response body. An error is returned
	// for upstream/transcoding failures.
	Invoke(methodPath string, request []byte, headers map[string]string) ([]byte, error)
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

// Open instantiates an app of the given type and returns the target URL that the
// UI should use as the project URL (e.g. "kaja-app://<id>"). The generated proto
// files are written into protoDir.
func (m *Manager) Open(appType string, parameters map[string]string, protoDir string, log func(string)) (string, error) {
	m.mu.Lock()
	app, ok := m.types[appType]
	m.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("unknown app type %q", appType)
	}

	instance, err := app.Open(parameters, protoDir, log)
	if err != nil {
		return "", err
	}

	id, err := newID()
	if err != nil {
		return "", err
	}

	m.mu.Lock()
	m.instances[id] = instance
	m.mu.Unlock()

	return TargetScheme + "://" + id, nil
}

// IsAppTarget reports whether target refers to an opened app instance.
func IsAppTarget(target string) bool {
	return strings.HasPrefix(target, TargetScheme+"://")
}

// Invoke routes a method call to the instance referenced by target.
func (m *Manager) Invoke(target string, methodPath string, request []byte, headers map[string]string) ([]byte, error) {
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

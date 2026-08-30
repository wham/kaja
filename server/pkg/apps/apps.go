// Package apps implements kaja "apps": built-in integrations that expose a proto
// surface kaja renders and invokes the same way as a regular gRPC/Twirp app.
//
// Apps are built in today, but the App/Instance interfaces are shaped like a future
// generic gRPC "App" service so remote apps — separate processes speaking a standard
// contract — can be added without changing how the UI consumes them: Open generates
// the proto surface to render, Invoke runs a method and streams back what it answers
// with.
package apps

import (
	"context"
	"fmt"
	"io"
	"strings"
	"sync"

	"github.com/wham/kaja/v2/pkg/grpc"
)

// AppHeader is the reserved header the client sends alongside the app's own, naming
// the app a call belongs to. It never reaches the wire: the request routers take it
// out and use it to look up the app — the instance to invoke, and the credential and
// transport kaja holds for it. That is what keeps a "${secret}" token where it lives,
// what makes Basic's base64 kaja's to do rather than yours, and what leaves the
// browser with no address to be told.
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
// compile and the instance its methods are invoked on.
type App interface {
	Open(parameters map[string]string, protoDir string, log func(string)) (*Opened, error)
}

// Opened is the result of opening an app: where its proto surface lives and what
// its methods are invoked on.
type Opened struct {
	// ProtoDir overrides where the proto surface to compile lives. Empty means the
	// protoDir passed to Open. A relative path ("seating/proto") is resolved by the
	// compiler against the workspace, which is what an app with protos on disk uses.
	ProtoDir string
	// Instance is what the app's methods are invoked on. Every app has one, the
	// forwarding gRPC app included: forwarding is a way of answering a call, not a
	// second kind of app.
	Instance Instance
}

// Call is one method invocation on its way to an app.
type Call struct {
	// Method is the gRPC method path, e.g. "openapi.petstore.PetstoreApi/GetPet".
	Method string
	// Request is the encoded protobuf of the method's request message.
	Request []byte
	// Headers are forwarded upstream, the app's own credential already merged in.
	Headers map[string]string
	// TLS is how a forwarded call reaches its server. It is read from kaja.json when
	// the call is made rather than held from Open, which is what makes a replaced
	// certificate take effect on the next call; an app that answers in this process
	// makes no such connection and ignores it.
	TLS grpc.TLSOptions
}

// Instance is a live, opened app that can invoke its generated methods.
type Instance interface {
	// Invoke starts the call and hands back the stream its responses arrive on. A
	// unary method is a stream of one — the frames on the wire are the same either
	// way — which is what lets one lane carry every app and every kind of method.
	Invoke(ctx context.Context, call *Call) (Stream, error)
}

// Stream is a call in progress: the response messages, then what the exchange had to
// say for itself.
type Stream interface {
	// Recv returns the next response message as encoded protobuf, io.EOF once there
	// are none left.
	Recv() ([]byte, error)
	// Report is what the call has to say once Recv has stopped — a trailer is
	// metadata about a response, so there is nothing to read before there is one.
	Report() *Report
}

// Report is what a call says about itself beside its response messages: the hop kaja
// made on its behalf, and what a forwarded call's server answered with.
type Report struct {
	// Metadata is what a forwarded call's server answered with, under its own names.
	// That lane is a bridge rather than a hop — the same call is forwarded — so the
	// server's metadata is the response's own rather than an exchange of kaja's.
	Metadata map[string]string
	// RequestHeaders/ResponseHeaders are the upstream exchange an app made on the
	// call's behalf, which the client shows as the API's own headers. An app with no
	// upstream hop leaves them empty.
	RequestHeaders  map[string]string
	ResponseHeaders map[string]string
	// DurationMs is the wall-clock time of the call as this process measured it — the
	// upstream exchange plus the app's own encode/decode, and nothing of the trip
	// between the UI and here. Stamped by ApiService.InvokeApp, the one door every
	// call goes through, so an app never fills it in itself.
	DurationMs int64
}

// OneMessage is the stream of a call that answers all at once, which is every app
// kaja invokes in this process rather than forwards. A nil report is a call with
// nothing to report — a local app, or a service running in this process — and stays
// nil rather than becoming an empty one nobody asked for.
func OneMessage(body []byte, report *Report) Stream {
	return &oneMessage{body: body, report: report}
}

type oneMessage struct {
	body   []byte
	sent   bool
	report *Report
}

func (s *oneMessage) Recv() ([]byte, error) {
	if s.sent {
		return nil, io.EOF
	}
	s.sent = true
	return s.body, nil
}

func (s *oneMessage) Report() *Report { return s.report }

// Manager owns the registry of app types and the set of live instances.
//
// An instance is registered under the app's own name, which is the address the client
// already sends: there is nothing for the browser to be told and nothing for it to get
// wrong, and reopening an app replaces the instance it had rather than leaving it
// behind.
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

// Open instantiates an app of the given type and registers it under name, replacing
// whatever was open under that name before. Generated protos are written into
// protoDir; the directory the surface actually lives in is what comes back.
func (m *Manager) Open(name string, appType string, parameters map[string]string, protoDir string, log func(string)) (string, error) {
	m.mu.Lock()
	app, ok := m.types[appType]
	m.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("unknown app type %q", appType)
	}

	opened, err := app.Open(parameters, protoDir, log)
	if err != nil {
		return "", err
	}

	m.mu.Lock()
	m.instances[name] = opened.Instance
	m.mu.Unlock()

	if opened.ProtoDir != "" {
		return opened.ProtoDir, nil
	}
	return protoDir, nil
}

// Invoke routes a call to the app registered under name.
func (m *Manager) Invoke(ctx context.Context, name string, call *Call) (Stream, error) {
	m.mu.Lock()
	instance, ok := m.instances[name]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("app %q is not open (it may need to be recompiled)", name)
	}

	return instance.Invoke(ctx, call)
}

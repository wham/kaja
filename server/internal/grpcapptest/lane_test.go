package grpcapptest

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	internalgrpc "github.com/wham/kaja/v2/internal/grpc"
	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/router"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/dynamicpb"
)

// kaja is a running kaja: the configuration it read, the app it opened, and the mux
// both builds mount. A test calls through it exactly as a browser does.
type kaja struct {
	Service *api.ApiService
	Mux     *http.ServeMux
	App     string
	files   *protoregistry.Files
}

// openKaja writes a kaja.json holding one grpc app, opens it, and mounts the lane.
// The app's parameters are what the UI would have written.
func openKaja(t *testing.T, name string, parameters map[string]string, variables map[string]string) *kaja {
	t.Helper()

	entry := map[string]any{"name": name, "grpc": grpcEntry(parameters)}
	configuration := map[string]any{"apps": []any{entry}}
	if len(variables) > 0 {
		configuration["variables"] = variables
	}
	encoded, err := json.Marshal(configuration)
	if err != nil {
		t.Fatalf("configuration: %v", err)
	}
	path := t.TempDir() + "/kaja.json"
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatalf("write configuration: %v", err)
	}

	service := api.NewApiService(path, false, "", "", nil)
	if _, err := service.Apps().Open(name, "grpc", parameters, t.TempDir(), func(string) {}); err != nil {
		t.Fatalf("open app: %v", err)
	}

	mux := http.NewServeMux()
	router.Mount(mux, service)
	return &kaja{Service: service, Mux: mux, App: name}
}

// grpcEntry is the typed oneof kaja.json carries for a grpc app, from the flat
// parameters the door is opened with.
func grpcEntry(parameters map[string]string) map[string]any {
	entry := map[string]any{}
	for key, value := range parameters {
		switch key {
		case "reflection", "insecure_skip_verify":
			entry[key] = value == "true"
		default:
			entry[key] = value
		}
	}
	return entry
}

// exchange is one call as the client saw it.
type exchange struct {
	Status   int
	Messages [][]byte
	Trailers string
	Body     []byte
}

// invoke makes the call a browser makes: gRPC-Web at /app, the app's name in the
// reserved header, every call header under an X-Header- prefix.
func (k *kaja) invoke(t *testing.T, method string, request proto.Message, headers map[string]string) exchange {
	t.Helper()
	return k.invokeWithin(t, context.Background(), method, request, headers)
}

// invokeWithin is that call with a context of the caller's, which is the browser's
// own: a stream ends when the fetch does, so a watch is read for as long as somebody
// is reading it and no longer.
func (k *kaja) invokeWithin(t *testing.T, ctx context.Context, method string, request proto.Message, headers map[string]string) exchange {
	t.Helper()
	payload := []byte(nil)
	if request != nil {
		encoded, err := proto.Marshal(request)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		payload = encoded
	}

	httpRequest := httptest.NewRequest(http.MethodPost, "/app/"+method, bytes.NewReader(frame(0, payload))).WithContext(ctx)
	httpRequest.Header.Set("Content-Type", "application/grpc-web+proto")
	httpRequest.Header.Set("X-Header-X-Kaja-App", k.App)
	for name, value := range headers {
		httpRequest.Header.Set("X-Header-"+name, value)
	}

	recorder := httptest.NewRecorder()
	k.Mux.ServeHTTP(recorder, httpRequest)

	body := recorder.Body.Bytes()
	messages, trailers := parseFrames(t, body)
	return exchange{Status: recorder.Code, Messages: messages, Trailers: trailers, Body: body}
}

// grpcStatus is the status the trailer block carries, and its message.
func (e exchange) grpcStatus(t *testing.T) (string, string) {
	t.Helper()
	return e.trailer("grpc-status"), e.trailer("grpc-message")
}

func (e exchange) trailer(name string) string {
	for _, line := range strings.Split(e.Trailers, "\r\n") {
		key, value, found := strings.Cut(line, ": ")
		if !found || !strings.EqualFold(key, name) {
			continue
		}
		decoded, err := url.QueryUnescape(value)
		if err != nil {
			return value
		}
		return decoded
	}
	return ""
}

// upstreamReport is what kaja's own out-of-band trailer carried, if anything.
func (e exchange) upstreamReport(t *testing.T) map[string]any {
	t.Helper()
	raw := e.trailer(internalgrpc.UpstreamTrailer)
	if raw == "" {
		return nil
	}
	report := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &report); err != nil {
		t.Fatalf("upstream trailer is not JSON: %v\n%q", err, raw)
	}
	return report
}

// decode reads a response message back as the type the method answers with.
func decode(t *testing.T, files *protoregistry.Files, message string, payload []byte) *dynamicpb.Message {
	t.Helper()
	descriptor := messageDescriptor(t, files, message)
	decoded := dynamicpb.NewMessage(descriptor)
	if err := proto.Unmarshal(payload, decoded); err != nil {
		t.Fatalf("decode %s: %v", message, err)
	}
	return decoded
}

func messageDescriptor(t *testing.T, files *protoregistry.Files, name string) protoreflect.MessageDescriptor {
	t.Helper()
	found, err := files.FindDescriptorByName(protoreflect.FullName(name))
	if err != nil {
		t.Fatalf("find %s: %v", name, err)
	}
	descriptor, ok := found.(protoreflect.MessageDescriptor)
	if !ok {
		t.Fatalf("%s is not a message", name)
	}
	return descriptor
}

// build makes a request message of the named type with the given fields set, which
// is what a script's generated call hands the client.
func build(t *testing.T, files *protoregistry.Files, name string, fields map[string]any) *dynamicpb.Message {
	t.Helper()
	descriptor := messageDescriptor(t, files, name)
	message := dynamicpb.NewMessage(descriptor)
	for key, value := range fields {
		field := descriptor.Fields().ByName(protoreflect.Name(key))
		if field == nil {
			t.Fatalf("%s has no field %q", name, key)
		}
		message.Set(field, valueOf(t, field, value))
	}
	return message
}

func valueOf(t *testing.T, field protoreflect.FieldDescriptor, value any) protoreflect.Value {
	t.Helper()
	switch v := value.(type) {
	case string:
		return protoreflect.ValueOfString(v)
	case int:
		switch field.Kind() {
		case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind:
			return protoreflect.ValueOfInt32(int32(v))
		case protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind:
			return protoreflect.ValueOfInt64(int64(v))
		case protoreflect.EnumKind:
			return protoreflect.ValueOfEnum(protoreflect.EnumNumber(v))
		}
		t.Fatalf("field %s takes %s, not an int", field.FullName(), field.Kind())
	case bool:
		return protoreflect.ValueOfBool(v)
	case []byte:
		return protoreflect.ValueOfBytes(v)
	case proto.Message:
		return protoreflect.ValueOfMessage(v.ProtoReflect())
	}
	t.Fatalf("no value for %#v", value)
	return protoreflect.Value{}
}

func frame(flag byte, payload []byte) []byte {
	framed := []byte{flag, 0, 0, 0, 0}
	binary.BigEndian.PutUint32(framed[1:5], uint32(len(payload)))
	return append(framed, payload...)
}

func parseFrames(t *testing.T, body []byte) (messages [][]byte, trailers string) {
	t.Helper()
	for len(body) >= 5 {
		flag := body[0]
		n := binary.BigEndian.Uint32(body[1:5])
		if uint32(len(body)-5) < n {
			t.Fatalf("frame says %d bytes, %d left", n, len(body)-5)
		}
		if payload := body[5 : 5+n]; flag&0x80 != 0 {
			trailers = string(payload)
		} else {
			messages = append(messages, payload)
		}
		body = body[5+n:]
	}
	return messages, trailers
}

// inspect asks the Api service what a grpc app's surface would be, which is what the
// New gRPC app form shows.
func inspect(t *testing.T, parameters map[string]string) *api.InspectGrpcResponse {
	t.Helper()
	path := t.TempDir() + "/kaja.json"
	if err := os.WriteFile(path, []byte(`{}`), 0o600); err != nil {
		t.Fatalf("write configuration: %v", err)
	}
	return inspectWith(t, api.NewApiService(path, false, "", "", nil), parameters)
}

func inspectWith(t *testing.T, service *api.ApiService, parameters map[string]string) *api.InspectGrpcResponse {
	t.Helper()
	app := &api.GrpcApp{}
	for key, value := range parameters {
		switch key {
		case "url":
			app.Url = value
		case "proto_dir":
			app.ProtoDir = value
		case "reflection":
			app.Reflection = value == "true"
		case "auth":
			app.Auth = value
		case "token":
			app.Token = value
		case "username":
			app.Username = value
		case "password":
			app.Password = value
		case "api_key_name":
			app.ApiKeyName = value
		case "tls":
			app.Tls = value
		case "insecure_skip_verify":
			app.InsecureSkipVerify = value == "true"
		case "ca_file":
			app.CaFile = value
		case "client_cert_file":
			app.ClientCertFile = value
		case "client_key_file":
			app.ClientKeyFile = value
		default:
			t.Fatalf("no GrpcApp field for parameter %q", key)
		}
	}
	response, err := service.InspectGrpc(t.Context(), &api.InspectGrpcRequest{Grpc: app})
	if err != nil {
		t.Fatalf("InspectGrpc: %v", err)
	}
	return response
}

// summary is a one-line reading of what Inspect answered, for a test's failure text.
func summary(response *api.InspectGrpcResponse) string {
	if problem := response.GetProblem(); problem != nil {
		return fmt.Sprintf("problem %s: %s (%s)", problem.GetKind(), problem.GetMessage(), problem.GetDetail())
	}
	server := response.GetServer()
	names := []string{}
	for _, service := range server.GetServices() {
		names = append(names, fmt.Sprintf("%s(%d)", service.GetName(), service.GetMethodCount()))
	}
	return fmt.Sprintf("%s via %s tls=%v reflection=%s services=%v", server.GetTarget(), server.GetSource(), server.GetTls(), server.GetReflectionVersion(), names)
}

func writeAll(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o600)
}

// absolute is a testdata path as the app configuration carries it. A relative
// proto_dir is resolved against the workspace, which a test does not have.
func absolute(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.Abs(path)
	if err != nil {
		t.Fatalf("absolute %s: %v", path, err)
	}
	return resolved
}

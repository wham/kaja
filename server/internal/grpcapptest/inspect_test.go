package grpcapptest

import (
	"fmt"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/api"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// TestInspectReflection is the New gRPC app form's read against a server that
// reflects: the whole of what the form fills itself in from.
func TestInspectReflection(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"routeguide", "health"}, Reflection: true})

	response := inspect(t, map[string]string{"url": up.URL, "reflection": "true"})
	if problem := response.GetProblem(); problem != nil {
		t.Fatalf("reflection failed: %s", summary(response))
	}
	server := response.GetServer()
	if server.GetSource() != "reflection" {
		t.Errorf("source = %q, want reflection", server.GetSource())
	}
	if server.GetReflectionVersion() != "v1" {
		t.Errorf("reflection version = %q, want v1", server.GetReflectionVersion())
	}
	if got := serviceNames(server); !equal(got, []string{"grpc.health.v1.Health", "routeguide.RouteGuide"}) {
		t.Errorf("services = %v, want the two the server declares", got)
	}
	if server.GetMethodCount() != 6 {
		t.Errorf("method count = %d, want 6 (4 route guide + 2 health)", server.GetMethodCount())
	}
	// RecordRoute and RouteChat take a client stream; the form says so rather than
	// letting the method read as callable.
	for _, service := range server.GetServices() {
		if service.GetName() == "routeguide.RouteGuide" && service.GetClientStreamingMethodCount() != 2 {
			t.Errorf("client-streaming count = %d, want 2", service.GetClientStreamingMethodCount())
		}
	}
	t.Logf("read: %s", summary(response))
}

// TestInspectReflectionV1Alpha is the same read against a server old enough to serve
// only the alpha reflection service, which is most of the ones deployed.
func TestInspectReflectionV1Alpha(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"routeguide"}, ReflectionV1AlphaOnly: true})

	response := inspect(t, map[string]string{"url": up.URL, "reflection": "true"})
	if problem := response.GetProblem(); problem != nil {
		t.Fatalf("v1alpha reflection failed: %s", summary(response))
	}
	if got := response.GetServer().GetReflectionVersion(); got != "v1alpha" {
		t.Errorf("reflection version = %q, want v1alpha", got)
	}
}

// TestInspectNoReflection is the server that answers but doesn't reflect.
func TestInspectNoReflection(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"routeguide"}})

	response := inspect(t, map[string]string{"url": up.URL, "reflection": "true"})
	problem := response.GetProblem()
	if problem.GetKind() != api.GrpcProblemKind_GRPC_PROBLEM_NO_REFLECTION {
		t.Fatalf("kind = %s, want NO_REFLECTION: %s", problem.GetKind(), summary(response))
	}
	t.Logf("said: %s / %s", problem.GetMessage(), problem.GetDetail())
}

// TestInspectAuth is a server that guards reflection: the form is told a credential
// is wanted, and the same read with one succeeds.
func TestInspectAuth(t *testing.T) {
	const token = "reflection-token"
	up := startUpstream(t, upstreamOptions{
		Dirs:       []string{"routeguide"},
		Reflection: true,
		Auth: func(md metadata.MD) error {
			values := md.Get("authorization")
			if len(values) == 0 {
				return status.Error(codes.Unauthenticated, "who goes there")
			}
			if values[0] != "Bearer "+token {
				return status.Error(codes.PermissionDenied, "not that one")
			}
			return nil
		},
	})

	bare := inspect(t, map[string]string{"url": up.URL, "reflection": "true"})
	if bare.GetProblem().GetKind() != api.GrpcProblemKind_GRPC_PROBLEM_UNAUTHENTICATED {
		t.Errorf("no credential: kind = %s, want UNAUTHENTICATED: %s", bare.GetProblem().GetKind(), summary(bare))
	}

	wrong := inspect(t, map[string]string{"url": up.URL, "reflection": "true", "auth": "bearer", "token": "nope"})
	if wrong.GetProblem().GetKind() != api.GrpcProblemKind_GRPC_PROBLEM_PERMISSION_DENIED {
		t.Errorf("wrong credential: kind = %s, want PERMISSION_DENIED: %s", wrong.GetProblem().GetKind(), summary(wrong))
	}

	right := inspect(t, map[string]string{"url": up.URL, "reflection": "true", "auth": "bearer", "token": token})
	if right.GetProblem() != nil {
		t.Errorf("with the credential: %s", summary(right))
	}
}

// TestInspectAuthSchemes is every credential scheme a gRPC app can hold, read by a
// server that checks the metadata each one is supposed to produce.
func TestInspectAuthSchemes(t *testing.T) {
	for _, scheme := range []struct {
		name       string
		parameters map[string]string
		want       map[string]string
	}{
		{
			name:       "bearer",
			parameters: map[string]string{"auth": "bearer", "token": "abc123"},
			want:       map[string]string{"authorization": "Bearer abc123"},
		},
		{
			name:       "basic",
			parameters: map[string]string{"auth": "basic", "username": "ada", "password": "l0vel4ce"},
			want:       map[string]string{"authorization": "Basic YWRhOmwwdmVsNGNl"},
		},
		{
			name:       "apikey default name",
			parameters: map[string]string{"auth": "apikey", "token": "key-1"},
			want:       map[string]string{"x-api-key": "key-1"},
		},
		{
			name:       "apikey named",
			parameters: map[string]string{"auth": "apikey", "token": "key-2", "api_key_name": "X-Custom-Key"},
			want:       map[string]string{"x-custom-key": "key-2"},
		},
	} {
		t.Run(scheme.name, func(t *testing.T) {
			up := startUpstream(t, upstreamOptions{
				Dirs:       []string{"routeguide"},
				Reflection: true,
				Auth: func(md metadata.MD) error {
					for name, value := range scheme.want {
						if got := md.Get(name); len(got) == 0 || got[0] != value {
							return status.Errorf(codes.Unauthenticated, "%s = %v, want %q", name, got, value)
						}
					}
					return nil
				},
			})

			parameters := map[string]string{"url": up.URL, "reflection": "true"}
			for key, value := range scheme.parameters {
				parameters[key] = value
			}
			if response := inspect(t, parameters); response.GetProblem() != nil {
				t.Errorf("%s: %s", scheme.name, summary(response))
			}
		})
	}
}

// TestInspectTLS covers what a TLS address can and can't say for itself.
func TestInspectTLS(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"routeguide"}, Reflection: true, TLS: true})

	t.Run("a certificate nothing trusts is a TLS problem", func(t *testing.T) {
		response := inspect(t, map[string]string{"url": up.URL, "reflection": "true"})
		if response.GetProblem().GetKind() != api.GrpcProblemKind_GRPC_PROBLEM_TLS {
			t.Errorf("kind = %s, want TLS: %s", response.GetProblem().GetKind(), summary(response))
		}
	})

	t.Run("the CA the app names is trusted", func(t *testing.T) {
		response := inspect(t, map[string]string{"url": up.URL, "reflection": "true", "ca_file": up.CAFile})
		if response.GetProblem() != nil {
			t.Errorf("with the CA: %s", summary(response))
		} else if !response.GetServer().GetTls() {
			t.Errorf("tls = false, want the transport it answered over")
		}
	})

	t.Run("verification can be skipped", func(t *testing.T) {
		response := inspect(t, map[string]string{"url": up.URL, "reflection": "true", "insecure_skip_verify": "true"})
		if response.GetProblem() != nil {
			t.Errorf("skipping verification: %s", summary(response))
		}
	})

	t.Run("a plaintext app against a TLS server says which", func(t *testing.T) {
		response := inspect(t, map[string]string{"url": up.URL, "reflection": "true", "tls": "off"})
		problem := response.GetProblem()
		if problem.GetKind() != api.GrpcProblemKind_GRPC_PROBLEM_TLS {
			t.Fatalf("kind = %s, want TLS: %s", problem.GetKind(), summary(response))
		}
		if !strings.Contains(problem.GetMessage(), "only speaks TLS") {
			t.Errorf("message = %q, want the one naming the transport", problem.GetMessage())
		}
	})
}

// TestInspectMutualTLS is a server that wants kaja's own certificate.
func TestInspectMutualTLS(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"routeguide"}, Reflection: true, TLS: true, MutualTLS: true})

	without := inspect(t, map[string]string{"url": up.URL, "reflection": "true", "ca_file": up.CAFile})
	if without.GetProblem() == nil {
		t.Errorf("no client certificate: %s, want a refusal", summary(without))
	} else {
		t.Logf("no client certificate: %s", summary(without))
	}

	with := inspect(t, map[string]string{
		"url": up.URL, "reflection": "true",
		"ca_file": up.CAFile, "client_cert_file": up.ClientCert, "client_key_file": up.ClientKey,
	})
	if with.GetProblem() != nil {
		t.Errorf("with the client certificate: %s", summary(with))
	}
}

// TestInspectTLSAgainstPlaintext is the other half of the transport question.
func TestInspectTLSAgainstPlaintext(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"routeguide"}, Reflection: true})

	response := inspect(t, map[string]string{"url": up.URL, "reflection": "true", "tls": "on"})
	problem := response.GetProblem()
	if problem.GetKind() != api.GrpcProblemKind_GRPC_PROBLEM_TLS {
		t.Fatalf("kind = %s, want TLS: %s", problem.GetKind(), summary(response))
	}
	if !strings.Contains(problem.GetMessage(), "doesn't speak TLS") {
		t.Errorf("message = %q, want the one naming the transport", problem.GetMessage())
	}
}

// TestInspectProtoDir is the other source a gRPC app's surface comes from. The route
// guide is edition 2023, so this is also the question of whether kaja compiles a
// modern .proto at all.
func TestInspectProtoDir(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"routeguide"}})

	response := inspect(t, map[string]string{"url": up.URL, "proto_dir": absolute(t, "testdata/routeguide")})
	if response.GetProblem() != nil {
		t.Fatalf("proto dir: %s", summary(response))
	}
	server := response.GetServer()
	if server.GetSource() != "proto_dir" {
		t.Errorf("source = %q, want proto_dir", server.GetSource())
	}
	if !server.GetReachable() {
		t.Errorf("reachable = false, want the probe to have found the server")
	}
	if got := serviceNames(server); !equal(got, []string{"routeguide.RouteGuide"}) {
		t.Errorf("services = %v", got)
	}
}

// TestInspectProtoDirProblems is what the form says when the folder isn't one.
func TestInspectProtoDirProblems(t *testing.T) {
	empty := t.TempDir()
	broken := t.TempDir()
	writeFile(t, broken+"/broken.proto", "syntax = \"proto3\"; package broken; message Missing { Nope field = 1; }")
	serviceless := t.TempDir()
	writeFile(t, serviceless+"/types.proto", "syntax = \"proto3\"; package types; message Thing { string name = 1; }")

	for _, one := range []struct {
		name string
		dir  string
		want api.GrpcProblemKind
	}{
		{"empty folder", empty, api.GrpcProblemKind_GRPC_PROBLEM_NO_PROTO_FILES},
		{"folder that isn't there", empty + "/nowhere", api.GrpcProblemKind_GRPC_PROBLEM_NO_PROTO_FILES},
		{"protos that don't compile", broken, api.GrpcProblemKind_GRPC_PROBLEM_PROTO_INVALID},
		{"protos with no service", serviceless, api.GrpcProblemKind_GRPC_PROBLEM_NO_PROTO_FILES},
	} {
		t.Run(one.name, func(t *testing.T) {
			response := inspect(t, map[string]string{"url": "http://127.0.0.1:1", "proto_dir": one.dir})
			if response.GetProblem().GetKind() != one.want {
				t.Errorf("kind = %s, want %s: %s", response.GetProblem().GetKind(), one.want, summary(response))
			} else {
				t.Logf("said: %s / %s", response.GetProblem().GetMessage(), response.GetProblem().GetDetail())
			}
		})
	}
}

// TestInspectTargets is every way an address can fail to be one.
func TestInspectTargets(t *testing.T) {
	for _, one := range []struct {
		name string
		url  string
		want api.GrpcProblemKind
	}{
		{"nothing at all", "", api.GrpcProblemKind_GRPC_PROBLEM_TARGET},
		{"only whitespace", "   ", api.GrpcProblemKind_GRPC_PROBLEM_TARGET},
		{"a port nothing is listening on", "http://127.0.0.1:1", api.GrpcProblemKind_GRPC_PROBLEM_UNREACHABLE},
		{"a host that doesn't resolve", "http://nothing.invalid:443", api.GrpcProblemKind_GRPC_PROBLEM_UNREACHABLE},
	} {
		t.Run(one.name, func(t *testing.T) {
			response := inspect(t, map[string]string{"url": one.url, "reflection": "true"})
			if response.GetProblem().GetKind() != one.want {
				t.Errorf("kind = %s, want %s: %s", response.GetProblem().GetKind(), one.want, summary(response))
			} else {
				t.Logf("said: %s / %s", response.GetProblem().GetMessage(), response.GetProblem().GetDetail())
			}
		})
	}
}

// TestInspectNoServices is a server that reflects and has nothing of its own.
func TestInspectNoServices(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"nothing"}, Reflection: true})
	response := inspect(t, map[string]string{"url": up.URL, "reflection": "true"})
	if response.GetProblem().GetKind() != api.GrpcProblemKind_GRPC_PROBLEM_NO_SERVICES {
		t.Errorf("kind = %s, want NO_SERVICES: %s", response.GetProblem().GetKind(), summary(response))
	}
}

func serviceNames(server *api.GrpcServer) []string {
	names := []string{}
	for _, service := range server.GetServices() {
		names = append(names, service.GetName())
	}
	return names
}

func equal(got, want []string) bool {
	return fmt.Sprint(got) == fmt.Sprint(want)
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := writeAll(path, content); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// TestInspectSelfSignedWrongTransport is the internal server: it speaks TLS with a
// certificate nothing here trusts, and the app was configured for plaintext. The
// handshake it refuses is still proof of what it speaks.
func TestInspectSelfSignedWrongTransport(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"routeguide"}, Reflection: true, TLS: true})

	response := inspect(t, map[string]string{"url": up.URL, "reflection": "true", "tls": "off"})
	problem := response.GetProblem()
	if problem.GetKind() != api.GrpcProblemKind_GRPC_PROBLEM_TLS {
		t.Fatalf("kind = %s, want TLS: %s", problem.GetKind(), summary(response))
	}
	if !strings.Contains(problem.GetMessage(), "only speaks TLS") {
		t.Errorf("message = %q, want the one naming the transport", problem.GetMessage())
	}
}

// TestInspectDetailIsACaption is what the form is handed to print under the message.
// A server answering a gRPC call from its HTTP frontend sends a page, and a page is
// not a caption.
func TestInspectDetailIsACaption(t *testing.T) {
	skipUnlessReachable(t, "pubsub.googleapis.com:443")

	response := inspect(t, map[string]string{"url": pubsub, "reflection": "true"})
	detail := response.GetProblem().GetDetail()
	if strings.Contains(detail, "<!DOCTYPE html") || strings.Contains(detail, "\n") {
		t.Errorf("the detail is a document rather than a line:\n%s", detail)
	}
	if len([]rune(detail)) > 420 {
		t.Errorf("the detail is %d characters long", len([]rune(detail)))
	}
	t.Logf("detail: %s", detail)
}

// The live half of the suite: the public gRPC servers kaja is pointed at in the
// world rather than ones this test started. They are off unless KAJA_LIVE_TESTS is
// set, so an ordinary `go test ./...` calls nobody's API.
package grpcapptest

import (
	"context"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/grpc"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
)

// The public gRPC servers this suite reads: grpcb.in, the demo workspace's upstream,
// on its plaintext and its TLS port, and Postman's echo server, which is the one
// everybody points a gRPC client at first.
var publicServers = []struct {
	name string
	url  string
	// dial is the address to check is reachable before asking anything of it, so a
	// server that is down is skipped rather than reported as a kaja failure.
	dial string
	tls  bool
}{
	{name: "grpcb.in", url: "grpc://grpcb.in:9000", dial: "grpcb.in:9000"},
	{name: "grpcb.in over TLS", url: "grpcs://grpcb.in:9001", dial: "grpcb.in:9001", tls: true},
	{name: "grpc.postman-echo.com", url: "dns:grpc.postman-echo.com:443", dial: "grpc.postman-echo.com:443", tls: true},
}

// TestPublicReflection reads each public server the way the New app form does.
func TestPublicReflection(t *testing.T) {
	for _, server := range publicServers {
		t.Run(server.name, func(t *testing.T) {
			skipUnlessReachable(t, server.dial)

			response := inspect(t, map[string]string{"url": server.url, "reflection": "true"})
			if problem := response.GetProblem(); problem != nil {
				// A network that terminates TLS in the middle and carries no HTTP/2 to
				// this host answers the handshake itself, which is not a reading of the
				// server.
				if strings.Contains(problem.GetDetail(), "does not look like a TLS handshake") {
					t.Skipf("nothing on this network carries gRPC to %s: %s", server.name, problem.GetDetail())
				}
				t.Fatalf("%s: %s", server.name, summary(response))
			}
			t.Logf("%s", summary(response))
			if response.GetServer().GetMethodCount() == 0 {
				t.Errorf("no methods read off %s", server.name)
			}
			if got := response.GetServer().GetTls(); got != server.tls {
				t.Errorf("tls = %v, want %v", got, server.tls)
			}
		})
	}
}

// TestPublicWrongTransport pins the transport the wrong way round against a server
// with a certificate the machine trusts, which is the one case where kaja can say
// what is wrong rather than that it couldn't connect.
func TestPublicWrongTransport(t *testing.T) {
	server := publicServers[2]
	skipUnlessReachable(t, server.dial)

	response := inspect(t, map[string]string{"url": server.url, "reflection": "true", "tls": "off"})
	problem := response.GetProblem()
	if problem == nil {
		t.Fatalf("plaintext against a TLS server: %s", summary(response))
	}
	t.Logf("said: %s / %s / %s", problem.GetKind(), problem.GetMessage(), problem.GetDetail())
	if problem.GetKind() != api.GrpcProblemKind_GRPC_PROBLEM_TLS {
		t.Errorf("kind = %s, want TLS", problem.GetKind())
	}
}

// TestPublicNoCredential is what a server that guards its methods says to a read
// with nothing on it. Postman's echo server does not guard reflection, so this is
// the shape of the answer rather than a refusal.
func TestPublicUnknownHost(t *testing.T) {
	response := inspect(t, map[string]string{"url": "dns:grpc.example.invalid:443", "reflection": "true"})
	problem := response.GetProblem()
	if problem == nil {
		t.Fatalf("a host that does not exist answered: %s", summary(response))
	}
	t.Logf("said: %s / %s / %s", problem.GetKind(), problem.GetMessage(), problem.GetDetail())
}

func skipUnlessReachable(t *testing.T, address string) {
	t.Helper()
	if os.Getenv("KAJA_LIVE_TESTS") == "" {
		t.Skip("set KAJA_LIVE_TESTS=1 to read the public servers")
	}
	connection, err := net.DialTimeout("tcp", address, 5*time.Second)
	if err != nil {
		t.Skipf("%s is not reachable from here: %v", address, err)
	}
	connection.Close()
}

// TestLiveDemoApp is the demo workspace's gRPC upstream, opened and called the way
// the window does it: reflect the server, compile what it declared, then make the
// call a script would make. It is the one case here where every piece is real at once.
func TestLiveDemoApp(t *testing.T) {
	skipUnlessReachable(t, "grpcb.in:9000")

	const target = "grpc://grpcb.in:9000"
	sources, _ := openAndCompile(t, &api.WorkspaceApp{
		Name: "grpcb.in",
		App:  &api.WorkspaceApp_Grpc{Grpc: &api.GrpcApp{Url: target, Reflection: true}},
	})
	t.Logf("generated: %v", sourceNames(sources))

	k := openKaja(t, "grpcb.in", map[string]string{"url": target, "reflection": "true"}, nil)
	files := reflectedFiles(t, target)

	t.Run("a unary call", func(t *testing.T) {
		e := k.invoke(t, "hello.HelloService/SayHello", build(t, files, "hello.HelloRequest", map[string]any{"greeting": "kaja"}), nil)
		code, message := e.grpcStatus(t)
		if code != "0" {
			t.Fatalf("grpc-status = %q (%s)", code, message)
		}
		if len(e.Messages) != 1 {
			t.Fatalf("%d messages, want 1", len(e.Messages))
		}
		answered := decode(t, files, "hello.HelloResponse", e.Messages[0])
		t.Logf("answered with %d bytes: %s", len(e.Messages[0]), firstLine(answered.String()))
	})

	t.Run("a server stream, read to its end", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()

		e := k.invokeWithin(t, ctx, "hello.HelloService/LotsOfReplies", build(t, files, "hello.HelloRequest", map[string]any{"greeting": "kaja"}), nil)
		code, message := e.grpcStatus(t)
		t.Logf("the stream carried %d message(s) and ended with %s (%s)", len(e.Messages), code, message)
		if code != "0" {
			t.Errorf("grpc-status = %q (%s)", code, message)
		}
		if len(e.Messages) < 2 {
			t.Errorf("the stream carried %d message(s), want several", len(e.Messages))
		}
	})
}

// reflectedFiles reads a live server's surface as descriptors, which is what a test
// builds its requests against.
func reflectedFiles(t *testing.T, target string) *protoregistry.Files {
	t.Helper()
	client, err := grpc.NewReflectionClientFromString(target, grpc.TLSOptions{}, nil)
	if err != nil {
		t.Fatalf("reflection client: %v", err)
	}
	result, err := client.Discover(t.Context())
	if err != nil {
		t.Fatalf("discover %s: %v", target, err)
	}
	files, err := protodesc.NewFiles(&descriptorpb.FileDescriptorSet{File: result.FileDescriptors})
	if err != nil {
		t.Fatalf("resolve %s: %v", target, err)
	}
	return files
}

func firstLine(text string) string {
	if line, _, found := strings.Cut(text, "\n"); found {
		return line
	}
	if len(text) > 200 {
		return text[:200] + "…"
	}
	return text
}

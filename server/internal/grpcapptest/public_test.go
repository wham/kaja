// The live half of the suite: the public gRPC servers kaja is pointed at in the
// world rather than ones this test started. They are off unless KAJA_LIVE_TESTS is
// set, so an ordinary `go test ./...` calls nobody's API.
package grpcapptest

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
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

// The public gRPC servers this suite reads: kaja's own demo upstream, and Postman's
// echo server, which is the one everybody points a gRPC client at first.
var publicServers = []struct {
	name string
	url  string
	// dial is the address to check is reachable before asking anything of it, so a
	// server that is down is skipped rather than reported as a kaja failure.
	dial string
}{
	{name: "seating.kaja.tools", url: "dns:seating.kaja.tools:443", dial: "seating.kaja.tools:443"},
	{name: "grpc.postman-echo.com", url: "dns:grpc.postman-echo.com:443", dial: "grpc.postman-echo.com:443"},
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
			if !response.GetServer().GetTls() {
				t.Errorf("tls = false against a :443 server")
			}
		})
	}
}

// TestPublicWrongTransport pins the transport the wrong way round against a server
// with a certificate the machine trusts, which is the one case where kaja can say
// what is wrong rather than that it couldn't connect.
func TestPublicWrongTransport(t *testing.T) {
	skipUnlessReachable(t, publicServers[0].dial)

	response := inspect(t, map[string]string{"url": publicServers[0].url, "reflection": "true", "tls": "off"})
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

// TestLiveDemoApp is kaja's own demo upstream, opened and called the way the window
// does it: reflect the server, compile what it declared, then make the call a script
// would make. It is the one case here where every piece is real at once.
func TestLiveDemoApp(t *testing.T) {
	skipUnlessReachable(t, "seating.kaja.tools:443")

	const seating = "dns:seating.kaja.tools:443"
	_, sources, _ := openAndCompile(t, &api.ConfigurationApp{
		Name: "seating",
		App:  &api.ConfigurationApp_Grpc{Grpc: &api.GrpcApp{Url: seating, Reflection: true}},
	})
	t.Logf("generated: %v", sourceNames(sources))

	k := openKaja(t, "seating", map[string]string{"url": seating, "reflection": "true"}, nil)
	files := reflectedFiles(t, seating)

	show := aShow(t)
	t.Run("a unary call", func(t *testing.T) {
		e := k.invoke(t, "seating.Seating/GetSeatMap", build(t, files, "seating.GetSeatMapRequest", map[string]any{"show_id": show}), nil)
		code, message := e.grpcStatus(t)
		if code != "0" {
			t.Fatalf("grpc-status = %q (%s)", code, message)
		}
		if len(e.Messages) != 1 {
			t.Fatalf("%d messages, want 1", len(e.Messages))
		}
		answered := decode(t, files, "seating.GetSeatMapResponse", e.Messages[0])
		t.Logf("answered with %d bytes: %s", len(e.Messages[0]), firstLine(answered.String()))
	})

	t.Run("a server stream, read for as long as somebody is reading it", func(t *testing.T) {
		// WatchSeats stays open, which is what a watch is. The browser going away is
		// what ends it, so the request carries the deadline rather than kaja.
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()

		e := k.invokeWithin(t, ctx, "seating.Seating/WatchSeats", build(t, files, "seating.WatchSeatsRequest", map[string]any{"show_id": show}), nil)
		code, message := e.grpcStatus(t)
		t.Logf("the stream carried %d message(s) and ended with %s (%s)", len(e.Messages), code, message)
		if len(e.Messages) == 0 {
			t.Errorf("the stream carried nothing")
		}
	})
}

// aShow is a show the demo is running, read from the demo's own REST side. The
// seating server is asked about a show rather than in general, and which shows there
// are is a thing about today rather than about kaja.
func aShow(t *testing.T) string {
	t.Helper()
	response, err := http.Get("https://theatre.kaja.tools/shows")
	if err != nil {
		t.Skipf("the demo's shows are not readable from here: %v", err)
	}
	defer response.Body.Close()

	var shows struct {
		Shows []struct {
			Id string `json:"id"`
		} `json:"shows"`
	}
	if err := json.NewDecoder(response.Body).Decode(&shows); err != nil || len(shows.Shows) == 0 {
		t.Skipf("the demo is showing nothing today: %v", err)
	}
	return shows.Shows[0].Id
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

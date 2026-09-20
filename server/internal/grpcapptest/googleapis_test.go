package grpcapptest

import (
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/api"
)

// Google Cloud's own APIs are the most widely deployed gRPC servers there are, and
// their protos are the canonical spec a proto_dir app is pointed at. They answer an
// uncredentialed call rather than dropping it, which is what makes them a real read
// of how kaja reports a refusal.
const (
	pubsub          = "dns:pubsub.googleapis.com:443"
	bigtable        = "dns:bigtable.googleapis.com:443"
	publisherMethod = "google.pubsub.v1.Publisher/ListTopics"
	listTopics      = "google.pubsub.v1.ListTopicsRequest"
)

// TestGoogleApisProtoDir compiles the real pubsub spec — 4,000 lines over seven files
// with imports of their own — and probes the server it names.
func TestGoogleApisProtoDir(t *testing.T) {
	skipUnlessReachable(t, "pubsub.googleapis.com:443")

	response := inspect(t, map[string]string{"url": pubsub, "proto_dir": absolute(t, "testdata/googleapis")})
	if response.GetProblem() != nil {
		t.Fatalf("pubsub spec: %s", summary(response))
	}
	t.Logf("read: %s", summary(response))
	server := response.GetServer()
	if !server.GetReachable() {
		t.Errorf("reachable = false against a live Google endpoint")
	}
	if !server.GetTls() {
		t.Errorf("tls = false against pubsub.googleapis.com:443")
	}
	if got := serviceNames(server); len(got) < 3 {
		t.Errorf("services = %v, want the pubsub surface", got)
	}
}

// TestGoogleApisNoReflection is a real server that doesn't reflect, which is most of
// the managed ones.
func TestGoogleApisNoReflection(t *testing.T) {
	skipUnlessReachable(t, "pubsub.googleapis.com:443")

	response := inspect(t, map[string]string{"url": pubsub, "reflection": "true"})
	problem := response.GetProblem()
	if problem.GetKind() != api.GrpcProblemKind_GRPC_PROBLEM_NO_REFLECTION {
		t.Errorf("kind = %s, want NO_REFLECTION: %s", problem.GetKind(), summary(response))
	}
	t.Logf("said: %s / %s", problem.GetMessage(), problem.GetDetail())
}

// TestGoogleApisGuardedReflection is a real server that refuses the reflection call
// rather than not implementing it.
func TestGoogleApisGuardedReflection(t *testing.T) {
	skipUnlessReachable(t, "bigtable.googleapis.com:443")

	response := inspect(t, map[string]string{"url": bigtable, "reflection": "true"})
	problem := response.GetProblem()
	if problem.GetKind() != api.GrpcProblemKind_GRPC_PROBLEM_PERMISSION_DENIED {
		t.Errorf("kind = %s, want PERMISSION_DENIED: %s", problem.GetKind(), summary(response))
	}
	t.Logf("said: %s / %s", problem.GetMessage(), problem.GetDetail())
}

// TestGoogleApisRefusal is a real call to a real API with no credential: what a
// person sees in the console when they have not set one up yet.
func TestGoogleApisRefusal(t *testing.T) {
	skipUnlessReachable(t, "pubsub.googleapis.com:443")

	k := openKaja(t, "pubsub", map[string]string{"url": pubsub, "proto_dir": absolute(t, "testdata/googleapis")}, nil)
	files := compileFiles(t, "googleapis")

	e := k.invoke(t, publisherMethod, build(t, files, listTopics, map[string]any{"project": "projects/kaja-deep-test"}), nil)

	code, message := e.grpcStatus(t)
	t.Logf("uncredentialed: status %s / %s", code, message)
	t.Logf("trailers: %q", e.Trailers)
	if code == "0" {
		t.Fatalf("Google answered an uncredentialed call")
	}
	if message == "" {
		t.Errorf("the refusal came back without a message, which is the whole of what the console can show")
	}
}

// TestGoogleApisBadCredential is the same call with a credential the API rejects,
// which is the state somebody who pasted the wrong token is in.
func TestGoogleApisBadCredential(t *testing.T) {
	skipUnlessReachable(t, "pubsub.googleapis.com:443")

	k := openKaja(t, "pubsub", map[string]string{
		"url": pubsub, "proto_dir": absolute(t, "testdata/googleapis"),
		"auth": "bearer", "token": "ya29.not-a-real-token",
	}, nil)
	files := compileFiles(t, "googleapis")

	e := k.invoke(t, publisherMethod, build(t, files, listTopics, map[string]any{"project": "projects/kaja-deep-test"}), nil)

	code, message := e.grpcStatus(t)
	t.Logf("bad credential: status %s / %s", code, message)
	t.Logf("trailers: %q", e.Trailers)
	if code == "0" {
		t.Fatalf("Google answered a call carrying a made-up token")
	}
	if !strings.Contains(strings.ToLower(message), "auth") && !strings.Contains(strings.ToLower(message), "credential") && !strings.Contains(strings.ToLower(message), "token") {
		t.Logf("the message doesn't name the credential: %q", message)
	}
}

package grpcapptest

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// theRouteGuide is the method a unary test calls and the types it names.
const (
	getFeature   = "routeguide.RouteGuide/GetFeature"
	listFeatures = "routeguide.RouteGuide/ListFeatures"
	recordRoute  = "routeguide.RouteGuide/RecordRoute"
	point        = "routeguide.Point"
	rectangle    = "routeguide.Rectangle"
	feature      = "routeguide.Feature"
)

// openRouteGuide starts a route guide upstream and a kaja pointed at it.
func openRouteGuide(t *testing.T, options upstreamOptions, parameters map[string]string) (*upstream, *kaja) {
	t.Helper()
	if len(options.Dirs) == 0 {
		options.Dirs = []string{"routeguide"}
	}
	up := startUpstream(t, options)

	app := map[string]string{"url": up.URL, "proto_dir": absolute(t, "testdata/routeguide")}
	for key, value := range parameters {
		app[key] = value
	}
	k := openKaja(t, "guide", app, map[string]string{"TOKEN": "${env:DEEP_TEST_TOKEN}"})
	k.files = up.Files
	return up, k
}

// TestInvokeUnary is one call, the whole way: the browser's gRPC-Web frame, the app
// the header names, the upstream, and what comes back.
func TestInvokeUnary(t *testing.T) {
	var seen string
	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		seen = c.Method
		response := c.New()
		name := response.Descriptor().Fields().ByName("name")
		response.Set(name, protoreflect.ValueOfString("Berkeley"))
		return c.Send(response)
	}}, nil)

	request := build(t, up.Files, point, map[string]any{"latitude": 409146138, "longitude": -746188906})
	e := k.invoke(t, getFeature, request, nil)

	if seen != "/"+getFeature {
		t.Errorf("the upstream was called with %q, want %q", seen, "/"+getFeature)
	}
	if code, message := e.grpcStatus(t); code != "0" {
		t.Fatalf("grpc-status = %q (%s)\ntrailers = %q", code, message, e.Trailers)
	}
	if len(e.Messages) != 1 {
		t.Fatalf("%d messages, want 1", len(e.Messages))
	}
	answered := decode(t, up.Files, feature, e.Messages[0])
	if got := answered.Get(answered.Descriptor().Fields().ByName("name")).String(); got != "Berkeley" {
		t.Errorf("name = %q, want the one the server answered with", got)
	}
}

// TestInvokeRequestReachesTheServer is the other half: the request a script built is
// the request the server reads, field for field.
func TestInvokeRequestReachesTheServer(t *testing.T) {
	var latitude, longitude int64
	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		latitude = c.Request.Get(c.Request.Descriptor().Fields().ByName("latitude")).Int()
		longitude = c.Request.Get(c.Request.Descriptor().Fields().ByName("longitude")).Int()
		return c.Send(c.New())
	}}, nil)

	k.invoke(t, getFeature, build(t, up.Files, point, map[string]any{"latitude": 409146138, "longitude": -746188906}), nil)

	if latitude != 409146138 || longitude != -746188906 {
		t.Errorf("the server read %d,%d", latitude, longitude)
	}
}

// TestInvokeServerStream is the one kind of stream this lane carries: every message
// the server sent arrives as its own frame.
func TestInvokeServerStream(t *testing.T) {
	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		for i := 0; i < 5; i++ {
			response := c.New()
			response.Set(response.Descriptor().Fields().ByName("name"), protoreflect.ValueOfString(fmt.Sprintf("feature %d", i)))
			if err := c.Send(response); err != nil {
				return err
			}
		}
		return nil
	}}, nil)

	e := k.invoke(t, listFeatures, build(t, up.Files, rectangle, nil), nil)

	if code, message := e.grpcStatus(t); code != "0" {
		t.Fatalf("grpc-status = %q (%s)", code, message)
	}
	if len(e.Messages) != 5 {
		t.Fatalf("%d messages, want the 5 the server streamed", len(e.Messages))
	}
	last := decode(t, up.Files, feature, e.Messages[4])
	if got := last.Get(last.Descriptor().Fields().ByName("name")).String(); got != "feature 4" {
		t.Errorf("last = %q, want the last one sent", got)
	}
}

// TestInvokeStreamThatFailsPartWay is a stream that says something and then fails:
// what was sent stands, and the failure is on the trailer where the client reads it.
func TestInvokeStreamThatFailsPartWay(t *testing.T) {
	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		response := c.New()
		response.Set(response.Descriptor().Fields().ByName("name"), protoreflect.ValueOfString("the one that made it"))
		if err := c.Send(response); err != nil {
			return err
		}
		return status.Error(codes.DataLoss, "the rest is gone")
	}}, nil)

	e := k.invoke(t, listFeatures, build(t, up.Files, rectangle, nil), nil)

	if len(e.Messages) != 1 {
		t.Errorf("%d messages, want the one that was sent before the failure", len(e.Messages))
	}
	code, message := e.grpcStatus(t)
	if code != fmt.Sprint(int(codes.DataLoss)) {
		t.Errorf("grpc-status = %q, want %d (DATA_LOSS)", code, codes.DataLoss)
	}
	if message != "the rest is gone" {
		t.Errorf("grpc-message = %q, want the server's own", message)
	}
}

// TestInvokeFailures is every gRPC status a server answers with, as the client reads
// it back off the trailer.
func TestInvokeFailures(t *testing.T) {
	for _, one := range []struct {
		code    codes.Code
		message string
	}{
		{codes.NotFound, "no such feature"},
		{codes.InvalidArgument, "latitude out of range"},
		{codes.Unauthenticated, "who are you"},
		{codes.PermissionDenied, "not yours"},
		{codes.ResourceExhausted, "slow down"},
		{codes.Unimplemented, "not built yet"},
		{codes.Internal, "something gave way"},
		{codes.Unavailable, "come back later"},
	} {
		t.Run(one.code.String(), func(t *testing.T) {
			up, k := openRouteGuide(t, upstreamOptions{Behave: failWith(one.code, one.message)}, nil)

			e := k.invoke(t, getFeature, build(t, up.Files, point, nil), nil)

			code, message := e.grpcStatus(t)
			if code != fmt.Sprint(int(one.code)) {
				t.Errorf("grpc-status = %q, want %d", code, one.code)
			}
			if message != one.message {
				t.Errorf("grpc-message = %q, want %q", message, one.message)
			}
			if len(e.Messages) != 0 {
				t.Errorf("%d messages on a failure, want none", len(e.Messages))
			}
		})
	}
}

// TestInvokeFailureMessageEncoding is a status message that isn't ASCII. A gRPC-Web
// trailer block is read as Latin-1 and split on CRLF, so anything else has to be
// percent-encoded on the way out.
func TestInvokeFailureMessageEncoding(t *testing.T) {
	const message = "chybí místo: řádek 1\nsloupec 2 — 90% plné 🎭"
	up, k := openRouteGuide(t, upstreamOptions{Behave: failWith(codes.InvalidArgument, message)}, nil)

	e := k.invoke(t, getFeature, build(t, up.Files, point, nil), nil)

	if got := strings.Count(e.Trailers, "grpc-status"); got != 1 {
		t.Errorf("%d grpc-status lines, want 1: %q", got, e.Trailers)
	}
	if _, got := e.grpcStatus(t); got != message {
		t.Errorf("grpc-message = %q\nwant %q\ntrailers = %q", got, message, e.Trailers)
	}
}

// TestInvokeCredential is the app's own credential, which the browser never holds:
// it is put on the call where kaja makes it.
func TestInvokeCredential(t *testing.T) {
	for _, scheme := range []struct {
		name       string
		parameters map[string]string
		header     string
		want       string
	}{
		{"bearer", map[string]string{"auth": "bearer", "token": "abc123"}, "authorization", "Bearer abc123"},
		{"basic", map[string]string{"auth": "basic", "username": "ada", "password": "l0vel4ce"}, "authorization", "Basic YWRhOmwwdmVsNGNl"},
		{"apikey", map[string]string{"auth": "apikey", "token": "key-1"}, "x-api-key", "key-1"},
		{"apikey named", map[string]string{"auth": "apikey", "token": "key-2", "api_key_name": "X-Custom-Key"}, "x-custom-key", "key-2"},
	} {
		t.Run(scheme.name, func(t *testing.T) {
			var seen metadata.MD
			up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
				seen = c.Metadata
				return c.Send(c.New())
			}}, scheme.parameters)

			k.invoke(t, getFeature, build(t, up.Files, point, nil), nil)

			if got := seen.Get(scheme.header); len(got) == 0 || got[0] != scheme.want {
				t.Errorf("%s = %v, want %q", scheme.header, got, scheme.want)
			}
		})
	}
}

// TestInvokeCallHeaderOutranksCredential is the rule the door merges under: a header
// the call writes by hand is the more specific instruction of the two.
func TestInvokeCallHeaderOutranksCredential(t *testing.T) {
	var seen metadata.MD
	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		seen = c.Metadata
		return c.Send(c.New())
	}}, map[string]string{"auth": "bearer", "token": "the-app's"})

	k.invoke(t, getFeature, build(t, up.Files, point, nil), map[string]string{"Authorization": "Bearer the-call's"})

	if got := seen.Get("authorization"); len(got) != 1 || got[0] != "Bearer the-call's" {
		t.Errorf("authorization = %v, want only the call's own", got)
	}
}

// TestInvokeVariableExpansion is the invariant the whole variable design rests on: a
// value kaja.json does not carry is expanded where kaja holds it and redacted out of
// what the browser is told.
func TestInvokeVariableExpansion(t *testing.T) {
	const value = "s3cr3t-deep-test-token"
	t.Setenv("DEEP_TEST_TOKEN", value)

	var seen metadata.MD
	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		seen = c.Metadata
		return c.Send(c.New())
	}}, nil)

	e := k.invoke(t, getFeature, build(t, up.Files, point, nil), map[string]string{"Authorization": "Bearer ${TOKEN}"})

	if got := seen.Get("authorization"); len(got) != 1 || got[0] != "Bearer "+value {
		t.Errorf("the upstream was sent %v, want the resolved value", got)
	}
	if strings.Contains(string(e.Body), value) {
		t.Errorf("the resolved value came back to the browser: %q", e.Body)
	}
}

// TestInvokeAppHeaderNeverReachesTheServer is the reserved header's whole contract.
func TestInvokeAppHeaderNeverReachesTheServer(t *testing.T) {
	var seen metadata.MD
	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		seen = c.Metadata
		return c.Send(c.New())
	}}, nil)

	k.invoke(t, getFeature, build(t, up.Files, point, nil), nil)

	for name := range seen {
		if strings.Contains(strings.ToLower(name), "kaja") {
			t.Errorf("the upstream was sent %q", name)
		}
	}
}

// TestInvokeServerMetadata is what a server says about a call, which on this lane is
// the response's own metadata rather than a hop kaja made.
func TestInvokeServerMetadata(t *testing.T) {
	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		c.SetHeader(metadata.Pairs("x-ratelimit-remaining", "41", "x-request-id", "abc"))
		c.SetTrailer(metadata.Pairs("x-elapsed-ms", "12"))
		return c.Send(c.New())
	}}, nil)

	e := k.invoke(t, getFeature, build(t, up.Files, point, nil), nil)

	if got := e.trailer("x-elapsed-ms"); got != "12" {
		t.Errorf("the server's trailer didn't come back: %q", e.Trailers)
	}
}

// TestInvokeUnknownApp is a call naming an app that isn't open.
func TestInvokeUnknownApp(t *testing.T) {
	up, k := openRouteGuide(t, upstreamOptions{}, nil)
	k.App = "not-open"

	e := k.invoke(t, getFeature, build(t, up.Files, point, nil), nil)

	code, message := e.grpcStatus(t)
	if code == "0" {
		t.Fatalf("a call to an app that isn't open succeeded")
	}
	t.Logf("said: status %s / %s", code, message)
	if !strings.Contains(message, "not open") {
		t.Errorf("grpc-message = %q, want it to say the app isn't open", message)
	}
}

// TestInvokeUnknownMethod is a call naming a method the server hasn't got.
func TestInvokeUnknownMethod(t *testing.T) {
	up, k := openRouteGuide(t, upstreamOptions{}, nil)

	e := k.invoke(t, "routeguide.RouteGuide/NoSuchMethod", build(t, up.Files, point, nil), nil)

	code, message := e.grpcStatus(t)
	if code != fmt.Sprint(int(codes.Unimplemented)) {
		t.Errorf("grpc-status = %q, want %d (UNIMPLEMENTED)", code, codes.Unimplemented)
	}
	t.Logf("said: status %s / %s", code, message)
}

// TestInvokeServerGone is the server going away between opening the app and calling
// it, which is what a restarted upstream is.
func TestInvokeServerGone(t *testing.T) {
	up, k := openRouteGuide(t, upstreamOptions{}, nil)
	request := build(t, up.Files, point, nil)
	if e := k.invoke(t, getFeature, request, nil); e.trailer("grpc-status") != "0" {
		t.Fatalf("the first call failed: %q", e.Trailers)
	}

	up.server.Stop()
	time.Sleep(50 * time.Millisecond)

	e := k.invoke(t, getFeature, request, nil)
	code, message := e.grpcStatus(t)
	if code == "0" {
		t.Fatalf("a call to a stopped server succeeded")
	}
	t.Logf("said: status %s / %s", code, message)
}

// TestInvokeLargePayload is a response big enough to be worth framing well.
func TestInvokeLargePayload(t *testing.T) {
	const size = 2 << 20
	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		response := c.New()
		response.Set(response.Descriptor().Fields().ByName("name"), protoreflect.ValueOfString(strings.Repeat("x", size)))
		return c.Send(response)
	}}, nil)

	e := k.invoke(t, getFeature, build(t, up.Files, point, nil), nil)

	if code, message := e.grpcStatus(t); code != "0" {
		t.Fatalf("grpc-status = %q (%s)", code, message)
	}
	answered := decode(t, up.Files, feature, e.Messages[0])
	if got := len(answered.Get(answered.Descriptor().Fields().ByName("name")).String()); got != size {
		t.Errorf("name is %d bytes, want %d", got, size)
	}
}

// TestInvokeClientStreaming is the method kind this lane cannot carry. The client
// refuses it before the transport does, so what matters here is that a call arriving
// anyway is answered rather than hanging.
func TestInvokeClientStreaming(t *testing.T) {
	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		for {
			if _, err := c.Recv(); err != nil {
				break
			}
		}
		return c.Send(c.New())
	}}, nil)

	done := make(chan exchange, 1)
	go func() { done <- k.invoke(t, recordRoute, build(t, up.Files, point, nil), nil) }()

	select {
	case e := <-done:
		code, message := e.grpcStatus(t)
		t.Logf("a client-streaming method answered: status %s / %s / %d messages", code, message, len(e.Messages))
	case <-time.After(10 * time.Second):
		t.Errorf("a client-streaming call neither answered nor failed")
	}
}

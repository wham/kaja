package grpcapptest

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// TestStopCancelsTheUpstream is what Stop has to reach: the call lives as long as the
// browser's request, so a fetch that goes away takes the upstream stream with it
// rather than leaving a server writing into nothing.
func TestStopCancelsTheUpstream(t *testing.T) {
	gone := make(chan struct{})
	sending := make(chan struct{})
	var once sync.Once

	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		for {
			response := c.New()
			response.Set(response.Descriptor().Fields().ByName("name"), protoreflect.ValueOfString("still here"))
			if err := c.Send(response); err != nil {
				close(gone)
				return err
			}
			once.Do(func() { close(sending) })
			time.Sleep(5 * time.Millisecond)
		}
	}}, nil)

	encoded, err := proto.Marshal(build(t, up.Files, rectangle, nil))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodPost, "/app/"+listFeatures, bytes.NewReader(frame(0, encoded))).WithContext(ctx)
	request.Header.Set("Content-Type", "application/grpc-web+proto")
	request.Header.Set("X-Header-X-Kaja-App", k.App)

	served := make(chan struct{})
	go func() {
		k.Mux.ServeHTTP(httptest.NewRecorder(), request)
		close(served)
	}()

	select {
	case <-sending:
	case <-time.After(5 * time.Second):
		t.Fatalf("the stream never started")
	}
	cancel()

	select {
	case <-gone:
	case <-time.After(5 * time.Second):
		t.Errorf("the upstream was still being written to after the browser went away")
	}
	select {
	case <-served:
	case <-time.After(5 * time.Second):
		t.Errorf("the handler never returned")
	}
}

// TestConcurrentCalls is a script making calls at once - a perf test is the case
// that does it in the thousands - over the one connection kaja keeps per target.
func TestConcurrentCalls(t *testing.T) {
	var seen struct {
		sync.Mutex
		tokens map[string]int
	}
	seen.tokens = map[string]int{}

	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		seen.Lock()
		for _, value := range c.Metadata.Get("x-call") {
			seen.tokens[value]++
		}
		seen.Unlock()
		response := c.New()
		response.Set(response.Descriptor().Fields().ByName("name"), protoreflect.ValueOfString("ok"))
		return c.Send(response)
	}}, nil)

	const calls = 64
	var wait sync.WaitGroup
	failures := make(chan string, calls)
	for i := 0; i < calls; i++ {
		wait.Add(1)
		go func(i int) {
			defer wait.Done()
			e := k.invoke(t, getFeature, build(t, up.Files, point, map[string]any{"latitude": i}), map[string]string{"X-Call": token(i)})
			if code := e.trailer("grpc-status"); code != "0" {
				failures <- code
			}
		}(i)
	}
	wait.Wait()
	close(failures)

	for code := range failures {
		t.Errorf("a call failed with status %s", code)
	}
	seen.Lock()
	defer seen.Unlock()
	if len(seen.tokens) != calls {
		t.Errorf("the upstream saw %d distinct calls, want %d", len(seen.tokens), calls)
	}
	for value, count := range seen.tokens {
		if count != 1 {
			t.Errorf("%s arrived %d times, want once", value, count)
		}
	}
}

// TestHeadersOfOneCallStayOnIt is the other half of that: calls in flight together
// must not lend each other their headers.
func TestHeadersOfOneCallStayOnIt(t *testing.T) {
	answers := make(chan metadata.MD, 2)
	release := make(chan struct{})

	up, k := openRouteGuide(t, upstreamOptions{Behave: func(c *call) error {
		answers <- c.Metadata
		<-release
		return c.Send(c.New())
	}}, map[string]string{"auth": "bearer", "token": "the-app's"})

	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		k.invoke(t, getFeature, build(t, up.Files, point, nil), map[string]string{"X-Call": "first"})
	}()
	go func() {
		defer wait.Done()
		k.invoke(t, getFeature, build(t, up.Files, point, nil), map[string]string{"Authorization": "Bearer the-second-call's"})
	}()

	first := <-answers
	second := <-answers
	close(release)
	wait.Wait()

	for _, md := range []metadata.MD{first, second} {
		call := md.Get("x-call")
		authorization := md.Get("authorization")
		if len(call) > 0 && len(authorization) > 0 && authorization[0] != "Bearer the-app's" {
			t.Errorf("the call carrying %v was sent %v", call, authorization)
		}
		if len(call) == 0 && len(authorization) > 0 && authorization[0] != "Bearer the-second-call's" {
			t.Errorf("the call that wrote its own credential was sent %v", authorization)
		}
	}
}

func token(i int) string {
	return string(rune('a'+i/26)) + string(rune('a'+i%26))
}

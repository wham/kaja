package openapi

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/wham/kaja/v2/pkg/apps"
)

func countingSpecServer(t *testing.T, status *atomic.Int32) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var fetches atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetches.Add(1)
		if code := status.Load(); code != 0 {
			w.WriteHeader(int(code))
			return
		}
		io.WriteString(w, inspectSpec)
	}))
	t.Cleanup(srv.Close)
	return srv, &fetches
}

func TestSpecIsFetchedOnceForInspectAndOpen(t *testing.T) {
	srv, fetches := countingSpecServer(t, &atomic.Int32{})
	parameters := map[string]string{"spec_url": srv.URL, "base_url": srv.URL}

	inspectDocument(t, parameters)
	if _, err := New().Open(context.Background(), parameters, t.TempDir(), func(string) {}); err != nil {
		t.Fatalf("Open: %v", err)
	}
	parameters["security_scheme"] = "api_key"
	if _, err := New().Open(context.Background(), parameters, t.TempDir(), func(string) {}); err != nil {
		t.Fatalf("Open: %v", err)
	}

	if got := fetches.Load(); got != 1 {
		t.Errorf("fetched the document %d times, want once", got)
	}
}

func TestFreshFetchesTheSpecAgain(t *testing.T) {
	srv, fetches := countingSpecServer(t, &atomic.Int32{})
	parameters := map[string]string{"spec_url": srv.URL, "base_url": srv.URL}

	inspectDocument(t, parameters)
	if _, err := New().Open(apps.WithFresh(context.Background()), parameters, t.TempDir(), func(string) {}); err != nil {
		t.Fatalf("Open: %v", err)
	}

	if got := fetches.Load(); got != 2 {
		t.Errorf("fetched the document %d times, want twice", got)
	}
}

func TestSpecIsKeptPerCredential(t *testing.T) {
	srv, fetches := countingSpecServer(t, &atomic.Int32{})

	inspectDocument(t, map[string]string{"spec_url": srv.URL, "token": "one"})
	inspectDocument(t, map[string]string{"spec_url": srv.URL, "token": "two"})

	if got := fetches.Load(); got != 2 {
		t.Errorf("fetched the document %d times, want once per token", got)
	}
}

func TestFailedSpecFetchIsNotKept(t *testing.T) {
	status := &atomic.Int32{}
	status.Store(http.StatusServiceUnavailable)
	srv, fetches := countingSpecServer(t, status)
	parameters := map[string]string{"spec_url": srv.URL}

	if _, problem := Inspect(context.Background(), parameters, func(string) {}); problem == nil {
		t.Fatal("expected the failed fetch to be reported")
	}
	status.Store(0)
	inspectDocument(t, parameters)

	if got := fetches.Load(); got != 2 {
		t.Errorf("fetched the document %d times, want the failure asked again", got)
	}
}

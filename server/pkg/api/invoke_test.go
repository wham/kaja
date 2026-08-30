package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"maps"
	"os"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
)

func invokeService(t *testing.T) *ApiService {
	t.Helper()
	path := t.TempDir() + "/kaja.json"
	if err := os.WriteFile(path, []byte(`{"variables":{"TOKEN":"secret"}}`), 0o600); err != nil {
		t.Fatalf("failed to write configuration: %v", err)
	}
	return NewApiService(path, false, "abc123", "", nil)
}

// collect invokes a method and drains the stream it answers with, which for a unary
// method is one message.
func collect(service *ApiService, methodPath string, request []byte) ([][]byte, error) {
	stream, err := service.Invoke(context.Background(), methodPath, request, nil)
	if err != nil {
		return nil, err
	}
	var messages [][]byte
	for {
		message, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return messages, nil
		}
		if err != nil {
			return messages, err
		}
		messages = append(messages, message)
	}
}

// The gRPC path is what a caller asks for, and the desktop's binding hands over the
// method alone; both name the same method.
func TestInvoke(t *testing.T) {
	service := invokeService(t)

	for _, methodPath := range []string{"Api/GetConfiguration", "GetConfiguration"} {
		messages, err := collect(service, methodPath, nil)
		if err != nil {
			t.Fatalf("%s: %v", methodPath, err)
		}
		if len(messages) != 1 {
			t.Fatalf("%s: %d messages, want one", methodPath, len(messages))
		}
		response := &GetConfigurationResponse{}
		if err := proto.Unmarshal(messages[0], response); err != nil {
			t.Fatalf("%s: %v", methodPath, err)
		}
		if response.Runtime.GetGitRef() != "abc123" {
			t.Errorf("%s: git ref %q", methodPath, response.Runtime.GetGitRef())
		}
	}
}

func TestInvokeDecodesTheRequest(t *testing.T) {
	service := invokeService(t)

	request, err := proto.Marshal(&UpdateConfigurationRequest{Configuration: &Configuration{}})
	if err != nil {
		t.Fatal(err)
	}
	// This service was opened read-only, so the method refuses - which it can only do
	// having read the request it was handed.
	if _, err := collect(service, "Api/UpdateConfiguration", request); err == nil {
		t.Fatal("expected the read-only configuration to be refused")
	}
}

func TestInvokeUnknownMethod(t *testing.T) {
	_, err := collect(invokeService(t), "Api/Nope", nil)
	if err == nil || !strings.Contains(err.Error(), "Api/Nope") {
		t.Fatalf("error %v", err)
	}
}

// A server-streaming method reaches the same door and writes as many messages as it
// has: a compilation's log, then its verdict.
func TestInvokeServerStreaming(t *testing.T) {
	request, err := proto.Marshal(&CompileRequest{ProtoDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}

	messages, err := collect(invokeService(t), "Api/Compile", request)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) < 2 {
		t.Fatalf("%d messages, want the log and a verdict", len(messages))
	}

	last := &CompileResponse{}
	if err := proto.Unmarshal(messages[len(messages)-1], last); err != nil {
		t.Fatal(err)
	}
	// An empty directory holds no protos, so the compilation fails - and says so as
	// the last message rather than as an error on the call.
	if last.Status != CompileStatus_STATUS_ERROR {
		t.Errorf("status %v, want an error", last.Status)
	}
	for _, message := range messages[:len(messages)-1] {
		response := &CompileResponse{}
		if err := proto.Unmarshal(message, response); err != nil {
			t.Fatal(err)
		}
		if response.Status != CompileStatus_STATUS_RUNNING || len(response.Logs) != 1 {
			t.Errorf("running message %v", response)
		}
	}
}

// A stream nobody is reading any more ends rather than parking its handler on a send
// forever: the browser's request is what the call lives as long as.
func TestInvokeServerStreamingEndsWhenTheCallerGoesAway(t *testing.T) {
	request, err := proto.Marshal(&CompileRequest{ProtoDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	stream, err := invokeService(t).Invoke(ctx, "Api/Compile", request, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Recv(); err != nil {
		t.Fatal(err)
	}
	cancel()

	drained := make(chan error, 1)
	go func() {
		for {
			if _, err := stream.Recv(); err != nil {
				drained <- err
				return
			}
		}
	}()

	select {
	case err := <-drained:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("ended with %v, want the cancellation", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the stream never ended")
	}
}

// The one door writes one line about every call it carried, and what makes that line
// safe to keep is that it names the headers a ${NAME} resolved in rather than saying
// what any of them resolved to: the whole reason expansion happens in Go is that the
// value is not the browser's to read, and a log file is no better a place for it.
func TestInvokeAppLogsTheCallWithoutItsValues(t *testing.T) {
	t.Setenv("KAJA_TOKEN", "s3cr3t-token-value")
	path := t.TempDir() + "/kaja.json"
	if err := os.WriteFile(path, []byte(`{"variables":{"TOKEN":"${secret}"}}`), 0o600); err != nil {
		t.Fatalf("failed to write configuration: %v", err)
	}
	service := NewApiService(path, false, "", "", nil)
	headers := map[string]string{"X-Kaja-App": "quirks", "Authorization": "Bearer ${TOKEN}"}

	written := atLevel(t, slog.LevelDebug, func() {
		// No app is open under that name, so the call fails at the door - which is
		// still a call the door carried, and still a line.
		if _, err := service.InvokeApp(context.Background(), "quirks.v1.Quirks/Sum", nil, maps.Clone(headers)); err == nil {
			t.Fatal("expected a call to an app that is not open to be refused")
		}
	})

	for _, want := range []string{"quirks.v1.Quirks/Sum", `"app":"quirks"`, "Authorization", "durationMs"} {
		if !strings.Contains(written, want) {
			t.Errorf("the line says nothing of %s: %s", want, written)
		}
	}
	if strings.Contains(written, "s3cr3t-token-value") {
		t.Errorf("the resolved value reached the log: %s", written)
	}

	// And nothing at all when nobody asked, which is what makes it free to leave in.
	if quiet := atLevel(t, slog.LevelInfo, func() {
		service.InvokeApp(context.Background(), "quirks.v1.Quirks/Sum", nil, maps.Clone(headers))
	}); strings.Contains(quiet, "App call") {
		t.Errorf("the line was written at a level nobody asked for: %s", quiet)
	}
}

// atLevel runs act with the default logger replaced by one writing JSON at level, and
// hands back what it wrote.
func atLevel(t *testing.T, level slog.Level, act func()) string {
	t.Helper()
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })

	var written strings.Builder
	slog.SetDefault(slog.New(slog.NewJSONHandler(&written, &slog.HandlerOptions{Level: level})))
	act()
	return written.String()
}

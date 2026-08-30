package api

import (
	"context"
	"errors"
	"io"
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

package api

import (
	"context"
	"os"
	"strings"
	"testing"

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

// The gRPC path is what a caller asks for, and the desktop's binding hands over the
// method alone; both name the same method.
func TestInvoke(t *testing.T) {
	service := invokeService(t)

	for _, methodPath := range []string{"Api/GetConfiguration", "GetConfiguration"} {
		message, err := service.Invoke(context.Background(), methodPath, nil)
		if err != nil {
			t.Fatalf("%s: %v", methodPath, err)
		}
		response := &GetConfigurationResponse{}
		if err := proto.Unmarshal(message, response); err != nil {
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
	if _, err := service.Invoke(context.Background(), "Api/UpdateConfiguration", request); err == nil {
		t.Fatal("expected the read-only configuration to be refused")
	}
}

func TestInvokeUnknownMethod(t *testing.T) {
	_, err := invokeService(t).Invoke(context.Background(), "Api/Nope", nil)
	if err == nil || !strings.Contains(err.Error(), "Api/Nope") {
		t.Fatalf("error %v", err)
	}
}

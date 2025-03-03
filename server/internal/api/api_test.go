package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
)

func TestGetConfiguration_Success(t *testing.T) {
	// Create a temporary directory for test files
	tmpDir, err := os.MkdirTemp("", "kaja-test-*")
	if err != nil {
		t.Fatal("failed to create temp dir:", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test configuration file
	configPath := filepath.Join(tmpDir, "kaja.json")
	config := &Configuration{
		Projects: []*ConfigurationProject{
			{
				Name:      "test-project",
				Protocol:  RpcProtocol_RPC_PROTOCOL_GRPC,
				Url:       "http://localhost:41521",
				Workspace: "proto",
			},
		},
	}

	data, err := protojson.Marshal(config)
	if err != nil {
		t.Fatal("failed to marshal config:", err)
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		t.Fatal("failed to write config file:", err)
	}

	// Create service and make request
	service := NewApiService(configPath)
	resp, err := service.GetConfiguration(context.Background(), &GetConfigurationRequest{})

	// Validate response
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil {
		t.Fatal("expected non-nil response")
	}
	if resp.Configuration == nil {
		t.Fatal("expected non-nil configuration")
	}
	if len(resp.Configuration.Projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(resp.Configuration.Projects))
	}

	project := resp.Configuration.Projects[0]
	if project.Name != "test-project" {
		t.Errorf("expected project name 'test-project', got %q", project.Name)
	}
	if project.Protocol != RpcProtocol_RPC_PROTOCOL_GRPC {
		t.Errorf("expected protocol GRPC, got %v", project.Protocol)
	}
	if project.Url != "http://localhost:41521" {
		t.Errorf("expected URL 'http://localhost:41521', got %q", project.Url)
	}
	if project.Workspace != "proto" {
		t.Errorf("expected workspace 'proto', got %q", project.Workspace)
	}
}

func TestGetConfiguration_FileNotFound(t *testing.T) {
	// Use a non-existent file path
	service := NewApiService("/nonexistent/path/kaja.json")
	resp, err := service.GetConfiguration(context.Background(), &GetConfigurationRequest{})

	if err == nil {
		t.Error("expected an error but got nil")
	}
	if resp != nil {
		t.Error("expected nil response when error occurs")
	}
}

func TestGetConfiguration_InvalidJSON(t *testing.T) {
	// Create a temporary directory for test files
	tmpDir, err := os.MkdirTemp("", "kaja-test-*")
	if err != nil {
		t.Fatal("failed to create temp dir:", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create invalid JSON file
	configPath := filepath.Join(tmpDir, "kaja.json")
	if err := os.WriteFile(configPath, []byte("invalid json"), 0644); err != nil {
		t.Fatal("failed to write invalid config file:", err)
	}

	// Create service and make request
	service := NewApiService(configPath)
	resp, err := service.GetConfiguration(context.Background(), &GetConfigurationRequest{})

	if err == nil {
		t.Error("expected an error but got nil")
	}
	if resp != nil {
		t.Error("expected nil response when error occurs")
	}
}

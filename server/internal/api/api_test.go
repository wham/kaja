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

func TestGetConfiguration_EmptyConfig(t *testing.T) {
	// Use non-existent path to test empty config
	service := NewApiService("/nonexistent/path/kaja.json")
	resp, err := service.GetConfiguration(context.Background(), &GetConfigurationRequest{})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil {
		t.Fatal("expected non-nil response")
	}
	if resp.Configuration == nil {
		t.Fatal("expected non-nil configuration")
	}
	if len(resp.Configuration.Projects) != 0 {
		t.Errorf("expected 0 projects, got %d", len(resp.Configuration.Projects))
	}
}

func TestGetConfiguration_WithBaseURL(t *testing.T) {
	// Set BASE_URL environment variable
	const testURL = "http://test-url:8080"
	os.Setenv("BASE_URL", testURL)
	defer os.Unsetenv("BASE_URL")

	service := NewApiService("/nonexistent/path/kaja.json")
	resp, err := service.GetConfiguration(context.Background(), &GetConfigurationRequest{})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil || resp.Configuration == nil {
		t.Fatal("expected non-nil response and configuration")
	}
	if len(resp.Configuration.Projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(resp.Configuration.Projects))
	}

	project := resp.Configuration.Projects[0]
	if project.Name != "default" {
		t.Errorf("expected project name 'default', got %q", project.Name)
	}
	if project.Protocol != RpcProtocol_RPC_PROTOCOL_GRPC {
		t.Errorf("expected protocol GRPC, got %v", project.Protocol)
	}
	if project.Url != testURL {
		t.Errorf("expected URL %q, got %q", testURL, project.Url)
	}
	if project.Workspace != "proto" {
		t.Errorf("expected workspace 'proto', got %q", project.Workspace)
	}
}

func TestGetConfiguration_WithFileAndBaseURL(t *testing.T) {
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

	// Set BASE_URL environment variable
	const testURL = "http://test-url:8080"
	os.Setenv("BASE_URL", testURL)
	defer os.Unsetenv("BASE_URL")

	// Create service and make request
	service := NewApiService(configPath)
	resp, err := service.GetConfiguration(context.Background(), &GetConfigurationRequest{})

	// Validate response
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil || resp.Configuration == nil {
		t.Fatal("expected non-nil response and configuration")
	}
	if len(resp.Configuration.Projects) != 2 {
		t.Fatalf("expected 2 projects, got %d", len(resp.Configuration.Projects))
	}

	// Check default project (should be first)
	defaultProject := resp.Configuration.Projects[0]
	if defaultProject.Name != "default" {
		t.Errorf("expected first project name 'default', got %q", defaultProject.Name)
	}
	if defaultProject.Url != testURL {
		t.Errorf("expected first project URL %q, got %q", testURL, defaultProject.Url)
	}

	// Check file-based project (should be second)
	fileProject := resp.Configuration.Projects[1]
	if fileProject.Name != "test-project" {
		t.Errorf("expected second project name 'test-project', got %q", fileProject.Name)
	}
	if fileProject.Url != "http://localhost:41521" {
		t.Errorf("expected second project URL 'http://localhost:41521', got %q", fileProject.Url)
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

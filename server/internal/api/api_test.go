package api

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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

func TestGetConfiguration_WithBaseURL_DefaultProtocol(t *testing.T) {
	// Set BASE_URL environment variable, no RPC_PROTOCOL (should default to TWIRP)
	// This should override any config file settings
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
		t.Fatalf("expected exactly 1 project (from BASE_URL), got %d", len(resp.Configuration.Projects))
	}

	project := resp.Configuration.Projects[0]
	if project.Name != "default" {
		t.Errorf("expected project name 'default', got %q", project.Name)
	}
	if project.Protocol != RpcProtocol_RPC_PROTOCOL_TWIRP {
		t.Errorf("expected protocol TWIRP (default), got %v", project.Protocol)
	}
	if project.Url != testURL {
		t.Errorf("expected URL %q, got %q", testURL, project.Url)
	}
	if project.Workspace != "" {
		t.Errorf("expected empty workspace, got %q", project.Workspace)
	}
}

func TestGetConfiguration_WithBaseURL_GRPCProtocol(t *testing.T) {
	// Set both BASE_URL and RPC_PROTOCOL environment variables
	// This should override any config file settings
	const testURL = "http://test-url:8080"
	os.Setenv("BASE_URL", testURL)
	os.Setenv("RPC_PROTOCOL", "RPC_PROTOCOL_GRPC")
	defer func() {
		os.Unsetenv("BASE_URL")
		os.Unsetenv("RPC_PROTOCOL")
	}()

	service := NewApiService("/nonexistent/path/kaja.json")
	resp, err := service.GetConfiguration(context.Background(), &GetConfigurationRequest{})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil || resp.Configuration == nil {
		t.Fatal("expected non-nil response and configuration")
	}
	if len(resp.Configuration.Projects) != 1 {
		t.Fatalf("expected exactly 1 project (from BASE_URL), got %d", len(resp.Configuration.Projects))
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
	if project.Workspace != "" {
		t.Errorf("expected empty workspace, got %q", project.Workspace)
	}
}

func TestGetConfiguration_BaseURLOverridesConfigFile(t *testing.T) {
	// Create a temporary directory for test files
	tmpDir, err := os.MkdirTemp("", "kaja-test-*")
	if err != nil {
		t.Fatal("failed to create temp dir:", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test configuration file that should be ignored when BASE_URL is set
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

	// Set BASE_URL and RPC_PROTOCOL environment variables
	// This should completely override the config file
	const testURL = "http://test-url:8080"
	os.Setenv("BASE_URL", testURL)
	os.Setenv("RPC_PROTOCOL", "RPC_PROTOCOL_TWIRP")
	defer func() {
		os.Unsetenv("BASE_URL")
		os.Unsetenv("RPC_PROTOCOL")
	}()

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
	// Should only have the environment-based project, config file projects should be ignored
	if len(resp.Configuration.Projects) != 1 {
		t.Fatalf("expected exactly 1 project (from BASE_URL), got %d", len(resp.Configuration.Projects))
	}

	// Check that we got the environment-based project
	project := resp.Configuration.Projects[0]
	if project.Name != "default" {
		t.Errorf("expected project name 'default', got %q", project.Name)
	}
	if project.Protocol != RpcProtocol_RPC_PROTOCOL_TWIRP {
		t.Errorf("expected protocol TWIRP, got %v", project.Protocol)
	}
	if project.Url != testURL {
		t.Errorf("expected URL %q, got %q", testURL, project.Url)
	}
	if project.Workspace != "" {
		t.Errorf("expected empty workspace, got %q", project.Workspace)
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

	// Should not return error, but instead return empty config
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if resp == nil {
		t.Fatal("expected non-nil response")
	}
	if resp.Configuration == nil {
		t.Fatal("expected non-nil configuration")
	}
	if len(resp.Configuration.Projects) != 0 {
		t.Errorf("expected empty projects list for invalid JSON, got %d projects", len(resp.Configuration.Projects))
	}

	// Should have logged an error about invalid JSON
	foundError := false
	for _, log := range resp.Logs {
		if log.Level == LogLevel_LEVEL_ERROR && strings.Contains(log.Message, "Failed to unmarshal") {
			foundError = true
			break
		}
	}
	if !foundError {
		t.Error("expected to find error log about unmarshal failure")
	}
}

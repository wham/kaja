package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestGetConfiguration_RedactsAIApiKey(t *testing.T) {
	// Create a temp directory and configuration file
	tmpDir := t.TempDir()
	configurationPath := filepath.Join(tmpDir, "kaja.json")

	configContent := `{
		"ai": {
			"baseUrl": "http://ai-service:8080",
			"apiKey": "secret-key"
		},
		"projects": [
			{
				"name": "test-project",
				"protocol": "RPC_PROTOCOL_GRPC",
				"url": "http://localhost:8080",
				"workspace": "test-workspace"
			}
		]
	}`
	if err := os.WriteFile(configurationPath, []byte(configContent), 0644); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(configurationPath, false)

	resp, err := service.GetConfiguration(context.Background(), &GetConfigurationRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp.Configuration.Ai.ApiKey != "*****" {
		t.Errorf("expected AI API key to be redacted to '*****', got %q", resp.Configuration.Ai.ApiKey)
	}
}

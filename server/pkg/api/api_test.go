package api

import (
	"context"
	"testing"
)

func TestGetConfiguration_RedactsAIApiKey(t *testing.T) {
	config := &Configuration{
		Ai: &ConfigurationAI{
			BaseUrl: "http://ai-service:8080",
			ApiKey:  "secret-key",
		},
		Projects: []*ConfigurationProject{
			{
				Name:      "test-project",
				Protocol:  RpcProtocol_RPC_PROTOCOL_GRPC,
				Url:       "http://localhost:8080",
				Workspace: "test-workspace",
			},
		},
	}

	service := NewApiService(&GetConfigurationResponse{
		Configuration: config,
		Logs:          []*Log{},
	}, "")

	resp, err := service.GetConfiguration(context.Background(), &GetConfigurationRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp.Configuration.Ai.ApiKey != "*****" {
		t.Errorf("expected AI API key to be redacted to '*****', got %q", resp.Configuration.Ai.ApiKey)
	}
}

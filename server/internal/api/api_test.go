package api

import (
	"context"
	"testing"
)

func TestGetConfiguration_RedactsGithubToken(t *testing.T) {
	config := &Configuration{
		GithubToken: "secret-token",
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
	})

	resp, err := service.GetConfiguration(context.Background(), &GetConfigurationRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp.Configuration.GithubToken != "*****" {
		t.Errorf("expected github token to be redacted to '*****', got %q", resp.Configuration.GithubToken)
	}
}

package api

import (
	"os"
	"testing"
)

func TestLoadGetConfigurationResponse_ConfigFileNotExists(t *testing.T) {
	getConfigurationResponse := LoadGetConfigurationResponse("non_existent_config.json")

	if getConfigurationResponse == nil {
		t.Fatal("expected non-nil response")
	}

	if getConfigurationResponse.Configuration == nil {
		t.Fatal("expected non-nil configuration")
	}

	if len(getConfigurationResponse.Configuration.Projects) != 0 {
		t.Errorf("expected empty projects list, got %d projects", len(getConfigurationResponse.Configuration.Projects))
	}

	foundInfo := false
	for _, log := range getConfigurationResponse.Logs {
		if log.Level == LogLevel_LEVEL_INFO && log.Message == "Configuration file non_existent_config.json not found. Only environment variables will be used." {
			foundInfo = true
			break
		}
	}
	if !foundInfo {
		t.Error("expected to find info log about missing config file")
	}
}

func TestLoadGetConfigurationResponse_MultipleProjectsScenario(t *testing.T) {
	configContent := `{
		"projects": [
			{
				"name": "test-project",
				"protocol": "RPC_PROTOCOL_GRPC",
				"url": "http://localhost:8080",
				"workspace": "test-workspace"
			}
		],
		"pathPrefix": "test-prefix",
		"githubToken": "test-token"
	}`

	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(configContent)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	getConfigurationResponse := LoadGetConfigurationResponse(tmpfile.Name())

	if getConfigurationResponse == nil {
		t.Fatal("expected non-nil response")
	}

	if getConfigurationResponse.Configuration == nil {
		t.Fatal("expected non-nil configuration")
	}

	if len(getConfigurationResponse.Configuration.Projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(getConfigurationResponse.Configuration.Projects))
	}

	project := getConfigurationResponse.Configuration.Projects[0]
	if project.Name != "test-project" {
		t.Errorf("expected project name 'test-project', got %q", project.Name)
	}
	if project.Protocol != RpcProtocol_RPC_PROTOCOL_GRPC {
		t.Errorf("expected protocol GRPC, got %v", project.Protocol)
	}
	if project.Url != "http://localhost:8080" {
		t.Errorf("expected URL 'http://localhost:8080', got %q", project.Url)
	}
	if project.Workspace != "test-workspace" {
		t.Errorf("expected workspace 'test-workspace', got %q", project.Workspace)
	}

	if getConfigurationResponse.Configuration.PathPrefix != "/test-prefix" {
		t.Errorf("expected path prefix '/test-prefix', got %q", getConfigurationResponse.Configuration.PathPrefix)
	}

	if getConfigurationResponse.Configuration.GithubToken != "test-token" {
		t.Errorf("expected github token 'test-token', got %q", getConfigurationResponse.Configuration.GithubToken)
	}
}

func TestLoadGetConfigurationResponse_GithubTokenOverride(t *testing.T) {
	configContent := `{
		"projects": [],
		"githubToken": "file-token"
	}`

	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(configContent)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	const envToken = "env-token"
	os.Setenv("GITHUB_TOKEN", envToken)
	defer os.Unsetenv("GITHUB_TOKEN")

	getConfigurationResponse := LoadGetConfigurationResponse(tmpfile.Name())

	if getConfigurationResponse == nil {
		t.Fatal("expected non-nil response")
	}

	if getConfigurationResponse.Configuration == nil {
		t.Fatal("expected non-nil configuration")
	}

	if getConfigurationResponse.Configuration.GithubToken != envToken {
		t.Errorf("expected github token from environment %q, got %q", envToken, getConfigurationResponse.Configuration.GithubToken)
	}

	foundInfo := false
	for _, log := range getConfigurationResponse.Logs {
		if log.Level == LogLevel_LEVEL_INFO && log.Message == "GITHUB_TOKEN env variable applied" {
			foundInfo = true
			break
		}
	}
	if !foundInfo {
		t.Error("expected to find info log about GITHUB_TOKEN environment variable")
	}
}

func TestLoadGetConfigurationResponse_PathPrefixNormalization(t *testing.T) {
	configContent := `{
		"projects": [],
		"pathPrefix": "demo"
	}`

	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(configContent)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	getConfigurationResponse := LoadGetConfigurationResponse(tmpfile.Name())

	if getConfigurationResponse == nil {
		t.Fatal("expected non-nil response")
	}

	if getConfigurationResponse.Configuration == nil {
		t.Fatal("expected non-nil configuration")
	}

	if getConfigurationResponse.Configuration.PathPrefix != "/demo" {
		t.Errorf("expected normalized path prefix '/demo', got %q", getConfigurationResponse.Configuration.PathPrefix)
	}

	foundDebug := false
	for _, log := range getConfigurationResponse.Logs {
		if log.Level == LogLevel_LEVEL_DEBUG && log.Message == "pathPrefix normalized from \"/demo\" to \"/demo\"" {
			foundDebug = true
			break
		}
	}
	if !foundDebug {
		t.Error("expected to find debug log about path prefix normalization")
	}
}

func TestLoadGetConfigurationResponse_DefaultProjectFromBaseURL(t *testing.T) {
	const testURL = "http://test-url:8080"
	os.Setenv("BASE_URL", testURL)
	os.Setenv("RPC_PROTOCOL", "RPC_PROTOCOL_GRPC")
	defer func() {
		os.Unsetenv("BASE_URL")
		os.Unsetenv("RPC_PROTOCOL")
	}()

	getConfigurationResponse := LoadGetConfigurationResponse("non_existent_config.json")

	if getConfigurationResponse == nil {
		t.Fatal("expected non-nil response")
	}

	if getConfigurationResponse.Configuration == nil {
		t.Fatal("expected non-nil configuration")
	}

	if len(getConfigurationResponse.Configuration.Projects) != 1 {
		t.Fatalf("expected exactly 1 project (from BASE_URL), got %d", len(getConfigurationResponse.Configuration.Projects))
	}

	project := getConfigurationResponse.Configuration.Projects[0]
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

	foundInfo := false
	for _, log := range getConfigurationResponse.Logs {
		if log.Level == LogLevel_LEVEL_INFO && log.Message == "BASE_URL is set, configuring default project from environment variables" {
			foundInfo = true
			break
		}
	}
	if !foundInfo {
		t.Error("expected to find info log about BASE_URL configuration")
	}
}

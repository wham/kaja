package api

import (
	"context"
	"os"
	"testing"
)

func TestLoadGetConfigurationResponse_ConfigFileNotExists(t *testing.T) {
	getConfigurationResponse := LoadGetConfigurationResponse("non_existent_config.json", false)

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
		if log.Level == LogLevel_LEVEL_INFO && log.Message == "Configuration file non_existent_config.json not found." {
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
				"protoDir": "test-protoDir"
			}
		],
		"pathPrefix": "test-prefix"
	}`

	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(configContent)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	getConfigurationResponse := LoadGetConfigurationResponse(tmpfile.Name(), false)

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
	if project.ProtoDir != "test-protoDir" {
		t.Errorf("expected protoDir 'test-protoDir', got %q", project.ProtoDir)
	}

	if getConfigurationResponse.Configuration.PathPrefix != "/test-prefix" {
		t.Errorf("expected path prefix '/test-prefix', got %q", getConfigurationResponse.Configuration.PathPrefix)
	}
}

func TestUpdateConfiguration_DeniedWhenNotAllowed(t *testing.T) {
	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte("{}")); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(tmpfile.Name(), false, "")

	_, err = service.UpdateConfiguration(context.Background(), &UpdateConfigurationRequest{
		Configuration: &Configuration{},
	})
	if err == nil {
		t.Fatal("expected error when canUpdateConfiguration is false")
	}

	// The file must be left untouched.
	content, readErr := os.ReadFile(tmpfile.Name())
	if readErr != nil {
		t.Fatalf("failed to read config file: %v", readErr)
	}
	if string(content) != "{}" {
		t.Errorf("expected config file to be unchanged, got %q", string(content))
	}
}

func TestUpdateConfiguration_AllowedWhenEnabled(t *testing.T) {
	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte("{}")); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(tmpfile.Name(), true, "")

	_, err = service.UpdateConfiguration(context.Background(), &UpdateConfigurationRequest{
		Configuration: &Configuration{
			Projects: []*ConfigurationProject{
				{Name: "test-project", Protocol: RpcProtocol_RPC_PROTOCOL_GRPC, Url: "http://localhost:8080"},
			},
		},
	})
	if err != nil {
		t.Fatalf("expected no error when canUpdateConfiguration is true, got %v", err)
	}

	getConfigurationResponse := LoadGetConfigurationResponse(tmpfile.Name(), true)
	if len(getConfigurationResponse.Configuration.Projects) != 1 {
		t.Fatalf("expected 1 saved project, got %d", len(getConfigurationResponse.Configuration.Projects))
	}
}

func TestUpdateConfiguration_AllowedByFileOverride(t *testing.T) {
	// Web/dev server constructs the service with canUpdateConfiguration=false, but
	// the file-based dev override (system.canUpdateConfiguration) must still enable
	// updates - the same effective flag GetConfiguration reports to the UI.
	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte(`{"system":{"canUpdateConfiguration":true}}`)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(tmpfile.Name(), false, "")

	_, err = service.UpdateConfiguration(context.Background(), &UpdateConfigurationRequest{
		Configuration: &Configuration{
			Projects: []*ConfigurationProject{
				{Name: "test-project", Protocol: RpcProtocol_RPC_PROTOCOL_GRPC, Url: "http://localhost:8080"},
			},
		},
	})
	if err != nil {
		t.Fatalf("expected no error when file override enables updates, got %v", err)
	}

	getConfigurationResponse := LoadGetConfigurationResponse(tmpfile.Name(), false)
	if len(getConfigurationResponse.Configuration.Projects) != 1 {
		t.Fatalf("expected 1 saved project, got %d", len(getConfigurationResponse.Configuration.Projects))
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

	getConfigurationResponse := LoadGetConfigurationResponse(tmpfile.Name(), false)

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

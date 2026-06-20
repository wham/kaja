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

	if len(getConfigurationResponse.Configuration.Apps) != 0 {
		t.Errorf("expected empty apps list, got %d apps", len(getConfigurationResponse.Configuration.Apps))
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

func TestLoadGetConfigurationResponse_AppsScenario(t *testing.T) {
	configContent := `{
		"apps": [
			{
				"name": "test-app",
				"grpc": {
					"url": "http://localhost:8080",
					"proto_dir": "test-protoDir"
				}
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

	if len(getConfigurationResponse.Configuration.Apps) != 1 {
		t.Fatalf("expected 1 app, got %d", len(getConfigurationResponse.Configuration.Apps))
	}

	app := getConfigurationResponse.Configuration.Apps[0]
	appType, params := flattenApp(app)
	if app.Name != "test-app" {
		t.Errorf("expected app name 'test-app', got %q", app.Name)
	}
	if appType != "grpc" {
		t.Errorf("expected type 'grpc', got %q", appType)
	}
	if params["url"] != "http://localhost:8080" {
		t.Errorf("expected url 'http://localhost:8080', got %q", params["url"])
	}
	if params["proto_dir"] != "test-protoDir" {
		t.Errorf("expected proto_dir 'test-protoDir', got %q", params["proto_dir"])
	}

	if getConfigurationResponse.Configuration.PathPrefix != "/test-prefix" {
		t.Errorf("expected path prefix '/test-prefix', got %q", getConfigurationResponse.Configuration.PathPrefix)
	}
}

// Legacy kaja.json files used a top-level "projects" list of gRPC/Twirp services.
// They must be migrated transparently into the unified "apps" model on load.
func TestLoadGetConfigurationResponse_MigratesLegacyProjects(t *testing.T) {
	configContent := `{
		"projects": [
			{
				"name": "grpc-quirks",
				"protocol": "RPC_PROTOCOL_GRPC",
				"url": "dns:kaja.tools:443",
				"protoDir": "quirks/proto",
				"headers": {"X-Yolo": "kaja123"}
			},
			{
				"name": "twirp-users",
				"protocol": "RPC_PROTOCOL_TWIRP",
				"url": "https://kaja.tools/users",
				"protoDir": "users/proto"
			},
			{
				"name": "teams",
				"protocol": "RPC_PROTOCOL_GRPC",
				"url": "dns:kaja.tools:443",
				"useReflection": true
			}
		]
	}`

	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte(configContent)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	configuration := LoadGetConfigurationResponse(tmpfile.Name(), false).Configuration
	if len(configuration.Apps) != 3 {
		t.Fatalf("expected 3 migrated apps, got %d", len(configuration.Apps))
	}

	grpc := configuration.Apps[0]
	grpcType, grpcParams := flattenApp(grpc)
	if grpc.Name != "grpc-quirks" || grpcType != "grpc" {
		t.Errorf("expected grpc app 'grpc-quirks', got %q/%q", grpc.Name, grpcType)
	}
	if grpcParams["url"] != "dns:kaja.tools:443" || grpcParams["proto_dir"] != "quirks/proto" {
		t.Errorf("unexpected grpc parameters: %v", grpcParams)
	}
	if grpc.GetGrpc().GetHeaders()["X-Yolo"] != "kaja123" {
		t.Errorf("expected migrated headers, got %v", grpc.GetGrpc().GetHeaders())
	}

	twirpType, twirpParams := flattenApp(configuration.Apps[1])
	if twirpType != "twirp" || twirpParams["url"] != "https://kaja.tools/users" {
		t.Errorf("unexpected twirp app: %q %v", twirpType, twirpParams)
	}

	teamsType, teamsParams := flattenApp(configuration.Apps[2])
	if teamsType != "grpc" || teamsParams["reflection"] != "true" {
		t.Errorf("expected reflection grpc app, got %q %v", teamsType, teamsParams)
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

	service := NewApiService(tmpfile.Name(), false, "", "")

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

	service := NewApiService(tmpfile.Name(), true, "", "")

	_, err = service.UpdateConfiguration(context.Background(), &UpdateConfigurationRequest{
		Configuration: &Configuration{
			Apps: []*ConfigurationApp{
				{Name: "test-app", App: &ConfigurationApp_Grpc{Grpc: &GrpcApp{Url: "http://localhost:8080"}}},
			},
		},
	})
	if err != nil {
		t.Fatalf("expected no error when canUpdateConfiguration is true, got %v", err)
	}

	getConfigurationResponse := LoadGetConfigurationResponse(tmpfile.Name(), true)
	if len(getConfigurationResponse.Configuration.Apps) != 1 {
		t.Fatalf("expected 1 saved app, got %d", len(getConfigurationResponse.Configuration.Apps))
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

	service := NewApiService(tmpfile.Name(), false, "", "")

	_, err = service.UpdateConfiguration(context.Background(), &UpdateConfigurationRequest{
		Configuration: &Configuration{
			Apps: []*ConfigurationApp{
				{Name: "test-app", App: &ConfigurationApp_Grpc{Grpc: &GrpcApp{Url: "http://localhost:8080"}}},
			},
		},
	})
	if err != nil {
		t.Fatalf("expected no error when file override enables updates, got %v", err)
	}

	getConfigurationResponse := LoadGetConfigurationResponse(tmpfile.Name(), false)
	if len(getConfigurationResponse.Configuration.Apps) != 1 {
		t.Fatalf("expected 1 saved app, got %d", len(getConfigurationResponse.Configuration.Apps))
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

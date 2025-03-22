package api

import (
	"fmt"
	protojson "google.golang.org/protobuf/encoding/protojson"
	"io"
	"os"
	"strings"
)

func LoadGetConfigurationResponse(configPath string) *GetConfigurationResponse {
	logger := NewLogger()
	config := loadConfigurationFile(configPath, logger)

	applyEnvironmentVariables(config, logger)

	return &GetConfigurationResponse{Configuration: config, Logs: logger.logs}
}

func loadConfigurationFile(configPath string, logger *Logger) *Configuration {
	config := &Configuration{
		Projects: []*ConfigurationProject{},
	}

	logger.debug(fmt.Sprintf("Trying to load configuration from file %s", configPath))
	file, err := os.Open(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			logger.info(fmt.Sprintf("Configuration file %s not found. Only environment variables will be used.", configPath))
		} else {
			logger.error(fmt.Sprintf("Failed opening configuration file %s", configPath), err)
		}
		return config
	}
	defer file.Close()

	fileContent, err := io.ReadAll(file)
	if err != nil {
		logger.error(fmt.Sprintf("Failed to read configuration file %s", configPath), err)
		return config
	}
	if err := protojson.Unmarshal(fileContent, config); err != nil {
		logger.error(fmt.Sprintf("Failed to unmarshal configuratation file %s", configPath), err)
	}

	return config
}

func applyEnvironmentVariables(config *Configuration, logger *Logger) {
	if baseURL := os.Getenv("BASE_URL"); baseURL != "" {
		logger.info("BASE_URL is set, configuring project from environment variables")

		defaultProject := &ConfigurationProject{
			Name:      "default",
			Protocol:  getProtocolFromEnv(),
			Url:       baseURL,
			Workspace: "", // Default workspace
		}

		if len(config.Projects) > 0 {
			logger.warn(fmt.Sprintf("%d projects defined in configuration file will be ignored", len(config.Projects)))
		}

		config.Projects = []*ConfigurationProject{defaultProject}
	}
}

// Standalone helper functions
func getProtocolFromEnv() RpcProtocol {
	protocol := strings.ToUpper(os.Getenv("RPC_PROTOCOL"))
	switch protocol {
	case "RPC_PROTOCOL_GRPC":
		return RpcProtocol_RPC_PROTOCOL_GRPC
	case "RPC_PROTOCOL_TWIRP":
		return RpcProtocol_RPC_PROTOCOL_TWIRP
	default:
		return RpcProtocol_RPC_PROTOCOL_TWIRP // Default to TWIRP
	}
}

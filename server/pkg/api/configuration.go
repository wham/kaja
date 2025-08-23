package api

import (
	"fmt"
	"io"
	"os"
	"strings"

	protojson "google.golang.org/protobuf/encoding/protojson"
)

func LoadGetConfigurationResponse(configPath string) *GetConfigurationResponse {
	logger := NewLogger()
	config := loadConfigurationFile(configPath, logger)

	applyEnvironmentVariables(config, logger)
	normalize(config, logger)

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
	if pathPrefix := os.Getenv("PATH_PREFIX"); pathPrefix != "" {
		logger.info("PATH_PREFIX env variable applied")
		config.PathPrefix = pathPrefix
	}

	if baseURL := os.Getenv("BASE_URL"); baseURL != "" {
		logger.info("BASE_URL is set, configuring default project from environment variables")

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

	if config.Ai == nil {
		config.Ai = &ConfigurationAI{}
	}

	if aiBaseUrl := os.Getenv("AI_BASE_URL"); aiBaseUrl != "" {
		logger.info("AI_BASE_URL env variable applied")
		config.Ai.BaseUrl = aiBaseUrl
	}

	if aiApiKey := os.Getenv("AI_API_KEY"); aiApiKey != "" {
		logger.info("AI_API_KEY env variable applied")
		config.Ai.ApiKey = aiApiKey
	}
}

func normalize(config *Configuration, logger *Logger) {
	pathPrefix := strings.Trim(config.PathPrefix, "/")
	if pathPrefix != "" {
		pathPrefix = "/" + pathPrefix
	}
	if config.PathPrefix != pathPrefix {
		config.PathPrefix = pathPrefix
		logger.debug(fmt.Sprintf("pathPrefix normalized from \"%s\" to \"%s\"", config.PathPrefix, pathPrefix))
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

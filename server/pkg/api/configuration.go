package api

import (
	"fmt"
	"io"
	"os"
	"strings"

	protojson "google.golang.org/protobuf/encoding/protojson"
)

func LoadGetConfigurationResponse(configurationPath string, canUpdateConfiguration bool) *GetConfigurationResponse {
	logger := NewLogger()
	logger.info(fmt.Sprintf("configurationPath %s", configurationPath))
	configuration := loadConfigurationFile(configurationPath, logger)

	applyEnvironmentVariables(configuration, logger)
	normalize(configuration, logger)

	// Set system-level settings (file override takes precedence)
	if configuration.System != nil && configuration.System.CanUpdateConfiguration {
		// Keep the value from file (dev override)
	} else {
		configuration.System = &ConfigurationSystem{
			CanUpdateConfiguration: canUpdateConfiguration,
		}
	}

	return &GetConfigurationResponse{Configuration: configuration, Logs: logger.logs}
}

func loadConfigurationFile(configurationPath string, logger *Logger) *Configuration {
	configuration := &Configuration{
		Projects: []*ConfigurationProject{},
	}

	logger.debug(fmt.Sprintf("Trying to load configuration from file %s", configurationPath))
	file, err := os.Open(configurationPath)
	if err != nil {
		if os.IsNotExist(err) {
			logger.info(fmt.Sprintf("Configuration file %s not found.", configurationPath))
		} else {
			logger.error(fmt.Sprintf("Failed opening configuration file %s", configurationPath), err)
		}
		return configuration
	}
	defer file.Close()

	fileContent, err := io.ReadAll(file)
	if err != nil {
		logger.error(fmt.Sprintf("Failed to read configuration file %s", configurationPath), err)
		return configuration
	}
	if err := protojson.Unmarshal(fileContent, configuration); err != nil {
		logger.error(fmt.Sprintf("Failed to unmarshal configuration file %s", configurationPath), err)
	}

	return configuration
}

func applyEnvironmentVariables(configuration *Configuration, logger *Logger) {
	if pathPrefix := os.Getenv("PATH_PREFIX"); pathPrefix != "" {
		logger.info("PATH_PREFIX env variable applied")
		configuration.PathPrefix = pathPrefix
	}

	if configuration.Ai == nil {
		configuration.Ai = &ConfigurationAI{}
	}

	if aiBaseUrl := os.Getenv("AI_BASE_URL"); aiBaseUrl != "" {
		logger.info("AI_BASE_URL env variable applied")
		configuration.Ai.BaseUrl = aiBaseUrl
	}

	if aiApiKey := os.Getenv("AI_API_KEY"); aiApiKey != "" {
		logger.info("AI_API_KEY env variable applied")
		configuration.Ai.ApiKey = aiApiKey
	}
}

func normalize(configuration *Configuration, logger *Logger) {
	pathPrefix := strings.Trim(configuration.PathPrefix, "/")
	if pathPrefix != "" {
		pathPrefix = "/" + pathPrefix
	}
	if configuration.PathPrefix != pathPrefix {
		configuration.PathPrefix = pathPrefix
		logger.debug(fmt.Sprintf("pathPrefix normalized from \"%s\" to \"%s\"", configuration.PathPrefix, pathPrefix))
	}
}

func SaveConfiguration(configurationPath string, configuration *Configuration) error {
	// Only save projects, ai, and system fields (not path_prefix which is set via env)
	configurationToSave := &Configuration{
		Projects: configuration.Projects,
		Ai:       configuration.Ai,
		System:   configuration.System,
	}

	jsonBytes, err := protojson.MarshalOptions{
		Multiline: true,
		Indent:    "  ",
	}.Marshal(configurationToSave)
	if err != nil {
		return fmt.Errorf("failed to marshal configuration: %w", err)
	}

	if err := os.WriteFile(configurationPath, jsonBytes, 0644); err != nil {
		return fmt.Errorf("failed to write configuration file: %w", err)
	}

	return nil
}

package api

import (
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	protojson "google.golang.org/protobuf/encoding/protojson"
)

func LoadGetConfigurationResponse(configurationPath string, canUpdateConfiguration bool) *GetConfigurationResponse {
	logger := NewLogger()
	logger.info(fmt.Sprintf("configurationPath %s", configurationPath))
	configuration := loadConfigurationFile(configurationPath, logger)

	applyEnvironmentVariables(configuration, logger)
	normalize(configuration, logger)
	validateInstanceId(configuration, logger)
	validateProjects(configuration, logger)

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
	// Reserved for future environment variable overrides
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

var validInstanceId = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func validateInstanceId(configuration *Configuration, logger *Logger) {
	if configuration.Id == "" {
		return
	}
	if !validInstanceId.MatchString(configuration.Id) {
		logger.error(fmt.Sprintf("Instance id %q contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.", configuration.Id), nil)
		configuration.Id = ""
	}
}

func validateProjects(configuration *Configuration, logger *Logger) {
	validProjects := []*ConfigurationProject{}
	for _, project := range configuration.Projects {
		if project.Protocol == RpcProtocol_RPC_PROTOCOL_UNSPECIFIED {
			logger.error(fmt.Sprintf("Project %q has no protocol specified. Set protocol to RPC_PROTOCOL_GRPC or RPC_PROTOCOL_TWIRP.", project.Name), nil)
			continue
		}
		validProjects = append(validProjects, project)
	}
	configuration.Projects = validProjects
}

func SaveConfiguration(configurationPath string, configuration *Configuration) error {
	configurationToSave := &Configuration{
		Id:       configuration.Id,
		Projects: configuration.Projects,
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

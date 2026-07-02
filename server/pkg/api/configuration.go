package api

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	protojson "google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func LoadGetConfigurationResponse(configurationPath string, canUpdateConfiguration bool) *GetConfigurationResponse {
	logger := NewLogger()
	logger.info(fmt.Sprintf("configurationPath %s", configurationPath))
	configuration := loadConfigurationFile(configurationPath, logger)

	applyEnvironmentVariables(configuration, logger)
	normalize(configuration, logger)
	validateApps(configuration, logger)

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
		Apps: []*ConfigurationApp{},
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

	fileContent = migrateConfiguration(fileContent, logger)

	if err := protojson.Unmarshal(fileContent, configuration); err != nil {
		logger.error(fmt.Sprintf("Failed to unmarshal configuration file %s", configurationPath), err)
	}

	return configuration
}

// migrateConfiguration upgrades the pre-unification config shape - a top-level
// "projects" list of gRPC/Twirp services - into the typed "apps" model in place, so
// existing files keep working. Each project becomes an app whose set field is its
// type, e.g. { "name", "grpc": { "url", ... } }; protojson would otherwise reject
// the removed "projects" field. (The earlier "apps" form never shipped, so only
// "projects" needs migrating.)
func migrateConfiguration(content []byte, logger *Logger) []byte {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(content, &raw); err != nil {
		// Leave it to protojson to report the parse error.
		return content
	}

	projectsRaw, ok := raw["projects"]
	if !ok {
		return content
	}

	var projects []map[string]any
	if err := json.Unmarshal(projectsRaw, &projects); err != nil {
		logger.error("Failed to read legacy projects list", err)
		return content
	}

	var apps []map[string]any
	if appsRaw, ok := raw["apps"]; ok {
		if err := json.Unmarshal(appsRaw, &apps); err != nil {
			logger.error("Failed to read apps list", err)
			return content
		}
	}

	for _, project := range projects {
		apps = append(apps, legacyProjectToApp(project))
	}
	if len(projects) > 0 {
		logger.info(fmt.Sprintf("Migrated %d legacy project(s) to apps", len(projects)))
	}

	delete(raw, "projects")
	appsBytes, err := json.Marshal(apps)
	if err != nil {
		logger.error("Failed to encode migrated apps", err)
		return content
	}
	raw["apps"] = appsBytes

	migrated, err := json.Marshal(raw)
	if err != nil {
		logger.error("Failed to encode migrated configuration", err)
		return content
	}
	return migrated
}

// legacyProjectToApp converts a pre-unification gRPC/Twirp project into the typed
// app shape { name, headers, <type>: { url, proto_dir, reflection } }.
func legacyProjectToApp(project map[string]any) map[string]any {
	appType := "grpc"
	if protocol, _ := project["protocol"].(string); strings.Contains(strings.ToUpper(protocol), "TWIRP") {
		appType = "twirp"
	}

	variant := map[string]any{}
	if url := stringField(project, "url"); url != "" {
		variant["url"] = url
	}
	if protoDir := stringField(project, "protoDir", "proto_dir"); protoDir != "" {
		variant["proto_dir"] = protoDir
	}
	if boolField(project, "useReflection", "use_reflection") {
		variant["reflection"] = true
	}
	if headers, ok := project["headers"]; ok {
		variant["headers"] = headers
	}

	return map[string]any{"name": project["name"], appType: variant}
}

// flattenApp returns an app's type (the set oneof field) and its scalar parameters
// as a string map, the shape the in-process app contract consumes. The headers map
// is excluded (it is forwarded per request, not a creation parameter); booleans
// render as "true"/"false"; unset (default) fields are omitted.
func flattenApp(app *ConfigurationApp) (string, map[string]string) {
	params := map[string]string{}
	if app == nil {
		return "", params
	}
	message := app.ProtoReflect()
	field := message.WhichOneof(message.Descriptor().Oneofs().ByName("app"))
	if field == nil {
		return "", params
	}
	message.Get(field).Message().Range(func(f protoreflect.FieldDescriptor, v protoreflect.Value) bool {
		if f.IsMap() {
			return true // skip headers
		}
		if f.Kind() == protoreflect.BoolKind {
			params[string(f.Name())] = strconv.FormatBool(v.Bool())
		} else {
			params[string(f.Name())] = v.String()
		}
		return true
	})
	return string(field.Name()), params
}

func stringField(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := m[key].(string); ok {
			return value
		}
	}
	return ""
}

func boolField(m map[string]any, keys ...string) bool {
	for _, key := range keys {
		if value, ok := m[key].(bool); ok {
			return value
		}
	}
	return false
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

func validateApps(configuration *Configuration, logger *Logger) {
	validApps := []*ConfigurationApp{}
	for _, app := range configuration.Apps {
		if appType, _ := flattenApp(app); appType == "" {
			logger.error(fmt.Sprintf("App %q has no type set. Use one of grpc, twirp, openapi, openai, markdown.", app.Name), nil)
			continue
		}
		validApps = append(validApps, app)
	}
	configuration.Apps = validApps
}

func SaveConfiguration(configurationPath string, configuration *Configuration) error {
	configurationToSave := &Configuration{
		PathPrefix: configuration.PathPrefix,
		Apps:       configuration.Apps,
		System:     configuration.System,
		Variables:  configuration.Variables,
	}

	jsonBytes, err := protojson.MarshalOptions{
		Multiline: true,
		Indent:    "  ",
		// Emit snake_case field names (proto_dir, spec_url) in kaja.json.
		UseProtoNames: true,
	}.Marshal(configurationToSave)
	if err != nil {
		return fmt.Errorf("failed to marshal configuration: %w", err)
	}

	if err := os.WriteFile(configurationPath, jsonBytes, 0644); err != nil {
		return fmt.Errorf("failed to write configuration file: %w", err)
	}

	return nil
}

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
		logger.warn(fmt.Sprintf("Configuration file %s did not parse cleanly (%s). Loading it with best effort.", configurationPath, err))
		return salvageConfiguration(fileContent, logger)
	}

	return configuration
}

// salvageConfiguration loads as much of a configuration as possible when the
// strict parse fails: unknown fields (e.g. a kaja.json written by a newer Kaja)
// are ignored, and an app that still fails to decode is skipped with an error,
// so one bad entry can't silently hide every other app.
func salvageConfiguration(content []byte, logger *Logger) *Configuration {
	configuration := &Configuration{
		Apps: []*ConfigurationApp{},
	}
	lenient := protojson.UnmarshalOptions{DiscardUnknown: true}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(content, &raw); err != nil {
		logger.error("Failed to parse configuration file as JSON", err)
		return configuration
	}

	appsRaw, hasApps := raw["apps"]
	delete(raw, "apps")
	if rest, err := json.Marshal(raw); err == nil {
		if err := lenient.Unmarshal(rest, configuration); err != nil {
			logger.error("Failed to read configuration settings", err)
		}
	}
	configuration.Apps = []*ConfigurationApp{}

	if !hasApps {
		return configuration
	}

	var appList []json.RawMessage
	if err := json.Unmarshal(appsRaw, &appList); err != nil {
		logger.error("Failed to read apps list", err)
		return configuration
	}
	for i, appRaw := range appList {
		app := &ConfigurationApp{}
		if err := lenient.Unmarshal(appRaw, app); err != nil {
			logger.error(fmt.Sprintf("Skipping app #%d that could not be read", i+1), err)
			continue
		}
		configuration.Apps = append(configuration.Apps, app)
	}

	return configuration
}

// migrateConfiguration upgrades the pre-unification config shapes into the typed
// "apps" model in place, so existing files keep working:
//   - a top-level "projects" list of gRPC/Twirp services; each project becomes an
//     app whose set field is its type, e.g. { "name", "grpc": { "url", ... } }
//   - built-in apps in the generic { "name", "type", "parameters" } form; the type
//     becomes the set field, e.g. { "name", "markdown": { "folder": ... } }
//
// protojson would otherwise reject the removed "projects" and "type" fields.
func migrateConfiguration(content []byte, logger *Logger) []byte {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(content, &raw); err != nil {
		// Leave it to protojson to report the parse error.
		return content
	}

	var apps []map[string]any
	if appsRaw, ok := raw["apps"]; ok {
		if err := json.Unmarshal(appsRaw, &apps); err != nil {
			logger.error("Failed to read apps list", err)
			return content
		}
	}

	legacyApps := 0
	for i, app := range apps {
		if _, ok := app["type"].(string); ok {
			apps[i] = legacyGenericAppToApp(app)
			legacyApps++
		}
	}
	if legacyApps > 0 {
		logger.info(fmt.Sprintf("Migrated %d legacy app(s) to the typed format", legacyApps))
	}

	projectsRaw, hasProjects := raw["projects"]
	if hasProjects {
		var projects []map[string]any
		if err := json.Unmarshal(projectsRaw, &projects); err != nil {
			logger.error("Failed to read legacy projects list", err)
			return content
		}
		for _, project := range projects {
			apps = append(apps, legacyProjectToApp(project))
		}
		if len(projects) > 0 {
			logger.info(fmt.Sprintf("Migrated %d legacy project(s) to apps", len(projects)))
		}
	}

	if legacyApps == 0 && !hasProjects {
		return content
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

// legacyGenericAppToApp converts a pre-unification built-in app - { name, type,
// parameters, headers } - into the typed shape { name, <type>: { <parameters>,
// headers } }. Parameter keys already match the typed block's proto field names
// (e.g. "spec_url", "folder").
func legacyGenericAppToApp(app map[string]any) map[string]any {
	appType, _ := app["type"].(string)

	variant := map[string]any{}
	if parameters, ok := app["parameters"].(map[string]any); ok {
		for key, value := range parameters {
			variant[key] = value
		}
	}
	// The local Markdown app is the only type without a headers field.
	if headers, ok := app["headers"]; ok && appType != "markdown" {
		variant["headers"] = headers
	}

	return map[string]any{"name": app["name"], appType: variant}
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

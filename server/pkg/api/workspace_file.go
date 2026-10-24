package api

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	protojson "google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func LoadGetWorkspaceResponse(workspaceFile string) *GetWorkspaceResponse {
	logger := NewLogger()
	logger.info(fmt.Sprintf("Workspace file %s", workspaceFile))
	workspace := loadWorkspaceFile(workspaceFile, logger)

	normalize(workspace, logger)
	validateApps(workspace, logger)

	return &GetWorkspaceResponse{Workspace: workspace, Logs: logger.logs}
}

func loadWorkspaceFile(workspaceFile string, logger *Logger) *Workspace {
	_, workspace := readWorkspaceFile(workspaceFile, logger)
	return workspace
}

// readWorkspaceFile reads kaja.json into a Workspace and hands back the bytes it read
// as well, which is what a fingerprint of the file is taken over. A file that isn't
// there is an empty workspace and no bytes.
func readWorkspaceFile(workspaceFile string, logger *Logger) ([]byte, *Workspace) {
	workspace := &Workspace{
		Apps: []*WorkspaceApp{},
	}

	logger.debug(fmt.Sprintf("Trying to load workspace from file %s", workspaceFile))
	file, err := os.Open(workspaceFile)
	if err != nil {
		if os.IsNotExist(err) {
			logger.info(fmt.Sprintf("Workspace file %s not found.", workspaceFile))
		} else {
			logger.error(fmt.Sprintf("Failed opening workspace file %s", workspaceFile), err)
		}
		return nil, workspace
	}
	defer file.Close()

	fileContent, err := io.ReadAll(file)
	if err != nil {
		logger.error(fmt.Sprintf("Failed to read workspace file %s", workspaceFile), err)
		return nil, workspace
	}

	migrated := migrateWorkspace(fileContent, logger)

	if err := protojson.Unmarshal(migrated, workspace); err != nil {
		logger.error(fmt.Sprintf("Failed to unmarshal workspace file %s", workspaceFile), err)
	}

	return fileContent, workspace
}

// migrateWorkspace drops the config shapes kaja no longer declares. Reserving a
// field only stops the schema from reusing it - protojson still rejects the key as
// unknown and fails the whole file - so a retired shape has to be taken out here:
//
//   - a top-level "projects" list of gRPC/Twirp services, migrated in place into the
//     typed "apps" model. Each project becomes an app whose set field is its type,
//     e.g. { "name", "grpc": { "url", ... } }. (The earlier "apps" form never
//     shipped, so only "projects" needs migrating.)
//   - a "system" block, which described the running kaja rather than the workspace.
//     Earlier versions wrote it into every file they saved, so workspaces in the
//     wild still carry one. It is `Runtime` now, and is discarded rather than moved.
//   - a "markdown" app, whose methods each rendered one Markdown construct into a
//     file. It is the general "folder" app now, bound to the same folder.
func migrateWorkspace(content []byte, logger *Logger) []byte {
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

	migratedApps := migrateMarkdownApps(apps, logger)

	projectsRaw, hasProjects := raw["projects"]
	_, hasSystem := raw["system"]
	_, hasScriptsDir := raw["scripts_dir"]
	if !hasProjects && !hasSystem && !hasScriptsDir && !migratedApps {
		return content
	}

	delete(raw, "system")
	delete(raw, "scripts_dir")

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
		delete(raw, "projects")
	}

	if hasProjects || migratedApps {
		appsBytes, err := json.Marshal(apps)
		if err != nil {
			logger.error("Failed to encode migrated apps", err)
			return content
		}
		raw["apps"] = appsBytes
	}

	migrated, err := json.Marshal(raw)
	if err != nil {
		logger.error("Failed to encode migrated workspace", err)
		return content
	}
	return migrated
}

// migrateMarkdownApps rewrites each legacy { "markdown": { "folder": X } } app as
// { "folder": { "path": X } } in place, and reports whether it changed anything.
func migrateMarkdownApps(apps []map[string]any, logger *Logger) bool {
	migrated := false
	for _, app := range apps {
		block, ok := app["markdown"].(map[string]any)
		if !ok {
			continue
		}
		delete(app, "markdown")
		app["folder"] = map[string]any{"path": stringField(block, "folder")}
		migrated = true
	}
	if migrated {
		logger.info("Migrated legacy markdown app(s) to folder apps")
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
func flattenApp(app *WorkspaceApp) (string, map[string]string) {
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

var variableReferencePattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// expandVariables replaces ${NAME} references with the configured variable
// values. References to undefined variables are left as-is so literal ${...}
// text still passes through.
func expandVariables(value string, variables map[string]string) string {
	return variableReferencePattern.ReplaceAllStringFunc(value, func(reference string) string {
		name := reference[2 : len(reference)-1]
		if replacement, ok := variables[name]; ok {
			return replacement
		}
		return reference
	})
}

// expandAppParameters expands ${NAME} variable references in an app's flattened
// creation parameters and reports any references that stayed unresolved. Only
// the reference is logged, never the expanded value - a variable's value may be
// one this machine holds outside kaja.json.
func expandAppParameters(parameters map[string]string, resolver *Resolver, logger *Logger) {
	for key, value := range parameters {
		expanded := resolver.Expand(value)
		parameters[key] = expanded
		for _, match := range variableReferencePattern.FindAllStringSubmatch(expanded, -1) {
			logger.info(fmt.Sprintf("No variable named %q is defined; leaving ${%s} in %q as-is", match[1], match[1], key))
		}
	}
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

func normalize(workspace *Workspace, logger *Logger) {
	pathPrefix := strings.Trim(workspace.PathPrefix, "/")
	if pathPrefix != "" {
		pathPrefix = "/" + pathPrefix
	}
	if workspace.PathPrefix != pathPrefix {
		workspace.PathPrefix = pathPrefix
		logger.debug(fmt.Sprintf("pathPrefix normalized from \"%s\" to \"%s\"", workspace.PathPrefix, pathPrefix))
	}
}

func validateApps(workspace *Workspace, logger *Logger) {
	validApps := []*WorkspaceApp{}
	for _, app := range workspace.Apps {
		if appType, _ := flattenApp(app); appType == "" {
			logger.error(fmt.Sprintf("App %q has no type set. Use one of grpc, twirp, openapi, openai, folder, mcp.", app.Name), nil)
			continue
		}
		validApps = append(validApps, app)
	}
	workspace.Apps = validApps
}

// SaveWorkspace writes kaja.json.
//
// protojson lays the file out, and encoding/json lays it out again: protojson
// varies its own whitespace on purpose - a space after the colon, or two,
// settled per binary - so the same workspace written by two builds of kaja
// is two files. kaja.json is a file people keep in a repository, and a diff
// that touches every line because a variable was added is a diff nobody can
// read. json.Indent writes its own separators over a compact encoding, so what
// lands on disk depends on the content and nothing else. The trailing newline
// is there for the same reason: it is what every other tool writing this file
// would leave.
func SaveWorkspace(workspaceFile string, workspace *Workspace) error {
	compact, err := protojson.MarshalOptions{
		// Emit snake_case field names (proto_dir, spec_url) in kaja.json.
		UseProtoNames: true,
	}.Marshal(workspace)
	if err != nil {
		return fmt.Errorf("failed to marshal workspace: %w", err)
	}

	var indented bytes.Buffer
	if err := json.Indent(&indented, compact, "", "  "); err != nil {
		return fmt.Errorf("failed to format workspace: %w", err)
	}
	indented.WriteByte('\n')

	// Written whole or not at all: a reader - the watcher above all - must never see
	// half a file, so it lands under a temporary name and is renamed into place.
	dir := filepath.Dir(workspaceFile)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("failed to create the workspace folder: %w", err)
	}
	temp, err := os.CreateTemp(dir, ".kaja-*.json")
	if err != nil {
		return fmt.Errorf("failed to write workspace file: %w", err)
	}
	_, writeErr := temp.Write(indented.Bytes())
	closeErr := temp.Close()
	if writeErr != nil || closeErr != nil {
		os.Remove(temp.Name())
		return fmt.Errorf("failed to write workspace file: %w", errors.Join(writeErr, closeErr))
	}
	if err := os.Chmod(temp.Name(), 0o644); err != nil {
		os.Remove(temp.Name())
		return fmt.Errorf("failed to write workspace file: %w", err)
	}
	if err := os.Rename(temp.Name(), workspaceFile); err != nil {
		os.Remove(temp.Name())
		return fmt.Errorf("failed to write workspace file: %w", err)
	}

	return nil
}

// newWorkspaceID is a random (version 4) UUID.
func newWorkspaceID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

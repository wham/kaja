package api

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	esbuild "github.com/evanw/esbuild/pkg/api"
	"github.com/wham/kaja/v2/internal/tempdir"
	"github.com/wham/kaja/v2/internal/ui"
	"github.com/wham/kaja/v2/internal/workspace"
	"github.com/wham/kaja/v2/pkg/bundle"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// ExportRequest is one script, and where to put what it becomes.
type ExportRequest struct {
	// Script is the script's file name in the workspace's scripts folder, or a
	// path to one anywhere. A script is exported by name because a name is what
	// makes it visible outside kaja in the first place.
	Script string
	// Source overrides what is on disk, for exporting a scratch that was never
	// saved.
	Source string
	// Out is the .kaja file to write. Empty writes <script>.kaja beside the
	// script.
	Out string
}

// ExportResult is what was written, and what the person who runs it will need.
type ExportResult struct {
	Path string
	// Manifest is what went in, so a caller can say what the bundle carries
	// without opening it again.
	Manifest *bundle.Manifest
	// Logs are the compile logs of every app, which is where an export that took
	// thirty seconds says what it was doing.
	Logs []*Log
	// Warnings are the things a person should know before they hand the file to
	// somebody: an app that still needs the network to open, a variable with
	// nowhere to read its value from where this will run.
	Warnings []string
	Size     int64
}

// ExportScript freezes a script and everything it calls into a bundle.
//
// Everything here is something kaja already does on every start — open the
// apps, compile their protos, build the stub, resolve the script's imports.
// Doing it once, now, is the whole idea: what comes out needs no compiler, no
// protoc, no esbuild and, where an app can say what it read, no network.
func (s *ApiService) ExportScript(req *ExportRequest) (*ExportResult, error) {
	source, name, err := s.exportSource(req)
	if err != nil {
		return nil, err
	}

	statements, body, err := bundle.ScanImports(source)
	if err != nil {
		return nil, err
	}

	configuration := loadConfigurationFile(s.configurationPath, NewLogger())
	result := &ExportResult{}

	// The apps are the ones the script imports, in the order it imports them —
	// an export carries what this script calls, not what the workspace happens to
	// hold. Everything else in kaja.json stays where it is.
	appNames, err := importedApps(statements)
	if err != nil {
		return nil, err
	}

	sourcesDir, err := tempdir.NewSourcesDir()
	if err != nil {
		return nil, err
	}
	frozenDir, err := tempdir.NewSourcesDir()
	if err != nil {
		return nil, err
	}

	manifest := &bundle.Manifest{
		Name:        strings.TrimSuffix(name, filepath.Ext(name)),
		Title:       strings.TrimSuffix(name, filepath.Ext(name)),
		KajaVersion: s.gitRef,
		Source:      source,
		// A script that holds a call back for approval is a script that writes.
		// Running one the moment a page opens would answer the question the block
		// exists to ask, so an export leaves it to be pressed.
		RunOnLoad: !strings.Contains(body, "kaja.approve"),
	}

	for _, appName := range appNames {
		app := findApp(configuration, appName)
		if app == nil {
			return nil, fmt.Errorf("the script imports %q, which is not an app in %s", appName, s.configurationPath)
		}
		exported, logs, warnings, err := s.exportApp(app, filepath.Join(sourcesDir, appName), filepath.Join(frozenDir, appName))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", appName, err)
		}
		manifest.Apps = append(manifest.Apps, *exported)
		result.Logs = append(result.Logs, logs...)
		result.Warnings = append(result.Warnings, warnings...)
	}

	// One stub over every app, each under its own directory, so a module id names
	// the app it came from and two apps can hold a service of the same name.
	stub, err := ui.BuildStub(sourcesDir)
	if err != nil {
		return nil, fmt.Errorf("building the stub: %w", err)
	}

	manifest.Imports, err = resolveImports(statements, sourcesDir)
	if err != nil {
		return nil, err
	}

	script, err := transpile(body, name)
	if err != nil {
		return nil, err
	}

	manifest.Variables, result.Warnings = s.exportVariables(configuration, manifest, source, result.Warnings)

	out := req.Out
	if out == "" {
		out = manifest.Name + ".kaja"
	}
	if err := writeBundle(out, manifest, script, stub, frozenDir); err != nil {
		return nil, err
	}

	if info, err := os.Stat(out); err == nil {
		result.Size = info.Size()
	}
	result.Path = out
	result.Manifest = manifest
	return result, nil
}

func (s *ApiService) exportSource(req *ExportRequest) (string, string, error) {
	name := filepath.Base(req.Script)
	if req.Source != "" {
		return req.Source, name, nil
	}
	candidate := req.Script
	if filepath.Base(candidate) == candidate {
		candidate = filepath.Join(s.scriptsDir(), candidate)
	}
	content, err := os.ReadFile(candidate)
	if err != nil {
		return "", "", fmt.Errorf("reading the script: %w", err)
	}
	return string(content), name, nil
}

// importedApps is the app of every import that isn't kaja's own module, in the
// order the script imports them, each named once.
func importedApps(statements []bundle.ImportStatement) ([]string, error) {
	var names []string
	seen := map[string]bool{}
	for _, statement := range statements {
		if statement.TypeOnly || isKajaModule(statement.Path) {
			continue
		}
		appName, _, found := strings.Cut(statement.Path, "/")
		if !found || appName == "" {
			return nil, fmt.Errorf("line %d: cannot tell which app %q belongs to — an import reads \"<app>/<path>\"", statement.Line, statement.Path)
		}
		if !seen[appName] {
			seen[appName] = true
			names = append(names, appName)
		}
	}
	return names, nil
}

func isKajaModule(path string) bool {
	return path == "kaja" || path == "./kaja"
}

// exportApp opens one app, compiles its proto surface into sourcesDir, and
// freezes what it read into frozenDir.
func (s *ApiService) exportApp(app *ConfigurationApp, sourcesDir string, frozenDir string) (*bundle.App, []*Log, []string, error) {
	appType, parameters := flattenApp(app)
	if appType == "" {
		return nil, nil, nil, fmt.Errorf("app has no type")
	}

	logger := NewLogger()
	logger.info("Exporting app: " + app.Name)

	// The export runs where the variables are, so the parameters are expanded to
	// open the app — and the app that goes into the bundle keeps its ${NAME}
	// references, because a bundle that carried the resolved value would carry
	// the token with it.
	expanded := map[string]string{}
	for key, value := range parameters {
		expanded[key] = value
	}
	expandAppParameters(expanded, s.Variables(), logger)

	exported := &bundle.App{Name: app.Name, Type: appType}
	var warnings []string

	// Ask the app to write down what it read. Only the app knows whether it can:
	// a document can travel, a server can't.
	changes, err := s.apps.Freeze(appType, expanded)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("freezing: %w", err)
	}
	frozen := app
	if len(changes) > 0 {
		frozen, err = applyParameters(app, changes)
		if err != nil {
			return nil, nil, nil, err
		}
		for key := range changes {
			// A frozen parameter is a resolved one, so anything it referenced is no
			// longer read from a variable.
			expanded[key] = changes[key]
		}
		logger.info("Froze " + strings.Join(sortedKeys(changes), ", "))
	}

	protoDir, err := tempdir.NewSourcesDir()
	if err != nil {
		return nil, nil, nil, err
	}
	opened, err := s.apps.Open(appType, expanded, protoDir, logger.info)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("opening: %w", err)
	}

	// Whatever the app opened from is what the bundle carries: a directory of
	// protos it was pointed at, or the ones it wrote itself from a reflection
	// stream or a document.
	if err := copyTree(workspace.Resolve(opened.ProtoDir), frozenDir); err != nil {
		return nil, nil, nil, fmt.Errorf("freezing the proto surface: %w", err)
	}
	exported.ProtoDir = path.Join(bundle.AppsDir, app.Name, "proto")

	// An app that reads its surface from a directory reads it from the bundle's,
	// which is also what makes a reflected server's methods survive the server
	// being unreachable.
	if appType == "grpc" || appType == "twirp" {
		frozen, err = applyParameters(frozen, map[string]string{"proto_dir": exported.ProtoDir, "reflection": ""})
		if err != nil {
			return nil, nil, nil, err
		}
		exported.Frozen = true
	} else {
		exported.Frozen = len(changes) > 0 || appType == "folder"
	}

	if !exported.Frozen {
		warnings = append(warnings, fmt.Sprintf(
			"%s is a %s app: it reads what it exposes from its server, so the exported app opens it over the network at startup.",
			app.Name, appType))
	}

	logger.info("Compiling " + app.Name)
	compiler := NewCompiler()
	compiler.logger = logger
	if err := compiler.compile(sourcesDir, opened.ProtoDir); err != nil {
		return nil, nil, nil, fmt.Errorf("compiling: %w", err)
	}

	configuration, err := appToJSON(frozen)
	if err != nil {
		return nil, nil, nil, err
	}
	exported.Configuration = configuration

	return exported, logger.logs, warnings, nil
}

// resolveImports turns each import into where its names live in the stub. The
// module ids are the ones BuildStub allocates, which is why the sources of every
// app are compiled into one tree under the app's own name.
func resolveImports(statements []bundle.ImportStatement, sourcesDir string) ([]bundle.Import, error) {
	var imports []bundle.Import

	for _, statement := range statements {
		if statement.TypeOnly {
			continue
		}
		if isKajaModule(statement.Path) {
			for _, specifier := range statement.Specifiers {
				if specifier.Name != "kaja" {
					continue
				}
				imports = append(imports, bundle.Import{Alias: specifier.Alias, Name: "kaja", Module: "kaja"})
			}
			continue
		}

		appName, _, _ := strings.Cut(statement.Path, "/")
		if _, err := os.Stat(filepath.Join(sourcesDir, filepath.FromSlash(statement.Path)+".ts")); err != nil {
			return nil, fmt.Errorf("line %d: %q is not a module app %q generates", statement.Line, statement.Path, appName)
		}
		module := stubModuleID(statement.Path)
		clientModule := ""
		if _, err := os.Stat(filepath.Join(sourcesDir, filepath.FromSlash(statement.Path)+".client.ts")); err == nil {
			clientModule = stubModuleID(statement.Path + ".client")
		}
		for _, specifier := range statement.Specifiers {
			imports = append(imports, bundle.Import{
				Alias:        specifier.Alias,
				Name:         specifier.Name,
				App:          appName,
				Module:       module,
				ClientModule: clientModule,
			})
		}
	}

	return imports, nil
}

// stubModuleID is the identifier BuildStub exports a source under. It is
// repeated rather than shared because the two read the same rule from opposite
// ends — one names a file, the other finds it — and a change to either is a
// change to the bundle format.
func stubModuleID(importPath string) string {
	id := strings.TrimSuffix(importPath, ".ts")
	id = strings.ReplaceAll(id, "/", "$")
	id = strings.ReplaceAll(id, ".", "$")
	return strings.ReplaceAll(id, "-", "$")
}

// transpile turns the script's body into the JavaScript the player runs. The
// imports are already out of it, so what comes back is statements — which is
// what a script is, and why it is wrapped in an async function rather than
// loaded as a module.
func transpile(body string, name string) ([]byte, error) {
	result := esbuild.Transform(body, esbuild.TransformOptions{
		Loader:     esbuild.LoaderTS,
		Format:     esbuild.FormatESModule,
		Target:     esbuild.ESNext,
		Sourcefile: name,
	})
	if len(result.Errors) > 0 {
		message := result.Errors[0]
		if message.Location != nil {
			return nil, fmt.Errorf("line %d: %s", message.Location.Line, message.Text)
		}
		return nil, fmt.Errorf("%s", message.Text)
	}
	return result.Code, nil
}

var variableUsePattern = regexp.MustCompile(`kaja\.variables\.([A-Za-z_][A-Za-z0-9_]*)`)

// exportVariables records the names the bundle needs and where each will look
// for its value, never the value itself unless kaja.json writes it in the clear.
// A "${secret}" variable has no keychain where an exported app runs, so it says
// which environment variable to set — which is also the sentence the warning
// carries, at the one moment somebody can act on it.
func (s *ApiService) exportVariables(configuration *Configuration, manifest *bundle.Manifest, source string, warnings []string) ([]bundle.Variable, []string) {
	referenced := map[string]bool{}
	for _, app := range manifest.Apps {
		// The configuration as it will be read, which is where a ${NAME} that is
		// still there is one the exported app has to resolve.
		content, err := json.Marshal(app.Configuration)
		if err != nil {
			continue
		}
		for _, name := range variableReferencePattern.FindAllStringSubmatch(string(content), -1) {
			referenced[name[1]] = true
		}
	}
	read := map[string]bool{}
	for _, name := range variableUsePattern.FindAllStringSubmatch(source, -1) {
		read[name[1]] = true
	}

	var variables []bundle.Variable
	for _, name := range sortedKeys(configuration.Variables) {
		if !referenced[name] && !read[name] {
			continue
		}
		value := configuration.Variables[name]
		variable := bundle.Variable{Name: name, Used: referenced[name]}
		switch {
		case value == "${secret}":
			variable.Source = bundle.SourceSecret
			variable.Env = bundle.EnvName(name)
		case strings.HasPrefix(value, "${env:"):
			variable.Source = bundle.SourceEnvironment
			variable.Env = strings.TrimSuffix(strings.TrimPrefix(value, "${env:"), "}")
		default:
			variable.Source = bundle.SourceFile
			variable.Value = value
		}
		variables = append(variables, variable)
	}

	for _, variable := range variables {
		if variable.Source == bundle.SourceFile {
			continue
		}
		warnings = append(warnings, fmt.Sprintf(
			"%s reads %s from the environment: set %s where the exported app runs.", manifest.Name, variable.Name, variable.Env))
	}

	// A name nothing in kaja.json defines is one the exported app will read as
	// nothing, which is worth saying while the export is still being made.
	for name := range read {
		if _, ok := configuration.Variables[name]; !ok {
			warnings = append(warnings, fmt.Sprintf("the script reads kaja.variables.%s, which no variable defines.", name))
		}
	}

	return variables, warnings
}

func writeBundle(out string, manifest *bundle.Manifest, script []byte, stub []byte, frozenDir string) error {
	writer, err := bundle.Create(out)
	if err != nil {
		return err
	}
	if err := writeBundleEntries(writer, manifest, script, stub, frozenDir); err != nil {
		writer.Close()
		return err
	}
	return writer.Close()
}

func writeBundleEntries(writer *bundle.Writer, manifest *bundle.Manifest, script []byte, stub []byte, frozenDir string) error {
	if err := writer.AddManifest(manifest); err != nil {
		return err
	}
	if err := writer.Add(bundle.ScriptName, script); err != nil {
		return err
	}
	if err := writer.Add(bundle.StubName, stub); err != nil {
		return err
	}
	for _, app := range manifest.Apps {
		if app.ProtoDir == "" {
			continue
		}
		if err := writer.AddDir(filepath.Join(frozenDir, app.Name), app.ProtoDir); err != nil {
			return err
		}
	}
	return nil
}

func findApp(configuration *Configuration, name string) *ConfigurationApp {
	for _, app := range configuration.Apps {
		if app.Name == name {
			return app
		}
	}
	return nil
}

// applyParameters returns a copy of the app with the named fields set on its
// variant. It is the inverse of flattenApp, and it works the same way: the set
// oneof field is the type, and the parameters are that message's own fields. A
// value of "" clears the field, which is how a frozen app stops naming the
// source it was frozen from.
func applyParameters(app *ConfigurationApp, changes map[string]string) (*ConfigurationApp, error) {
	copied, ok := proto.Clone(app).(*ConfigurationApp)
	if !ok {
		return nil, fmt.Errorf("cannot copy the app")
	}
	message := copied.ProtoReflect()
	field := message.WhichOneof(message.Descriptor().Oneofs().ByName("app"))
	if field == nil {
		return nil, fmt.Errorf("app has no type")
	}
	variant := message.Get(field).Message()
	fields := variant.Descriptor().Fields()

	for name, value := range changes {
		descriptor := fields.ByName(protoreflect.Name(name))
		if descriptor == nil {
			return nil, fmt.Errorf("a %s app has no %q", field.Name(), name)
		}
		if value == "" {
			variant.Clear(descriptor)
			continue
		}
		switch descriptor.Kind() {
		case protoreflect.BoolKind:
			parsed, err := strconv.ParseBool(value)
			if err != nil {
				return nil, fmt.Errorf("%q is not a true/false value for %q", value, name)
			}
			variant.Set(descriptor, protoreflect.ValueOfBool(parsed))
		case protoreflect.StringKind:
			variant.Set(descriptor, protoreflect.ValueOfString(value))
		default:
			return nil, fmt.Errorf("cannot set %q", name)
		}
	}

	return copied, nil
}

// appToJSON is the app as kaja.json writes it, which is what the runner reads it
// back as. protojson rather than a hand-built map, so the bundle and the file
// can never mean two different things by the same app.
func appToJSON(app *ConfigurationApp) (map[string]any, error) {
	content, err := protojson.Marshal(app)
	if err != nil {
		return nil, err
	}
	decoded := map[string]any{}
	if err := json.Unmarshal(content, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// copyTree copies a directory, which is how the proto surface an app opened
// from becomes the proto surface the bundle carries.
func copyTree(from string, to string) error {
	return filepath.Walk(from, func(name string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(from, name)
		if err != nil {
			return err
		}
		target := filepath.Join(to, relative)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		content, err := os.ReadFile(name)
		if err != nil {
			return err
		}
		return os.WriteFile(target, content, 0o644)
	})
}

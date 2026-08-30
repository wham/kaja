package api

import (
	"context"
	"errors"
	fmt "fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/wham/kaja/v2/internal/tempdir"
	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/kaja/v2/pkg/apps/folder"
	"github.com/wham/kaja/v2/pkg/apps/mcp"
	"github.com/wham/kaja/v2/pkg/apps/openai"
	"github.com/wham/kaja/v2/pkg/apps/openapi"
	"github.com/wham/kaja/v2/pkg/apps/rpc"
	"github.com/wham/kaja/v2/pkg/apps/twirp"
	pkggrpc "github.com/wham/kaja/v2/pkg/grpc"
	"google.golang.org/grpc"
)

type ApiService struct {
	configurationPath      string
	canUpdateConfiguration bool
	gitRef                 string
	buildNumber            string
	variableStore          VariableStore
	apps                   *apps.Manager

	// The configuration file's watcher, started by the first call that watches it.
	// Guarded by watcherMu.
	watcherMu sync.Mutex
	watcher   *ConfigurationWatcher
}

// NewApiService builds the service. variableStore is where a "${secret}"
// variable's value lives on this machine; the web server passes nil and those
// variables come from the environment instead.
func NewApiService(configurationPath string, canUpdateConfiguration bool, gitRef string, buildNumber string, variableStore VariableStore) *ApiService {
	tempdir.StartCleanup()

	return &ApiService{
		configurationPath:      configurationPath,
		canUpdateConfiguration: canUpdateConfiguration,
		gitRef:                 gitRef,
		buildNumber:            buildNumber,
		variableStore:          variableStore,
		apps: apps.NewManager(map[string]apps.App{
			"grpc":    rpc.New(),
			"twirp":   twirp.New(),
			"openapi": openapi.New(),
			"openai":  openai.New(),
			"folder":  folder.New(),
			"mcp":     mcp.New(),
		}),
	}
}

// Apps returns the app manager, used by the request router to invoke methods on
// opened app instances.
func (s *ApiService) Apps() *apps.Manager {
	return s.apps
}

// Variables resolves the configured variables as they stand right now. The
// request routers use it to expand the ${NAME} references in the headers the
// client sends, and to mask resolved values back out of what an app reports
// exchanging with its upstream.
func (s *ApiService) Variables() *Resolver {
	configuration := loadConfigurationFile(s.configurationPath, NewLogger())
	return NewResolver(configuration.Variables, s.variableStore)
}

// variableStoreAvailable reports whether this machine can store a variable's
// value outside kaja.json.
func (s *ApiService) variableStoreAvailable() bool {
	return s.variableStore != nil && s.variableStore.Available()
}

// InvokeApp is the one door every call goes through, whichever build it arrived on.
// The reserved header names the app the call belongs to and goes no further. The
// ${NAME} references the client left in the rest are expanded here — the client sends
// them unexpanded, because a variable's value may be one it is not allowed to know —
// and the app's own credential and transport security are read from kaja.json now
// rather than held from Open, so replacing a token takes effect on the next call
// instead of the next compile.
//
// Coming back, every resolved value is masked out of the headers the app reports
// exchanging upstream, so no value kaja.json doesn't carry can reach the client, and
// the call is timed here: measured at this end, the duration is server-side time with
// nothing of the trip between the UI and this process in it, which is why an app never
// fills one in itself.
func (s *ApiService) InvokeApp(ctx context.Context, method string, message []byte, headers map[string]string) (apps.Stream, error) {
	name := apps.TakeAppName(headers)
	resolver := s.Variables()
	connection := s.appConnection(name)
	expanded := resolver.ExpandAll(headers)
	entry := callLog{method: method, app: name, expanded: expandedNames(headers, expanded)}

	call := &apps.Call{
		Method:  method,
		Request: message,
		Headers: apps.MergeMetadata(expanded, connection.Metadata),
		TLS:     connection.TLS,
	}

	started := time.Now()
	stream, err := s.apps.Invoke(ctx, name, call)
	if err != nil {
		duration := time.Since(started).Milliseconds()
		var upstream *apps.UpstreamError
		if errors.As(err, &upstream) {
			upstream.DurationMs = duration
			upstream.RequestHeaders = resolver.Redact(upstream.RequestHeaders, headers)
		}
		entry.write(duration, err)
		return nil, err
	}
	return &timedStream{stream: stream, started: started, resolver: resolver, sent: headers, log: entry}, nil
}

// callLog is the one line the door writes about a call it carried. Everything else
// that says what a call did is in the browser - the Headers view, the payload pane,
// the duration on the row - so a headless deployment has nothing to grep without it,
// and since every call passes through here one line covers the whole stack.
//
// Header names, never header values: expanding a ${NAME} in Go is what keeps a value
// out of the browser, and a log file is no better a place for it.
type callLog struct {
	method   string
	app      string
	expanded []string
}

// callLogging reports whether the line would be written at all, which is what keeps
// the bookkeeping off a call nobody is debugging.
func callLogging() bool {
	return slog.Default().Enabled(context.Background(), slog.LevelDebug)
}

// expandedNames is the headers a ${NAME} reference resolved in, which is the question
// a call carrying the wrong credential is debugged by: whether the reference resolved
// at all, and never what it resolved to.
func expandedNames(sent map[string]string, expanded map[string]string) []string {
	if !callLogging() {
		return nil
	}
	var names []string
	for name, value := range expanded {
		if value != sent[name] {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

// write is the line, written once where the call's outcome is settled. An upstream
// failure is the one outcome carrying a status of its own: a call that answered has
// been turned into the method's response by the time it is back here.
func (l callLog) write(durationMs int64, err error) {
	if !callLogging() {
		return
	}
	attributes := []any{"method", l.method, "app", l.app, "durationMs", durationMs, "expandedHeaders", l.expanded}
	var upstream *apps.UpstreamError
	if errors.As(err, &upstream) {
		attributes = append(attributes, "upstreamStatus", upstream.Status)
	}
	slog.Debug("App call", attributes...)
}

// timedStream is the call as InvokeApp hands it on: the app's own stream, with the
// duration and the redaction applied to the report it ends with. A stream is over when
// it is over, so both are settled where the report is read rather than where the call
// was made.
type timedStream struct {
	stream   apps.Stream
	started  time.Time
	resolver *Resolver
	sent     map[string]string
	log      callLog
}

func (s *timedStream) Recv() ([]byte, error) { return s.stream.Recv() }

func (s *timedStream) Report() *apps.Report {
	report := s.stream.Report()
	if report == nil {
		report = &apps.Report{}
	}
	report.DurationMs = time.Since(s.started).Milliseconds()
	report.RequestHeaders = s.resolver.Redact(report.RequestHeaders, s.sent)
	s.log.write(report.DurationMs, nil)
	return report
}

// Compile compiles the proto surface an app was opened with and streams the result:
// every log line as it is written, then one last message carrying the terminal status
// and, on a success, the generated sources and the stub.
func (s *ApiService) Compile(req *CompileRequest, stream grpc.ServerStreamingServer[CompileResponse]) error {
	var sendErr error
	send := func(response *CompileResponse) {
		if sendErr == nil {
			sendErr = stream.Send(response)
		}
	}

	compiler := NewCompiler(NewStreamingLogger(func(log *Log) {
		send(&CompileResponse{Status: CompileStatus_STATUS_RUNNING, Logs: []*Log{log}})
	}))

	sources, stub, err := compiler.run(req.ProtoDir)
	if err != nil {
		// The failure was logged as it happened, so the last message is the verdict
		// and nothing else.
		send(&CompileResponse{Status: CompileStatus_STATUS_ERROR})
	} else {
		send(&CompileResponse{Status: CompileStatus_STATUS_READY, Sources: sources, Stub: stub})
	}

	return sendErr
}

func (s *ApiService) OpenApp(ctx context.Context, req *OpenAppRequest) (*OpenAppResponse, error) {
	// The app's typed parameters are flattened to a string map for the in-process
	// app contract; the set oneof field is the app type.
	appType, parameters := flattenApp(req.App)
	if appType == "" {
		return nil, fmt.Errorf("app type is required")
	}

	logger := NewLogger()
	logger.info("Opening app: " + appType)

	// Expand ${NAME} variable references in the creation parameters (URLs,
	// tokens, ...) from the variables configured in kaja.json.
	expandAppParameters(parameters, s.Variables(), logger)

	protoDir, err := tempdir.NewSourcesDir()
	if err != nil {
		logger.error("Failed to create temp directory", err)
		return &OpenAppResponse{Status: OpenStatus_OPEN_STATUS_ERROR, Logs: logger.logs}, nil
	}

	// The app is registered under its own name, which is the address every call
	// already carries: nothing about where it lives is handed to the client.
	openedDir, err := s.apps.Open(req.App.Name, appType, parameters, protoDir, func(message string) {
		logger.info(message)
	})
	if err != nil {
		logger.error("Failed to open app", err)
		return &OpenAppResponse{Status: OpenStatus_OPEN_STATUS_ERROR, Logs: logger.logs}, nil
	}

	return &OpenAppResponse{
		Status:   OpenStatus_OPEN_STATUS_OK,
		Logs:     logger.logs,
		ProtoDir: openedDir,
	}, nil
}

// AppConnection is how a grpc app reaches its upstream: the credential it sends
// with every call, and the transport security it uses. Both are read from
// kaja.json when the call is made rather than held from Open, so replacing a
// token takes effect on the next call instead of the next compile.
type AppConnection struct {
	Metadata map[string]string
	TLS      pkggrpc.TLSOptions
}

// appConnection resolves how the named app connects. The name arrives on the
// reserved header the client sends with every call; an app that isn't there, or
// isn't a grpc app, connects the way it always has.
func (s *ApiService) appConnection(name string) AppConnection {
	if name == "" {
		return AppConnection{}
	}

	configuration := loadConfigurationFile(s.configurationPath, NewLogger())
	for _, app := range configuration.Apps {
		if app.Name != name {
			continue
		}
		appType, parameters := flattenApp(app)
		if appType != "grpc" {
			return AppConnection{}
		}
		expandAppParameters(parameters, NewResolver(configuration.Variables, s.variableStore), NewLogger())
		return AppConnection{Metadata: rpc.Metadata(parameters), TLS: rpc.TLS(parameters)}
	}
	return AppConnection{}
}

// InspectGrpc reads the surface a grpc app would be opened with - reflecting the
// server, or reading the proto directory - without creating the app, so the New
// gRPC app form can fill itself in from what answered.
func (s *ApiService) InspectGrpc(ctx context.Context, req *InspectGrpcRequest) (*InspectGrpcResponse, error) {
	if req.Grpc == nil {
		return nil, fmt.Errorf("grpc app is required")
	}

	_, parameters := flattenApp(&ConfigurationApp{App: &ConfigurationApp_Grpc{Grpc: req.Grpc}})
	expandAppParameters(parameters, s.Variables(), NewLogger())

	server, problem := rpc.Inspect(parameters, func(message string) { slog.Info(message) })
	if problem != nil {
		return &InspectGrpcResponse{Problem: &GrpcProblem{
			Kind:    grpcProblemKind(problem.Kind),
			Message: problem.Message,
			Detail:  problem.Detail,
		}}, nil
	}

	return &InspectGrpcResponse{Server: describeServer(server)}, nil
}

var grpcProblemKinds = map[string]GrpcProblemKind{
	"unreachable":      GrpcProblemKind_GRPC_PROBLEM_UNREACHABLE,
	"tls":              GrpcProblemKind_GRPC_PROBLEM_TLS,
	"noReflection":     GrpcProblemKind_GRPC_PROBLEM_NO_REFLECTION,
	"unauthenticated":  GrpcProblemKind_GRPC_PROBLEM_UNAUTHENTICATED,
	"permissionDenied": GrpcProblemKind_GRPC_PROBLEM_PERMISSION_DENIED,
	"noServices":       GrpcProblemKind_GRPC_PROBLEM_NO_SERVICES,
	"timeout":          GrpcProblemKind_GRPC_PROBLEM_TIMEOUT,
	"noProtoFiles":     GrpcProblemKind_GRPC_PROBLEM_NO_PROTO_FILES,
	"protoInvalid":     GrpcProblemKind_GRPC_PROBLEM_PROTO_INVALID,
	"target":           GrpcProblemKind_GRPC_PROBLEM_TARGET,
}

func grpcProblemKind(kind string) GrpcProblemKind {
	return grpcProblemKinds[kind]
}

func describeServer(server *rpc.Server) *GrpcServer {
	described := &GrpcServer{
		Source:            server.Source,
		Target:            server.Target,
		Tls:               server.TLS,
		Reachable:         server.Reachable,
		MethodCount:       int32(server.MethodCount),
		ReflectionVersion: server.ReflectionVersion,
		FileCount:         int32(server.FileCount),
		ProtoDir:          server.ProtoDir,
	}
	for _, service := range server.Services {
		described.Services = append(described.Services, &GrpcService{
			Name:                       service.Name,
			MethodCount:                int32(service.MethodCount),
			ClientStreamingMethodCount: int32(service.ClientStreamingMethodCount),
		})
	}
	return described
}

// InspectMcp reads what an MCP server exposes without creating an app, so the
// New MCP app form can fill itself in from what answered.
func (s *ApiService) InspectMcp(ctx context.Context, req *InspectMcpRequest) (*InspectMcpResponse, error) {
	if req.Mcp == nil {
		return nil, fmt.Errorf("mcp app is required")
	}

	_, parameters := flattenApp(&ConfigurationApp{App: &ConfigurationApp_Mcp{Mcp: req.Mcp}})
	expandAppParameters(parameters, s.Variables(), NewLogger())

	surface, problem := mcp.Inspect(parameters)
	if problem != nil {
		return &InspectMcpResponse{Problem: &McpProblem{
			Kind:    mcpProblemKind(problem.Kind),
			Message: problem.Message,
			Detail:  problem.Detail,
		}}, nil
	}

	return &InspectMcpResponse{Server: describeMcpServer(surface)}, nil
}

var mcpProblemKinds = map[mcp.ProblemKind]McpProblemKind{
	mcp.ProblemTarget:       McpProblemKind_MCP_PROBLEM_TARGET,
	mcp.ProblemUnreachable:  McpProblemKind_MCP_PROBLEM_UNREACHABLE,
	mcp.ProblemTimeout:      McpProblemKind_MCP_PROBLEM_TIMEOUT,
	mcp.ProblemUnauthorized: McpProblemKind_MCP_PROBLEM_UNAUTHORIZED,
	mcp.ProblemForbidden:    McpProblemKind_MCP_PROBLEM_FORBIDDEN,
	mcp.ProblemHTTPError:    McpProblemKind_MCP_PROBLEM_HTTP_ERROR,
	mcp.ProblemNotMCP:       McpProblemKind_MCP_PROBLEM_NOT_MCP,
	mcp.ProblemEmpty:        McpProblemKind_MCP_PROBLEM_EMPTY,
}

func mcpProblemKind(kind mcp.ProblemKind) McpProblemKind {
	return mcpProblemKinds[kind]
}

// mcpToolLimit bounds how many tools travel back to the form. It shows a few and
// counts the rest, and a server with three hundred of them would otherwise send
// every description it has to fill a list nobody reads to the end.
const mcpToolLimit = 24

func describeMcpServer(surface *mcp.Surface) *McpServer {
	described := &McpServer{
		Name:                  surface.ServerInfo.Name,
		Version:               surface.ServerInfo.Version,
		ProtocolVersion:       surface.ProtocolVersion,
		Handshake:             surface.Legacy,
		SupportedVersions:     surface.SupportedVersions,
		ToolCount:             int32(len(surface.Tools)),
		ResourceCount:         int32(len(surface.Resources)),
		ResourceTemplateCount: int32(len(surface.ResourceTemplates)),
		PromptCount:           int32(len(surface.Prompts)),
		Instructions:          surface.Instructions,
	}
	for i, tool := range surface.Tools {
		if i == mcpToolLimit {
			break
		}
		described.Tools = append(described.Tools, &McpTool{
			Name:        tool.Name,
			Title:       tool.Title,
			Description: tool.Description,
			ReadOnly:    tool.Annotations != nil && tool.Annotations.ReadOnlyHint != nil && *tool.Annotations.ReadOnlyHint,
		})
	}
	return described
}

// InspectOpenApi reads an OpenAPI document without creating an app, so the New
// OpenAPI app form can fill itself in from what the document declares.
func (s *ApiService) InspectOpenApi(ctx context.Context, req *InspectOpenApiRequest) (*InspectOpenApiResponse, error) {
	if req.Openapi == nil {
		return nil, fmt.Errorf("openapi app is required")
	}

	_, parameters := flattenApp(&ConfigurationApp{App: &ConfigurationApp_Openapi{Openapi: req.Openapi}})
	expandAppParameters(parameters, s.Variables(), NewLogger())

	document, problem := openapi.Inspect(parameters, func(message string) { slog.Info(message) })
	if problem != nil {
		return &InspectOpenApiResponse{Problem: &OpenApiProblem{
			Kind:    problemKind(problem.Kind),
			Message: problem.Message,
			Detail:  problem.Detail,
		}}, nil
	}

	return &InspectOpenApiResponse{Document: describeDocument(document)}, nil
}

var problemKinds = map[string]OpenApiProblemKind{
	"unreachable":  OpenApiProblemKind_OPEN_API_PROBLEM_UNREACHABLE,
	"unauthorized": OpenApiProblemKind_OPEN_API_PROBLEM_UNAUTHORIZED,
	"httpError":    OpenApiProblemKind_OPEN_API_PROBLEM_HTTP_ERROR,
	"html":         OpenApiProblemKind_OPEN_API_PROBLEM_HTML,
	"notADocument": OpenApiProblemKind_OPEN_API_PROBLEM_NOT_A_DOCUMENT,
	"swagger2":     OpenApiProblemKind_OPEN_API_PROBLEM_SWAGGER2,
	"malformed":    OpenApiProblemKind_OPEN_API_PROBLEM_MALFORMED,
}

func problemKind(kind string) OpenApiProblemKind {
	return problemKinds[kind]
}

func describeDocument(document *openapi.Document) *OpenApiDocument {
	described := &OpenApiDocument{
		Title:                document.Title,
		Version:              document.Version,
		OpenapiVersion:       document.OpenAPIVersion,
		OperationCount:       int32(document.OperationCount),
		TagCount:             int32(document.TagCount),
		GuessedBaseUrl:       document.GuessedBaseURL,
		PerOperationSecurity: document.PerOperationSecurity,
	}
	for _, server := range document.Servers {
		described.Servers = append(described.Servers, &OpenApiServer{
			Url:         server.URL,
			Description: server.Description,
			Variables:   describeServerVariables(server.Variables),
		})
	}
	for _, scheme := range document.SecuritySchemes {
		described.SecuritySchemes = append(described.SecuritySchemes, &OpenApiSecurityScheme{
			Key:              scheme.Key,
			Type:             scheme.Type,
			Scheme:           scheme.Scheme,
			BearerFormat:     scheme.BearerFormat,
			In:               scheme.In,
			ParameterName:    scheme.ParameterName,
			OpenIdConnectUrl: scheme.OpenIDConnectURL,
			Description:      scheme.Description,
			OperationCount:   int32(scheme.OperationCount),
			RequiresOthers:   scheme.RequiresOthers,
		})
	}
	return described
}

func describeServerVariables(variables []openapi.DocumentServerVariable) []*OpenApiServerVariable {
	described := make([]*OpenApiServerVariable, 0, len(variables))
	for _, variable := range variables {
		described = append(described, &OpenApiServerVariable{
			Name:         variable.Name,
			DefaultValue: variable.Default,
			EnumValues:   variable.Enum,
			Description:  variable.Description,
		})
	}
	return described
}

func (s *ApiService) GetConfiguration(ctx context.Context, req *GetConfigurationRequest) (*GetConfigurationResponse, error) {
	slog.Info("Getting configuration")

	return s.configurationResponse(), nil
}

// WatchConfiguration streams the configuration file as it is edited, one message per
// change carrying the whole of what GetConfiguration answers with. The file is read
// where the change is noticed, so a client is never told that something changed and
// left to ask what.
//
// The current configuration is not sent when the stream opens: whoever is watching has
// just loaded it, and a second reading of the same file would be a change nothing made.
func (s *ApiService) WatchConfiguration(req *WatchConfigurationRequest, stream grpc.ServerStreamingServer[GetConfigurationResponse]) error {
	// Buffered by one and dropped when full: a burst of writes is one change to report,
	// and the report is the file as it stands by the time it is read.
	changed := make(chan struct{}, 1)
	unsubscribe := s.watchConfigurationFile(func() {
		select {
		case changed <- struct{}{}:
		default:
		}
	})
	defer unsubscribe()

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case <-changed:
			if err := stream.Send(s.configurationResponse()); err != nil {
				return err
			}
		}
	}
}

// configurationResponse is the file plus the runtime it is being served by, which is
// what both doors to the configuration answer with.
func (s *ApiService) configurationResponse() *GetConfigurationResponse {
	response := LoadGetConfigurationResponse(s.configurationPath)

	response.Runtime = &Runtime{
		CanUpdateConfiguration: s.canUpdateConfiguration,
		GitRef:                 s.gitRef,
		BuildNumber:            s.buildNumber,
		VariableStoreAvailable: s.variableStoreAvailable(),
	}

	// The variables travel as kaja.json writes them - a literal value, or the
	// source that holds it ("${secret}", "${env:X}"). A value this machine
	// resolved from a source is never part of the response.
	response.VariableStatus = NewResolver(response.Configuration.Variables, s.variableStore).Statuses()

	return response
}

// watchConfigurationFile subscribes to the configuration file and hands back the way to
// stop. The watcher is started by the first subscriber rather than by the process, so a
// kaja nobody is watching polls nothing. A file that cannot be watched leaves the
// caller subscribed to nothing: a workspace with no configuration file has no change to
// report, which is not a reason to refuse the call.
func (s *ApiService) watchConfigurationFile(onChange func()) func() {
	s.watcherMu.Lock()
	defer s.watcherMu.Unlock()

	if s.watcher == nil {
		watcher, err := NewConfigurationWatcher(s.configurationPath)
		if err != nil {
			slog.Warn("Failed to start configuration watcher", "path", s.configurationPath, "error", err)
			return func() {}
		}
		s.watcher = watcher
	}

	return s.watcher.Subscribe(onChange)
}

// Close stops watching the configuration file.
func (s *ApiService) Close() error {
	s.watcherMu.Lock()
	defer s.watcherMu.Unlock()

	if s.watcher == nil {
		return nil
	}
	err := s.watcher.Close()
	s.watcher = nil
	return err
}

func (s *ApiService) UpdateConfiguration(ctx context.Context, req *UpdateConfigurationRequest) (*UpdateConfigurationResponse, error) {
	if req.Configuration == nil {
		return nil, fmt.Errorf("configuration is required")
	}

	if !s.canUpdateConfiguration {
		return nil, fmt.Errorf("updating configuration is not allowed")
	}

	if err := validateVariables(req.Configuration.Variables); err != nil {
		return nil, err
	}

	slog.Info("Updating configuration")

	if err := SaveConfiguration(s.configurationPath, req.Configuration); err != nil {
		return nil, fmt.Errorf("failed to save configuration: %w", err)
	}

	return &UpdateConfigurationResponse{
		Configuration:  req.Configuration,
		VariableStatus: NewResolver(req.Configuration.Variables, s.variableStore).Statuses(),
	}, nil
}

// SetStoredValue writes a variable's value to this machine's store, so kaja.json
// only has to name it. The value never travels back out.
func (s *ApiService) SetStoredValue(ctx context.Context, req *SetStoredValueRequest) (*StoredValueResponse, error) {
	if err := s.checkStoredValueAllowed(req.Name); err != nil {
		return nil, err
	}
	if !s.variableStoreAvailable() {
		return nil, fmt.Errorf("this machine has nowhere to store a variable's value; set %s in the environment instead", storedEnvName(req.Name))
	}
	if req.Value == "" {
		return nil, fmt.Errorf("value is required")
	}

	slog.Info("Storing variable value", "name", req.Name)

	if err := s.variableStore.Set(req.Name, req.Value); err != nil {
		return nil, fmt.Errorf("failed to store the value for %q: %w", req.Name, err)
	}

	return &StoredValueResponse{VariableStatus: s.Variables().Statuses()}, nil
}

// ClearStoredValue removes a variable's value from this machine's store. With no
// store there is nothing to clear, which is a success, not a failure - saving the
// Variables tab clears whatever stopped being stored either way.
func (s *ApiService) ClearStoredValue(ctx context.Context, req *ClearStoredValueRequest) (*StoredValueResponse, error) {
	if err := s.checkStoredValueAllowed(req.Name); err != nil {
		return nil, err
	}

	if s.variableStoreAvailable() {
		slog.Info("Clearing stored variable value", "name", req.Name)
		if err := s.variableStore.Delete(req.Name); err != nil {
			return nil, fmt.Errorf("failed to clear the value for %q: %w", req.Name, err)
		}
	}

	return &StoredValueResponse{VariableStatus: s.Variables().Statuses()}, nil
}

func (s *ApiService) checkStoredValueAllowed(name string) error {
	if !s.canUpdateConfiguration {
		return fmt.Errorf("updating configuration is not allowed")
	}
	if !variableNamePattern.MatchString(name) {
		return fmt.Errorf("variable name %q must start with a letter or underscore and contain only letters, numbers and underscores", name)
	}
	return nil
}

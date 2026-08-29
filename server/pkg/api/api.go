package api

import (
	"context"
	"errors"
	fmt "fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/wham/kaja/v2/internal/tempdir"
	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/kaja/v2/pkg/apps/folder"
	"github.com/wham/kaja/v2/pkg/apps/mcp"
	"github.com/wham/kaja/v2/pkg/apps/openai"
	"github.com/wham/kaja/v2/pkg/apps/openapi"
	"github.com/wham/kaja/v2/pkg/apps/rpc"
	"github.com/wham/kaja/v2/pkg/grpc"
)

type ApiService struct {
	compilers              sync.Map // map[string]*Compiler - keyed by ID
	configurationPath      string
	canUpdateConfiguration bool
	gitRef                 string
	buildNumber            string
	variableStore          VariableStore
	apps                   *apps.Manager
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
			"grpc":    rpc.New("grpc"),
			"twirp":   rpc.New("twirp"),
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

// InvokeApp invokes a method on an opened in-process app. It expands the ${NAME}
// references in the headers the client sent - the client sends them unexpanded,
// because a variable's value may be one it is not allowed to know - and masks
// every resolved value back out of the headers the app reports exchanging with
// its upstream. Both request routers go through here, so neither can surface a
// value kaja.json doesn't carry. It also stamps the invocation's duration, on the
// result and the failure alike: measured here, it is server-side time with nothing
// of the trip between the UI and this process in it.
func (s *ApiService) InvokeApp(target string, method string, message []byte, headers map[string]string) (*apps.InvokeResult, error) {
	resolver := s.Variables()

	started := time.Now()
	result, err := s.apps.Invoke(target, method, message, resolver.ExpandAll(headers))
	durationMs := time.Since(started).Milliseconds()
	if err != nil {
		var upstream *apps.UpstreamError
		if errors.As(err, &upstream) {
			upstream.DurationMs = durationMs
			upstream.RequestHeaders = resolver.Redact(upstream.RequestHeaders, headers)
		}
		return nil, err
	}

	result.DurationMs = durationMs
	result.RequestHeaders = resolver.Redact(result.RequestHeaders, headers)
	return result, nil
}

func (s *ApiService) getOrCreateCompiler(id string) *Compiler {
	compiler, _ := s.compilers.LoadOrStore(id, NewCompiler())
	return compiler.(*Compiler)
}

func (s *ApiService) Compile(ctx context.Context, req *CompileRequest) (*CompileResponse, error) {
	if req.Id == "" {
		return nil, fmt.Errorf("id is required")
	}

	compiler := s.getOrCreateCompiler(req.Id)
	compiler.mu.Lock()
	defer compiler.mu.Unlock()

	if compiler.logger == nil {
		compiler.logger = NewLogger()
	}

	if compiler.status != CompileStatus_STATUS_RUNNING && req.LogOffset == 0 {
		compiler.status = CompileStatus_STATUS_RUNNING
		compiler.logger = NewLogger()
		compiler.sources = []*Source{}
		compiler.logger.info("Starting compilation")
		go compiler.start(req.Id, req.ProtoDir)
	}

	logOffset := int(req.LogOffset)
	if logOffset > len(compiler.logger.logs)-1 {
		logOffset = len(compiler.logger.logs) - 1
	}

	logs := []*Log{}
	if int(req.LogOffset) < len(compiler.logger.logs) {
		logs = compiler.logger.logs[logOffset:]
	}

	return &CompileResponse{
		Status:  compiler.status,
		Logs:    logs,
		Sources: compiler.sources,
		Stub:    compiler.stub,
	}, nil
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

	result, err := s.apps.Open(appType, parameters, protoDir, func(message string) {
		logger.info(message)
	})
	if err != nil {
		logger.error("Failed to open app", err)
		return &OpenAppResponse{Status: OpenStatus_OPEN_STATUS_ERROR, Logs: logger.logs}, nil
	}

	return &OpenAppResponse{
		Status:   OpenStatus_OPEN_STATUS_OK,
		Logs:     logger.logs,
		ProtoDir: result.ProtoDir,
		Target:   result.Target,
		Protocol: result.Protocol,
	}, nil
}

// AppConnection is how a grpc app reaches its upstream: the credential it sends
// with every call, and the transport security it uses. Both are read from
// kaja.json when the call is made rather than held from Open, so replacing a
// token takes effect on the next call instead of the next compile.
type AppConnection struct {
	Metadata map[string]string
	TLS      grpc.TLSOptions
}

// AppConnection resolves how the named app connects. The name arrives on the
// reserved header the client sends with every call; an app that isn't there, or
// isn't a grpc app, connects the way it always has.
func (s *ApiService) AppConnection(name string) AppConnection {
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

	return response, nil
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

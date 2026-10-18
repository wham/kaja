package api

import (
	"context"
	"errors"
	fmt "fmt"
	"io"
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
	"google.golang.org/protobuf/proto"
)

type ApiService struct {
	// Guarded by workspaceMu: the desktop swaps both when it opens another workspace.
	workspaceMu   sync.RWMutex
	workspaceFile string
	variableStore VariableStore

	canUpdateWorkspace bool
	gitRef             string
	buildNumber        string
	// mcpAuthorizer holds this installation's MCP sign-ins. It is nil where there
	// is nowhere to keep one, and the verbs that use it are then absent.
	mcpAuthorizer *mcp.Authorizer
	apps          *apps.Manager
	// compiled is every surface this process has compiled, so an app whose
	// parameters have not moved is reopened without reading its upstream again.
	compiled *compileCache

	// current is the workspace as last read, nil until something asks. Guarded by
	// snapshotMu.
	snapshotMu sync.Mutex
	current    *workspaceSnapshot

	// The workspace file's watcher, started with the first snapshot so an edit made
	// outside kaja drops it. Guarded by watcherMu.
	watcherMu sync.Mutex
	watcher   *WorkspaceWatcher

	// writeMu serializes the writes to kaja.json, so two read-modify-write edits
	// cannot each save a file missing the other's change.
	writeMu sync.Mutex
}

// NewApiService builds the service. variableStore is where a "${secret}"
// variable's value lives on this machine; the web server passes nil and those
// variables come from the environment instead.
func NewApiService(workspaceFile string, canUpdateWorkspace bool, gitRef string, buildNumber string, variableStore VariableStore) *ApiService {
	tempdir.StartCleanup()

	// A sign-in is a write: it leaves a credential on the machine serving the
	// workspace. So a kaja serving its workspace read-only has no authorizer, and
	// the verbs that would use one say there is nothing to sign in with.
	var authorizer *mcp.Authorizer
	if canUpdateWorkspace {
		opened, err := mcp.DefaultAuthorizer()
		if err != nil {
			slog.Warn("MCP authorization is unavailable", "error", err)
		}
		authorizer = opened
	}

	return &ApiService{
		workspaceFile:      workspaceFile,
		canUpdateWorkspace: canUpdateWorkspace,
		gitRef:             gitRef,
		buildNumber:        buildNumber,
		variableStore:      variableStore,
		mcpAuthorizer:      authorizer,
		compiled:           newCompileCache(),
		apps: apps.NewManager(map[string]apps.App{
			"grpc":    rpc.New(),
			"twirp":   twirp.New(),
			"openapi": openapi.New(),
			"openai":  openai.New(),
			"folder":  folder.New(),
			"mcp":     mcp.New().WithAuthorizer(authorizer),
		}),
	}
}

// Apps returns the app manager, used by the request router to invoke methods on
// opened app instances.
func (s *ApiService) Apps() *apps.Manager {
	return s.apps
}

func (s *ApiService) workspaceFilePath() string {
	s.workspaceMu.RLock()
	defer s.workspaceMu.RUnlock()
	return s.workspaceFile
}

func (s *ApiService) valueStore() VariableStore {
	s.workspaceMu.RLock()
	defer s.workspaceMu.RUnlock()
	return s.variableStore
}

func (s *ApiService) WorkspaceDir() string {
	return workspaceDir(s.workspaceFilePath())
}

// SetWorkspace points the service at another file. Everything derived from the old
// one goes with it: the snapshot, the open instances, and the watcher - whose streams
// end, so a window still watching opens a new one on the new file.
func (s *ApiService) SetWorkspace(workspaceFile string, variableStore VariableStore) {
	if err := s.Close(); err != nil {
		slog.Warn("Failed to stop watching the workspace", "error", err)
	}

	s.workspaceMu.Lock()
	s.workspaceFile = workspaceFile
	s.variableStore = variableStore
	s.workspaceMu.Unlock()

	s.invalidateSnapshot()
	s.apps.Clear()
	slog.Info("Opened workspace", "path", workspaceFile)
}

// Variables resolves the configured variables as they stand right now. The
// request routers use it to expand the ${NAME} references in the headers the
// client sends, and to mask resolved values back out of what an app reports
// exchanging with its upstream.
func (s *ApiService) Variables() *Resolver {
	return s.snapshot().resolver
}

// variableStoreAvailable reports whether this machine can store a variable's
// value outside kaja.json.
func (s *ApiService) variableStoreAvailable() bool {
	store := s.valueStore()
	return store != nil && store.Available()
}

// InvokeApp is the one door every call goes through, whichever build it arrived on.
// The reserved header names the app the call belongs to and goes no further. The
// ${NAME} references the client left in the rest are expanded here — the client sends
// them unexpanded, because a variable's value may be one it is not allowed to know —
// and the app's own parameters, credential and transport security are read from the
// workspace as it stands now rather than held from Open, so replacing a token takes
// effect on the next call instead of the next compile, whatever the app's type.
//
// Coming back, every resolved value is masked out of the headers the app reports
// exchanging upstream, so no value kaja.json doesn't carry can reach the client, and
// the call is timed here: measured at this end, the duration is server-side time with
// nothing of the trip between the UI and this process in it, which is why an app never
// fills one in itself.
func (s *ApiService) InvokeApp(ctx context.Context, method string, message []byte, headers map[string]string) (apps.Stream, error) {
	name := apps.TakeAppName(headers)
	snapshot := s.snapshot()
	resolver := snapshot.resolver
	connection := snapshot.connection(name)
	expanded := resolver.ExpandAll(headers)
	entry := callLog{method: method, app: name, expanded: expandedNames(headers, expanded)}

	call := &apps.Call{
		Method:     method,
		Request:    message,
		Headers:    apps.MergeMetadata(expanded, connection.Metadata),
		TLS:        connection.TLS,
		Parameters: connection.Parameters,
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
	// failure is what ended the stream, held for the line: a call that fails after it
	// has started answering fails at Recv, and the report the line is written from
	// says nothing about it.
	failure error
}

func (s *timedStream) Recv() ([]byte, error) {
	message, err := s.stream.Recv()
	if err != nil && !errors.Is(err, io.EOF) {
		s.failure = err
	}
	return message, err
}

func (s *timedStream) Report() *apps.Report {
	report := s.stream.Report()
	if report == nil {
		report = &apps.Report{}
	}
	report.DurationMs = time.Since(s.started).Milliseconds()
	report.RequestHeaders = s.resolver.Redact(report.RequestHeaders, s.sent)
	s.log.write(report.DurationMs, s.failure)
	return report
}

// Compile opens an app and compiles its surface in one call, streaming the result:
// every log line as it is written, then one last message carrying the terminal status
// and, on a success, the manifest. Opening registers the instance under the app's
// name, which is the address every call carries.
//
// A surface this process has compiled before is reused rather than read again: the
// key is everything the surface was compiled from, and a reused instance is handed the
// call's own parameters on every call, so nothing about the app that may have changed
// since is held by it. Recompile asks with fresh, which reads the upstream again.
func (s *ApiService) Compile(req *CompileRequest, stream grpc.ServerStreamingServer[CompileResponse]) error {
	ctx := stream.Context()
	var sendErr error
	send := func(response *CompileResponse) {
		if sendErr == nil {
			sendErr = stream.Send(response)
		}
	}
	logger := NewStreamingLogger(func(log *Log) {
		send(&CompileResponse{Status: CompileStatus_STATUS_RUNNING, Logs: []*Log{log}})
	})
	// The failure was logged as it happened, so the last message is the verdict and
	// nothing else.
	fail := func() error {
		send(&CompileResponse{Status: CompileStatus_STATUS_ERROR})
		return sendErr
	}

	if req.App == nil {
		logger.error("No app to compile", nil)
		return fail()
	}
	appType, parameters := flattenApp(req.App)
	if appType == "" {
		logger.error(fmt.Sprintf("App %q has no type set. Use one of grpc, twirp, openapi, openai, folder, mcp.", req.App.Name), nil)
		return fail()
	}
	logger.info("Opening app: " + appType)

	// Expand ${NAME} variable references in the creation parameters (URLs,
	// tokens, ...) from the variables configured in kaja.json.
	expandAppParameters(parameters, s.Variables(), logger)
	resolveWorkspacePaths(parameters, s.WorkspaceDir())

	key := compileKey(appType, parameters)
	if !req.Fresh {
		if compiled, ok := s.compiled.get(key); ok {
			s.apps.Register(req.App.Name, compiled.opened.Instance)
			logger.info("Reused the surface compiled earlier for this app; recompile to read it again")
			send(&CompileResponse{Status: CompileStatus_STATUS_READY, Manifest: compiled.manifest})
			return sendErr
		}
	}

	protoDir := ""
	if needsSourcesDir(appType, parameters) {
		dir, err := tempdir.NewSourcesDir()
		if err != nil {
			logger.error("Failed to create temp directory", err)
			return fail()
		}
		protoDir = dir
	}

	opened, err := s.apps.Instantiate(ctx, appType, parameters, protoDir, func(message string) {
		logger.info(message)
	})
	if err != nil {
		logger.error("Failed to open app", err)
		return fail()
	}
	dir := opened.ProtoDir
	if dir == "" {
		dir = protoDir
	}

	manifest, err := NewCompiler(logger).run(resolveWorkspacePath(s.WorkspaceDir(), dir))
	if err != nil {
		apps.CloseInstance(opened.Instance)
		return fail()
	}

	s.compiled.put(key, &compiledApp{opened: opened, manifest: manifest})
	s.apps.Register(req.App.Name, opened.Instance)
	send(&CompileResponse{Status: CompileStatus_STATUS_READY, Manifest: manifest})
	return sendErr
}

// RenameApp follows an app's rename into the open apps, so the instance keeps
// answering under the name every call now carries. The window remaps the surface it
// has already compiled rather than compiling it again, and this is the other half of
// that: without it the app is open under a name nothing asks for any more and every
// call is refused until something recompiles it.
func (s *ApiService) RenameApp(ctx context.Context, req *RenameAppRequest) (*RenameAppResponse, error) {
	if req.OldName == "" || req.NewName == "" {
		return nil, fmt.Errorf("old_name and new_name are required")
	}

	s.apps.Rename(req.OldName, req.NewName)

	return &RenameAppResponse{}, nil
}

// AppConnection is how an app reaches its upstream as the workspace stands when the
// call is made: its parameters, expanded and path-resolved, and for a grpc app the
// credential it sends with every call and the transport security it uses. Read from
// the workspace rather than held from Open, so replacing a token takes effect on the
// next call instead of the next compile.
type AppConnection struct {
	Parameters map[string]string
	Metadata   map[string]string
	TLS        pkggrpc.TLSOptions
}

func (snapshot *workspaceSnapshot) connection(name string) AppConnection {
	entry, ok := snapshot.apps[name]
	if !ok {
		return AppConnection{}
	}
	return AppConnection{Parameters: entry.parameters, Metadata: entry.metadata, TLS: entry.tls}
}

// InspectGrpc reads the surface a grpc app would be opened with - reflecting the
// server, or reading the proto directory - without creating the app, so the New
// gRPC app form can fill itself in from what answered.
func (s *ApiService) InspectGrpc(ctx context.Context, req *InspectGrpcRequest) (*InspectGrpcResponse, error) {
	if req.Grpc == nil {
		return nil, fmt.Errorf("grpc app is required")
	}

	_, parameters := flattenApp(&WorkspaceApp{App: &WorkspaceApp_Grpc{Grpc: req.Grpc}})
	expandAppParameters(parameters, s.Variables(), NewLogger())
	resolveWorkspacePaths(parameters, s.WorkspaceDir())

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

	_, parameters := flattenApp(&WorkspaceApp{App: &WorkspaceApp_Mcp{Mcp: req.Mcp}})
	expandAppParameters(parameters, s.Variables(), NewLogger())

	surface, problem := mcp.Inspect(ctx, parameters, s.mcpAuthorizer)
	if problem != nil {
		return &InspectMcpResponse{Problem: &McpProblem{
			Kind:    mcpProblemKind(problem.Kind),
			Message: problem.Message,
			Detail:  problem.Detail,
		}}, nil
	}

	return &InspectMcpResponse{Server: describeMcpServer(surface)}, nil
}

// AuthorizeMcp signs kaja in to the server an app names. The stream is the flow:
// the page to open goes out first and on its own, because nothing can happen
// until somebody opens it, and the verdict follows once the sign-in has been
// finished there - by the authorization server sending them back to the loopback
// address kaja is listening on, or by the code it sent them off with being
// entered.
func (s *ApiService) AuthorizeMcp(req *AuthorizeMcpRequest, stream grpc.ServerStreamingServer[AuthorizeMcpResponse]) error {
	if req.Mcp == nil {
		return fmt.Errorf("mcp app is required")
	}
	if s.mcpAuthorizer == nil {
		return stream.Send(&AuthorizeMcpResponse{Problem: &McpProblem{
			Kind:    McpProblemKind_MCP_PROBLEM_AUTHORIZATION,
			Message: "This kaja serves its workspace read-only, so it has nowhere to keep a sign-in.",
		}})
	}

	prompt, done, err := s.mcpAuthorizer.Begin(s.mcpAuthorization(req.Mcp))
	if err != nil {
		return stream.Send(&AuthorizeMcpResponse{Problem: authorizationProblem(err)})
	}
	if err := stream.Send(&AuthorizeMcpResponse{AuthorizationUrl: prompt.URL, UserCode: prompt.UserCode}); err != nil {
		s.mcpAuthorizer.Cancel(done)
		return err
	}

	if err := s.mcpAuthorizer.Wait(stream.Context(), done); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			// The window went away. There is nobody left to answer.
			return nil
		}
		return stream.Send(&AuthorizeMcpResponse{Problem: authorizationProblem(err)})
	}
	return stream.Send(&AuthorizeMcpResponse{Authorized: true})
}

// ForgetMcpAuthorization drops the token kaja holds for a server.
func (s *ApiService) ForgetMcpAuthorization(ctx context.Context, req *ForgetMcpAuthorizationRequest) (*ForgetMcpAuthorizationResponse, error) {
	if req.Mcp == nil {
		return nil, fmt.Errorf("mcp app is required")
	}
	if s.mcpAuthorizer == nil {
		return &ForgetMcpAuthorizationResponse{}, nil
	}
	if err := s.mcpAuthorizer.Forget(s.Variables().Expand(req.Mcp.Url)); err != nil {
		return nil, err
	}
	return &ForgetMcpAuthorizationResponse{}, nil
}

// mcpAuthorization is the app's half of a sign-in, with its variables resolved:
// the same endpoint and headers the app would be opened with, since a server
// guarding its metadata guards it against an unconfigured request too.
func (s *ApiService) mcpAuthorization(app *McpApp) mcp.AppAuthorization {
	resolver := s.Variables()
	return mcp.AppAuthorization{
		Endpoint: resolver.Expand(app.Url),
		Headers:  resolver.ExpandAll(app.Headers),
		ClientID: resolver.Expand(app.ClientId),
		Scope:    resolver.Expand(app.Scope),
	}
}

// authorizationProblem is a sign-in that did not happen, said the way the form
// says every other failure: one line, and the error under it. The line names the
// step and nothing else, because which step it was is all it can say before the
// error under it says what happened.
func authorizationProblem(err error) *McpProblem {
	return &McpProblem{
		Kind:    McpProblemKind_MCP_PROBLEM_AUTHORIZATION,
		Message: "The sign-in failed.",
		Detail:  err.Error(),
	}
}

var mcpProblemKinds = map[mcp.ProblemKind]McpProblemKind{
	mcp.ProblemTarget:       McpProblemKind_MCP_PROBLEM_TARGET,
	mcp.ProblemUnreachable:  McpProblemKind_MCP_PROBLEM_UNREACHABLE,
	mcp.ProblemTimeout:      McpProblemKind_MCP_PROBLEM_TIMEOUT,
	mcp.ProblemUnauthorized: McpProblemKind_MCP_PROBLEM_UNAUTHORIZED,
	mcp.ProblemSignIn:       McpProblemKind_MCP_PROBLEM_SIGN_IN,
	mcp.ProblemForbidden:    McpProblemKind_MCP_PROBLEM_FORBIDDEN,
	mcp.ProblemHTTPError:    McpProblemKind_MCP_PROBLEM_HTTP_ERROR,
	mcp.ProblemNotMCP:       McpProblemKind_MCP_PROBLEM_NOT_MCP,
	mcp.ProblemEmpty:        McpProblemKind_MCP_PROBLEM_EMPTY,
	mcp.ProblemUnresolved:   McpProblemKind_MCP_PROBLEM_UNRESOLVED,
	mcp.ProblemLegacySSE:    McpProblemKind_MCP_PROBLEM_LEGACY_SSE,
}

func mcpProblemKind(kind mcp.ProblemKind) McpProblemKind {
	return mcpProblemKinds[kind]
}

func describeMcpServer(surface *mcp.Surface) *McpServer {
	// The title is the name meant for a person, where the name is a handle.
	name := surface.ServerInfo.Title
	if name == "" {
		name = surface.ServerInfo.Name
	}
	return &McpServer{
		Name:                  name,
		Version:               surface.ServerInfo.Version,
		ProtocolVersion:       surface.ProtocolVersion,
		Handshake:             surface.Legacy,
		SupportedVersions:     surface.SupportedVersions,
		ToolCount:             int32(len(surface.Tools)),
		ResourceCount:         int32(len(surface.Resources)),
		ResourceTemplateCount: int32(len(surface.ResourceTemplates)),
		PromptCount:           int32(len(surface.Prompts)),
	}
}

// InspectOpenApi reads an OpenAPI document without creating an app, so the New
// OpenAPI app form can fill itself in from what the document declares.
func (s *ApiService) InspectOpenApi(ctx context.Context, req *InspectOpenApiRequest) (*InspectOpenApiResponse, error) {
	if req.Openapi == nil {
		return nil, fmt.Errorf("openapi app is required")
	}

	_, parameters := flattenApp(&WorkspaceApp{App: &WorkspaceApp_Openapi{Openapi: req.Openapi}})
	expandAppParameters(parameters, s.Variables(), NewLogger())

	document, problem := openapi.Inspect(ctx, parameters, func(message string) { slog.Info(message) })
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

func (s *ApiService) GetWorkspace(ctx context.Context, req *GetWorkspaceRequest) (*GetWorkspaceResponse, error) {
	slog.Debug("Getting workspace")

	return s.workspaceResponse(), nil
}

// WatchWorkspace streams the workspace as it stands, one message per change carrying
// the whole of what GetWorkspace answers with. The first message is the current state,
// so a stream opened after a change the window was away for carries it; the generation
// on every message is what lets the window tell that from a state it already holds.
// The stream ends when the watcher does - another workspace was opened - and a window
// opens a new one.
func (s *ApiService) WatchWorkspace(req *WatchWorkspaceRequest, stream grpc.ServerStreamingServer[GetWorkspaceResponse]) error {
	// Buffered by one and dropped when full: a burst of writes is one change to report,
	// and the report is the file as it stands by the time it is read.
	changed := make(chan struct{}, 1)
	unsubscribe, closed := s.watchWorkspaceFile(func() {
		select {
		case changed <- struct{}{}:
		default:
		}
	})
	defer unsubscribe()

	if err := stream.Send(s.workspaceResponse()); err != nil {
		return err
	}

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case <-closed:
			return nil
		case <-changed:
			if err := stream.Send(s.workspaceResponse()); err != nil {
				return err
			}
		}
	}
}

// workspaceResponse is the file plus the runtime it is being served by, which is
// what both doors to the workspace answer with. The variables travel as kaja.json
// writes them - a literal value, or the source that holds it ("${secret}", "${env:X}").
// A value this machine resolved from a source is never part of the response.
func (s *ApiService) workspaceResponse() *GetWorkspaceResponse {
	response := s.snapshot().response()

	response.Runtime = &Runtime{
		CanUpdateWorkspace:     s.canUpdateWorkspace,
		GitRef:                 s.gitRef,
		BuildNumber:            s.buildNumber,
		VariableStoreAvailable: s.variableStoreAvailable(),
		WorkspaceDir:           s.WorkspaceDir(),
	}

	return response
}

// ensureWatcher starts the file watcher for the current workspace file, with the
// snapshot's invalidation as its first subscriber. Called with snapshotMu held, which
// is the one order the two locks are ever taken in.
func (s *ApiService) ensureWatcher() *WorkspaceWatcher {
	s.watcherMu.Lock()
	defer s.watcherMu.Unlock()

	if s.watcher == nil {
		path := s.workspaceFilePath()
		watcher, err := NewWorkspaceWatcher(path)
		if err != nil {
			slog.Warn("Failed to start workspace watcher", "path", path, "error", err)
			return nil
		}
		watcher.Subscribe(s.invalidateSnapshot)
		s.watcher = watcher
	}
	return s.watcher
}

// watchWorkspaceFile subscribes to the workspace file and hands back the way to stop
// and the channel that closes when the watcher itself does.
func (s *ApiService) watchWorkspaceFile(onChange func()) (func(), <-chan struct{}) {
	s.watcherMu.Lock()
	watcher := s.watcher
	s.watcherMu.Unlock()
	if watcher == nil {
		// Reading the snapshot starts the watcher, since a snapshot is what the
		// watcher exists to invalidate.
		s.snapshot()
		s.watcherMu.Lock()
		watcher = s.watcher
		s.watcherMu.Unlock()
	}
	if watcher == nil {
		closed := make(chan struct{})
		close(closed)
		return func() {}, closed
	}
	return watcher.Subscribe(onChange), watcher.Done()
}

// Close stops watching the workspace file.
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

func (s *ApiService) UpdateWorkspace(ctx context.Context, req *UpdateWorkspaceRequest) (*UpdateWorkspaceResponse, error) {
	if req.Workspace == nil {
		return nil, fmt.Errorf("workspace is required")
	}

	if err := s.MutateWorkspace(func(workspace *Workspace) error {
		proto.Reset(workspace)
		proto.Merge(workspace, req.Workspace)
		return nil
	}); err != nil {
		return nil, err
	}

	return &UpdateWorkspaceResponse{
		Workspace:      req.Workspace,
		VariableStatus: s.Variables().Statuses(),
	}, nil
}

// MutateWorkspace applies one edit to kaja.json under the write lock: the file is
// read, edited, validated and written as one step, so two edits made at once - an
// agent adding an app while the window saves a variable - each see the other's work.
// The snapshot is dropped on the way out, so the next call reads what was written.
func (s *ApiService) MutateWorkspace(edit func(workspace *Workspace) error) error {
	if !s.canUpdateWorkspace {
		return fmt.Errorf("updating workspace is not allowed")
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	workspace := proto.Clone(s.snapshot().workspace).(*Workspace)
	if err := edit(workspace); err != nil {
		return err
	}
	if err := validateVariables(workspace.Variables); err != nil {
		return err
	}

	slog.Info("Updating workspace")
	if err := SaveWorkspace(s.workspaceFilePath(), workspace); err != nil {
		return fmt.Errorf("failed to save workspace: %w", err)
	}
	s.invalidateSnapshot()
	return nil
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

	if err := s.valueStore().Set(req.Name, req.Value); err != nil {
		return nil, fmt.Errorf("failed to store the value for %q: %w", req.Name, err)
	}
	s.invalidateSnapshot()

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
		if err := s.valueStore().Delete(req.Name); err != nil {
			return nil, fmt.Errorf("failed to clear the value for %q: %w", req.Name, err)
		}
		s.invalidateSnapshot()
	}

	return &StoredValueResponse{VariableStatus: s.Variables().Statuses()}, nil
}

func (s *ApiService) checkStoredValueAllowed(name string) error {
	if !s.canUpdateWorkspace {
		return fmt.Errorf("updating workspace is not allowed")
	}
	if !variableNamePattern.MatchString(name) {
		return fmt.Errorf("variable name %q must start with a letter or underscore and contain only letters, numbers and underscores", name)
	}
	return nil
}

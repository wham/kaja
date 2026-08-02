package api

import (
	"context"
	fmt "fmt"
	"log/slog"
	"sync"

	"github.com/wham/kaja/v2/internal/tempdir"
	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/kaja/v2/pkg/apps/markdown"
	"github.com/wham/kaja/v2/pkg/apps/openai"
	"github.com/wham/kaja/v2/pkg/apps/openapi"
	"github.com/wham/kaja/v2/pkg/apps/rpc"
)

type ApiService struct {
	compilers              sync.Map // map[string]*Compiler - keyed by ID
	configurationPath      string
	canUpdateConfiguration bool
	gitRef                 string
	buildNumber            string
	apps                   *apps.Manager
}

func NewApiService(configurationPath string, canUpdateConfiguration bool, gitRef string, buildNumber string) *ApiService {
	tempdir.StartCleanup()

	return &ApiService{
		configurationPath:      configurationPath,
		canUpdateConfiguration: canUpdateConfiguration,
		gitRef:                 gitRef,
		buildNumber:            buildNumber,
		apps: apps.NewManager(map[string]apps.App{
			"grpc":     rpc.New("grpc"),
			"twirp":    rpc.New("twirp"),
			"openapi":  openapi.New(),
			"openai":   openai.New(),
			"markdown": markdown.New(),
		}),
	}
}

// Apps returns the app manager, used by the request router to invoke methods on
// opened app instances.
func (s *ApiService) Apps() *apps.Manager {
	return s.apps
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
	variables := loadConfigurationFile(s.configurationPath, NewLogger()).Variables
	expandAppParameters(parameters, variables, logger)

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

// InspectOpenApi reads an OpenAPI document without creating an app, so the New
// OpenAPI app form can fill itself in from what the document declares.
func (s *ApiService) InspectOpenApi(ctx context.Context, req *InspectOpenApiRequest) (*InspectOpenApiResponse, error) {
	if req.Openapi == nil {
		return nil, fmt.Errorf("openapi app is required")
	}

	_, parameters := flattenApp(&ConfigurationApp{App: &ConfigurationApp_Openapi{Openapi: req.Openapi}})
	variables := loadConfigurationFile(s.configurationPath, NewLogger()).Variables
	expandAppParameters(parameters, variables, NewLogger())

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

	response := LoadGetConfigurationResponse(s.configurationPath, s.canUpdateConfiguration)

	system := response.Configuration.System
	if system == nil {
		system = &ConfigurationSystem{}
	}
	system.GitRef = s.gitRef
	system.BuildNumber = s.buildNumber

	configuration := &Configuration{
		PathPrefix: response.Configuration.PathPrefix,
		Apps:       response.Configuration.Apps,
		System:     system,
		Variables:  response.Configuration.Variables,
	}

	return &GetConfigurationResponse{
		Configuration: configuration,
		Logs:          response.Logs,
	}, nil
}

func (s *ApiService) UpdateConfiguration(ctx context.Context, req *UpdateConfigurationRequest) (*UpdateConfigurationResponse, error) {
	if req.Configuration == nil {
		return nil, fmt.Errorf("configuration is required")
	}

	currentResponse := LoadGetConfigurationResponse(s.configurationPath, s.canUpdateConfiguration)

	// Enforce the effective flag, which honors both the constructor value and the
	// file-based dev override (system.canUpdateConfiguration) - the same value
	// GetConfiguration reports to the UI to gate config editing.
	system := currentResponse.Configuration.System
	if system == nil || !system.CanUpdateConfiguration {
		return nil, fmt.Errorf("updating configuration is not allowed")
	}

	slog.Info("Updating configuration")

	req.Configuration.System = system

	if err := SaveConfiguration(s.configurationPath, req.Configuration); err != nil {
		return nil, fmt.Errorf("failed to save configuration: %w", err)
	}

	return &UpdateConfigurationResponse{
		Configuration: req.Configuration,
	}, nil
}

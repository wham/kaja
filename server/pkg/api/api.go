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
	valueAsJsonProtoDirs   sync.Map // map[string]bool - proto dirs that opt into value_as_json codegen (OpenAPI apps)
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
		// OpenAPI apps render google.protobuf.Value fields as plain JSON. OpenApp
		// recorded the proto dir when it opened such an app.
		compiler.pluginParameter = ""
		if _, ok := s.valueAsJsonProtoDirs.Load(req.ProtoDir); ok {
			compiler.pluginParameter = "value_as_json"
		}
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

	// The OpenAPI app maps free-form/mixed schemas to google.protobuf.Value. Remember
	// its proto dir so the follow-up Compile renders those fields as plain JsonValue.
	if appType == "openapi" {
		s.valueAsJsonProtoDirs.Store(result.ProtoDir, true)
	}

	return &OpenAppResponse{
		Status:   OpenStatus_OPEN_STATUS_OK,
		Logs:     logger.logs,
		ProtoDir: result.ProtoDir,
		Target:   result.Target,
		Protocol: result.Protocol,
	}, nil
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

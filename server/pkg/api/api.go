package api

import (
	"context"
	fmt "fmt"
	"log/slog"
	"sync"

	"github.com/wham/kaja/v2/internal/ui"
)

type ApiService struct {
	compilers              sync.Map // map[string]*Compiler
	configurationPath      string
	canUpdateConfiguration bool
}

func NewApiService(configurationPath string, canUpdateConfiguration bool) *ApiService {
	return &ApiService{
		configurationPath:      configurationPath,
		canUpdateConfiguration: canUpdateConfiguration,
	}
}

func (s *ApiService) Compile(ctx context.Context, req *CompileRequest) (*CompileResponse, error) {
	if req.ProjectName == "" {
		return nil, fmt.Errorf("project name is required")
	}

	compiler := s.getOrCreateCompiler(req.ProjectName)
	compiler.mu.Lock()
	defer compiler.mu.Unlock()

	// Ensure logger is always initialized
	if compiler.logger == nil {
		compiler.logger = NewLogger()
	}

	if compiler.status != CompileStatus_STATUS_RUNNING && req.LogOffset == 0 {
		compiler.status = CompileStatus_STATUS_RUNNING
		compiler.logger = NewLogger()
		compiler.sources = []*Source{}
		compiler.logger.info("Starting compilation")
		go compiler.start(req.ProjectName, req.Workspace, req.Force)
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
	}, nil
}

func (s *ApiService) GetConfiguration(ctx context.Context, req *GetConfigurationRequest) (*GetConfigurationResponse, error) {
	slog.Info("Getting configuration")

	// Re-read configuration from file and re-evaluate env vars on each call
	response := LoadGetConfigurationResponse(s.configurationPath, s.canUpdateConfiguration)

	// Redact the API key before returning to the UI
	configuration := &Configuration{
		PathPrefix: response.Configuration.PathPrefix,
		Projects:   response.Configuration.Projects,
		Ai: &ConfigurationAI{
			BaseUrl: response.Configuration.Ai.BaseUrl,
			ApiKey:  "*****",
		},
		System: response.Configuration.System,
	}

	return &GetConfigurationResponse{
		Configuration: configuration,
		Logs:          response.Logs,
	}, nil
}

func (s *ApiService) GetStub(ctx context.Context, req *GetStubRequest) (*GetStubResponse, error) {
	if req.ProjectName == "" {
		return nil, fmt.Errorf("project name is required")
	}

	stub, err := ui.BuildStub(req.ProjectName)

	if err != nil {
		return nil, err
	}

	return &GetStubResponse{
		Stub: string(stub),
	}, nil
}

func (s *ApiService) getOrCreateCompiler(projectName string) *Compiler {
	newCompiler := NewCompiler()
	compiler, _ := s.compilers.LoadOrStore(projectName, newCompiler)
	return compiler.(*Compiler)
}

func (s *ApiService) UpdateConfiguration(ctx context.Context, req *UpdateConfigurationRequest) (*UpdateConfigurationResponse, error) {
	if req.Configuration == nil {
		return nil, fmt.Errorf("configuration is required")
	}

	slog.Info("Updating configuration")

	// Read current configuration to get system settings (which should be preserved)
	currentResponse := LoadGetConfigurationResponse(s.configurationPath, s.canUpdateConfiguration)

	// Preserve system settings from current configuration (ignore what client sends)
	req.Configuration.System = currentResponse.Configuration.System

	if err := SaveConfiguration(s.configurationPath, req.Configuration); err != nil {
		return nil, fmt.Errorf("failed to save configuration: %w", err)
	}

	return &UpdateConfigurationResponse{
		Configuration: req.Configuration,
	}, nil
}

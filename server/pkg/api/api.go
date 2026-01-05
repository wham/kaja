package api

import (
	"context"
	fmt "fmt"
	"log/slog"

	"github.com/wham/kaja/v2/internal/tempdir"
)

type ApiService struct {
	compiler               *Compiler
	configurationPath      string
	canUpdateConfiguration bool
}

func NewApiService(configurationPath string, canUpdateConfiguration bool) *ApiService {
	tempdir.StartCleanup()

	return &ApiService{
		compiler:               NewCompiler(),
		configurationPath:      configurationPath,
		canUpdateConfiguration: canUpdateConfiguration,
	}
}

func (s *ApiService) Compile(ctx context.Context, req *CompileRequest) (*CompileResponse, error) {
	if req.Workspace == "" {
		return nil, fmt.Errorf("workspace is required")
	}

	s.compiler.mu.Lock()
	defer s.compiler.mu.Unlock()

	if s.compiler.logger == nil {
		s.compiler.logger = NewLogger()
	}

	if s.compiler.status != CompileStatus_STATUS_RUNNING && req.LogOffset == 0 {
		s.compiler.status = CompileStatus_STATUS_RUNNING
		s.compiler.logger = NewLogger()
		s.compiler.sources = []*Source{}
		s.compiler.logger.info("Starting compilation")
		go s.compiler.start(req.Workspace)
	}

	logOffset := int(req.LogOffset)
	if logOffset > len(s.compiler.logger.logs)-1 {
		logOffset = len(s.compiler.logger.logs) - 1
	}

	logs := []*Log{}
	if int(req.LogOffset) < len(s.compiler.logger.logs) {
		logs = s.compiler.logger.logs[logOffset:]
	}

	return &CompileResponse{
		Status:  s.compiler.status,
		Logs:    logs,
		Sources: s.compiler.sources,
		Stub:    s.compiler.stub,
	}, nil
}

func (s *ApiService) GetConfiguration(ctx context.Context, req *GetConfigurationRequest) (*GetConfigurationResponse, error) {
	slog.Info("Getting configuration")

	response := LoadGetConfigurationResponse(s.configurationPath, s.canUpdateConfiguration)

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

func (s *ApiService) UpdateConfiguration(ctx context.Context, req *UpdateConfigurationRequest) (*UpdateConfigurationResponse, error) {
	if req.Configuration == nil {
		return nil, fmt.Errorf("configuration is required")
	}

	slog.Info("Updating configuration")

	currentResponse := LoadGetConfigurationResponse(s.configurationPath, s.canUpdateConfiguration)

	req.Configuration.System = currentResponse.Configuration.System

	if err := SaveConfiguration(s.configurationPath, req.Configuration); err != nil {
		return nil, fmt.Errorf("failed to save configuration: %w", err)
	}

	return &UpdateConfigurationResponse{
		Configuration: req.Configuration,
	}, nil
}

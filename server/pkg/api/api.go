package api

import (
	"context"
	fmt "fmt"
	"log/slog"
	"sync"

	"github.com/wham/kaja/v2/internal/ui"
)

type ApiService struct {
	compilers                sync.Map // map[string]*Compiler
	getConfigurationResponse *GetConfigurationResponse
	configPath               string
}

func NewApiService(getConfigurationResponse *GetConfigurationResponse, configPath string) *ApiService {
	return &ApiService{
		getConfigurationResponse: getConfigurationResponse,
		configPath:               configPath,
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
	// This is bad. Find a better way to redact the token. It should not be exposed to the UI.
	config := &Configuration{
		PathPrefix: s.getConfigurationResponse.Configuration.PathPrefix,
		Projects:   s.getConfigurationResponse.Configuration.Projects,
		Ai: &ConfigurationAI{
			BaseUrl: s.getConfigurationResponse.Configuration.Ai.BaseUrl,
			ApiKey:  "*****",
		},
	}

	return &GetConfigurationResponse{
		Configuration: config,
		Logs:          s.getConfigurationResponse.Logs,
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

func (s *ApiService) AddOrUpdateConfigurationProject(ctx context.Context, req *AddOrUpdateConfigurationProjectRequest) (*AddOrUpdateConfigurationProjectResponse, error) {
	slog.Info("Adding or updating configuration project", "name", req.Project.Name)

	if req.Project == nil || req.Project.Name == "" {
		return nil, fmt.Errorf("project with name is required")
	}

	config := s.getConfigurationResponse.Configuration

	// Find existing project by name and update, or append new project
	found := false
	for i, p := range config.Projects {
		if p.Name == req.Project.Name {
			config.Projects[i] = req.Project
			found = true
			break
		}
	}
	if !found {
		config.Projects = append(config.Projects, req.Project)
	}

	// Save to file
	if err := SaveConfiguration(s.configPath, config); err != nil {
		return nil, fmt.Errorf("failed to save configuration: %w", err)
	}

	return &AddOrUpdateConfigurationProjectResponse{
		Configuration: config,
	}, nil
}

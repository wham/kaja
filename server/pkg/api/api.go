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
	workspace                string
}

func NewApiService(getConfigurationResponse *GetConfigurationResponse) *ApiService {
	return &ApiService{
		getConfigurationResponse: getConfigurationResponse,
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

// SetWorkspace sets the workspace directory for the service
func (s *ApiService) SetWorkspace(workspace string) {
	s.workspace = workspace
}

// UpdateConfiguration updates the configuration
func (s *ApiService) UpdateConfiguration(getConfigurationResponse *GetConfigurationResponse) {
	s.getConfigurationResponse = getConfigurationResponse
}

// CompileProject triggers compilation for a specific project
func (s *ApiService) CompileProject(projectName string) error {
	// Find the project in configuration
	var project *ConfigurationProject
	for _, p := range s.getConfigurationResponse.Configuration.Projects {
		if p.Name == projectName {
			project = p
			break
		}
	}
	
	if project == nil {
		return fmt.Errorf("project %s not found in configuration", projectName)
	}
	
	// Get or create compiler for the project
	compiler := s.getOrCreateCompiler(projectName)
	compiler.mu.Lock()
	defer compiler.mu.Unlock()
	
	// Initialize logger if needed
	if compiler.logger == nil {
		compiler.logger = NewLogger()
	}
	
	// Start compilation if not already running
	if compiler.status != CompileStatus_STATUS_RUNNING {
		compiler.status = CompileStatus_STATUS_RUNNING
		compiler.logger = NewLogger()
		compiler.sources = []*Source{}
		compiler.logger.info("Starting compilation for project: " + projectName)
		
		// Use the project's workspace if set, otherwise use default
		workspace := project.Workspace
		if workspace == "" {
			workspace = s.workspace
		}
		
		go compiler.start(projectName, workspace, true)
	}
	
	return nil
}

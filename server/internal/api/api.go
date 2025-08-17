package api

import (
	"context"
	fmt "fmt"
	"sync"

	"github.com/wham/kaja/v2/internal/ui"
)

type ApiService struct {
	compilers                sync.Map // map[string]*Compiler
	getConfigurationResponse *GetConfigurationResponse
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

	if compiler.status != CompileStatus_STATUS_RUNNING && req.LogOffset == 0 {
		compiler.status = CompileStatus_STATUS_RUNNING
		compiler.logger = NewLogger()
		compiler.sources = []string{}
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
	compiler, _ := s.compilers.LoadOrStore(projectName, NewCompiler())
	return compiler.(*Compiler)
}

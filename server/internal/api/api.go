package api

import (
	"context"
	fmt "fmt"
	"sync"
)

// Type definitions
type ApiService struct {
	compilers  sync.Map // map[string]*Compiler
	configPath string
}

// Public constructors/methods
func NewApiService(configPath string) *ApiService {
	return &ApiService{
		configPath: configPath,
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
	return LoadGetConfigurationResponse(s.configPath), nil
}

func (s *ApiService) getOrCreateCompiler(projectName string) *Compiler {
	compiler, _ := s.compilers.LoadOrStore(projectName, NewCompiler())
	return compiler.(*Compiler)
}

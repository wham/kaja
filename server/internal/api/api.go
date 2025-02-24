package api

import (
	"context"
	fmt "fmt"
	io "io"
	"os"
	"sync"

	protojson "google.golang.org/protobuf/encoding/protojson"
)

type ApiService struct {
	compilers sync.Map // map[string]*Compiler
}

func NewApiService() *ApiService {
	return &ApiService{}
}

func (s *ApiService) getOrCreateCompiler(projectName string) *Compiler {
	compiler, _ := s.compilers.LoadOrStore(projectName, NewCompiler())
	return compiler.(*Compiler)
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
		compiler.logs = []*Log{}
		compiler.sources = []string{}
		compiler.info("Starting compilation")
		go compiler.start(req.ProjectName, req.Workspace, req.Force)
	}

	logOffset := int(req.LogOffset)
	if logOffset > len(compiler.logs)-1 {
		logOffset = len(compiler.logs) - 1
	}

	logs := []*Log{}
	if int(req.LogOffset) < len(compiler.logs) {
		logs = compiler.logs[logOffset:]
	}

	return &CompileResponse{
		Status:  compiler.status,
		Logs:    logs,
		Sources: compiler.sources,
	}, nil
}

func (s *ApiService) GetConfiguration(ctx context.Context, req *GetConfigurationRequest) (*GetConfigurationResponse, error) {
	file, err := os.Open("../kaja.json")
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var config Configuration
	fileContent, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}
	if err := protojson.Unmarshal(fileContent, &config); err != nil {
		return nil, err
	}

	return &GetConfigurationResponse{Configuration: &config}, nil
}

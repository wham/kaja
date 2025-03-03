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
	compilers  sync.Map // map[string]*Compiler
	configPath string
}

func NewApiService(configPath string) *ApiService {
	return &ApiService{
		configPath: configPath,
	}
}

func (s *ApiService) getOrCreateCompiler(projectName string) *Compiler {
	compiler, _ := s.compilers.LoadOrStore(projectName, NewCompiler())
	return compiler.(*Compiler)
}

func (s *ApiService) loadConfigurationFromFile() (*Configuration, error) {
	file, err := os.Open(s.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // Return nil without error if file doesn't exist
		}
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

	return &config, nil
}

func (s *ApiService) GetConfiguration(ctx context.Context, req *GetConfigurationRequest) (*GetConfigurationResponse, error) {
	// Start with empty configuration
	config := &Configuration{
		Projects: []*ConfigurationProject{},
	}

	// Add default project if BASE_URL is set
	if baseURL := os.Getenv("BASE_URL"); baseURL != "" {
		defaultProject := &ConfigurationProject{
			Name:      "default",
			Protocol:  RpcProtocol_RPC_PROTOCOL_GRPC, // Default to GRPC
			Url:       baseURL,
			Workspace: "proto", // Default workspace
		}
		config.Projects = append([]*ConfigurationProject{defaultProject}, config.Projects...)
	}

	// Load and merge configuration from file if present
	fileConfig, err := s.loadConfigurationFromFile()
	if err != nil {
		return nil, fmt.Errorf("failed to load configuration file: %w", err)
	}
	if fileConfig != nil {
		config.Projects = append(config.Projects, fileConfig.Projects...)
	}

	return &GetConfigurationResponse{Configuration: config}, nil
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

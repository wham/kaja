package api

import (
	"context"
	fmt "fmt"
	io "io"
	"os"
	"strings"
	"sync"

	protojson "google.golang.org/protobuf/encoding/protojson"
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

func (s *ApiService) GetConfiguration(ctx context.Context, req *GetConfigurationRequest) (*GetConfigurationResponse, error) {
	logger := NewLogger()
	config := s.loadConfiguration(logger)

	if baseURL := os.Getenv("BASE_URL"); baseURL != "" {
		logger.info("BASE_URL is set, configuring project from environment variables")

		defaultProject := &ConfigurationProject{
			Name:      "default",
			Protocol:  getProtocolFromEnv(),
			Url:       baseURL,
			Workspace: "", // Default workspace
		}

		if len(config.Projects) > 0 {
			logger.warn("%d projects defined in configuration file will be ignored", len(config.Projects))
		}

		config.Projects = []*ConfigurationProject{defaultProject}
	}

	return &GetConfigurationResponse{Configuration: config, Logs: logger.logs}, nil
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

// Private methods
func (s *ApiService) getOrCreateCompiler(projectName string) *Compiler {
	compiler, _ := s.compilers.LoadOrStore(projectName, NewCompiler())
	return compiler.(*Compiler)
}

func (s *ApiService) loadConfiguration(logger *Logger) *Configuration {
	config := &Configuration{
		Projects: []*ConfigurationProject{},
	}

	logger.debug("Trying to load configuration from file %s", s.configPath)
	file, err := os.Open(s.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			logger.info("Configuration file %s not found. Only environment variables will be used.", s.configPath)
		} else {
			logger.error("Failed opening configuration file", err)
		}
		return config
	}
	defer file.Close()

	fileContent, err := io.ReadAll(file)
	if err != nil {
		logger.error("Failed to read configuration file", err)
		return config
	}
	if err := protojson.Unmarshal(fileContent, config); err != nil {
		logger.error("Failed to unmarshal configuratation file", err)
	}

	return config
}

// Standalone helper functions
func getProtocolFromEnv() RpcProtocol {
	protocol := strings.ToUpper(os.Getenv("RPC_PROTOCOL"))
	switch protocol {
	case "RPC_PROTOCOL_GRPC":
		return RpcProtocol_RPC_PROTOCOL_GRPC
	case "RPC_PROTOCOL_TWIRP":
		return RpcProtocol_RPC_PROTOCOL_TWIRP
	default:
		return RpcProtocol_RPC_PROTOCOL_TWIRP // Default to TWIRP
	}
}

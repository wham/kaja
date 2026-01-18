package api

import (
	"context"
	fmt "fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/wham/kaja/v2/internal/tempdir"
	"github.com/wham/kaja/v2/pkg/grpc"
)

type ApiService struct {
	compilers              sync.Map // map[string]*Compiler - keyed by ID
	configurationPath      string
	canUpdateConfiguration bool
}

func NewApiService(configurationPath string, canUpdateConfiguration bool) *ApiService {
	tempdir.StartCleanup()

	return &ApiService{
		configurationPath:      configurationPath,
		canUpdateConfiguration: canUpdateConfiguration,
	}
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

func (s *ApiService) Reflect(ctx context.Context, req *ReflectRequest) (*ReflectResponse, error) {
	if req.Url == "" {
		return nil, fmt.Errorf("url is required")
	}

	logger := NewLogger()
	logger.info("Starting gRPC reflection for " + req.Url)

	// Create temp directory for proto files
	protoDir, err := tempdir.NewSourcesDir()
	if err != nil {
		logger.error("Failed to create temp directory", err)
		return &ReflectResponse{
			Status: ReflectStatus_REFLECT_STATUS_ERROR,
			Logs:   logger.logs,
		}, nil
	}
	logger.debug("Proto output directory: " + protoDir)

	// Create reflection client
	client, err := grpc.NewReflectionClientFromString(req.Url)
	if err != nil {
		logger.error("Failed to create reflection client", err)
		return &ReflectResponse{
			Status: ReflectStatus_REFLECT_STATUS_ERROR,
			Logs:   logger.logs,
		}, nil
	}

	// Discover services with timeout
	discoverCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	logger.info("Connecting to server...")
	result, err := client.Discover(discoverCtx)
	if err != nil {
		logger.error("Failed to discover services", err)
		return &ReflectResponse{
			Status: ReflectStatus_REFLECT_STATUS_ERROR,
			Logs:   logger.logs,
		}, nil
	}

	logger.info(fmt.Sprintf("Discovered %d services: %v", len(result.Services), result.Services))
	logger.info(fmt.Sprintf("Retrieved %d file descriptors", len(result.FileDescriptors)))

	// Write proto files
	err = grpc.WriteProtoFiles(result, protoDir)
	if err != nil {
		logger.error("Failed to write proto files", err)
		return &ReflectResponse{
			Status: ReflectStatus_REFLECT_STATUS_ERROR,
			Logs:   logger.logs,
		}, nil
	}

	logger.info("Proto files written to " + protoDir)

	return &ReflectResponse{
		Status:   ReflectStatus_REFLECT_STATUS_OK,
		Logs:     logger.logs,
		ProtoDir: protoDir,
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

package api

import (
	"bytes"
	"context"
	"encoding/json"
	fmt "fmt"
	"io"
	"log/slog"
	"net/http"
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

// ChatCompletions implements an OpenAI-compatible chat completions API
func (s *ApiService) ChatCompletions(ctx context.Context, req *ChatCompletionsRequest) (*ChatCompletionsResponse, error) {
	slog.Info("ChatCompletions called", "model", req.Model, "messages", len(req.Messages))

	// Load configuration to get AI settings (with actual API key)
	configResponse := LoadGetConfigurationResponse(s.configurationPath, s.canUpdateConfiguration)
	aiConfig := configResponse.Configuration.Ai

	if aiConfig == nil || aiConfig.BaseUrl == "" || aiConfig.ApiKey == "" {
		return &ChatCompletionsResponse{
			Error: "AI is not configured. Set ai.baseUrl and ai.apiKey in kaja.json or via AI_BASE_URL and AI_API_KEY environment variables.",
		}, nil
	}

	// Build OpenAI-compatible request
	openAIReq := openAIChatRequest{
		Model:       req.Model,
		Messages:    make([]openAIMessage, len(req.Messages)),
		Temperature: req.Temperature,
		TopP:        req.TopP,
		MaxTokens:   int(req.MaxTokens),
	}

	for i, msg := range req.Messages {
		openAIReq.Messages[i] = openAIMessage{
			Role:    msg.Role,
			Content: msg.Content,
		}
	}

	reqBody, err := json.Marshal(openAIReq)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Make HTTP request to OpenAI-compatible API
	url := aiConfig.BaseUrl + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+aiConfig.ApiKey)

	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		return &ChatCompletionsResponse{
			Error: fmt.Sprintf("failed to make request: %v", err),
		}, nil
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		slog.Error("AI API error", "status", resp.StatusCode, "body", string(respBody))
		return &ChatCompletionsResponse{
			Error: fmt.Sprintf("AI API error: %s", string(respBody)),
		}, nil
	}

	// Parse OpenAI response
	var openAIResp openAIChatResponse
	if err := json.Unmarshal(respBody, &openAIResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Convert to our response format
	response := &ChatCompletionsResponse{
		Id:      openAIResp.ID,
		Model:   openAIResp.Model,
		Choices: make([]*ChatChoice, len(openAIResp.Choices)),
	}

	for i, choice := range openAIResp.Choices {
		response.Choices[i] = &ChatChoice{
			Index: int32(choice.Index),
			Message: &ChatMessage{
				Role:    choice.Message.Role,
				Content: choice.Message.Content,
			},
			FinishReason: choice.FinishReason,
		}
	}

	if openAIResp.Usage != nil {
		response.Usage = &ChatUsage{
			PromptTokens:     int32(openAIResp.Usage.PromptTokens),
			CompletionTokens: int32(openAIResp.Usage.CompletionTokens),
			TotalTokens:      int32(openAIResp.Usage.TotalTokens),
		}
	}

	return response, nil
}

// OpenAI API types for JSON serialization
type openAIChatRequest struct {
	Model       string          `json:"model"`
	Messages    []openAIMessage `json:"messages"`
	Temperature float64         `json:"temperature,omitempty"`
	TopP        float64         `json:"top_p,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIChatResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Index        int           `json:"index"`
		Message      openAIMessage `json:"message"`
		FinishReason string        `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

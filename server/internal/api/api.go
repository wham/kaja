package api

import (
	"context"
	fmt "fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	strings "strings"
	"sync"
)

type ApiService struct {
	status  CompileStatus
	logs    []*Log
	sources []string
	mu      sync.Mutex
}

func NewApiService() *ApiService {
	return &ApiService{
		status: CompileStatus_STATUS_READY,
		logs:   []*Log{},
	}
}

func (s *ApiService) Compile(ctx context.Context, req *CompileRequest) (*CompileResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.status != CompileStatus_STATUS_RUNNING && req.LogOffset == 0 {
		s.status = CompileStatus_STATUS_RUNNING
		s.logs = []*Log{}
		s.sources = []string{}
		s.info("Starting compilation")
		go s.start(req.Force)
	}

	logOffset := int(req.LogOffset)
	if logOffset > len(s.logs)-1 {
		logOffset = len(s.logs) - 1
	}

	logs := []*Log{}
	if int(req.LogOffset) < len(s.logs) {
		logs = s.logs[logOffset:]
	}

	return &CompileResponse{
		Status:  s.status,
		Logs:    logs,
		Sources: s.sources,
	}, nil
}

func (s *ApiService) start(force bool) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	s.debug("cwd: " + cwd)

	sourcesDir := filepath.Join(cwd, "./web/sources")
	s.debug("sourcesDir: " + sourcesDir)

	var sources []string

	if !force {
		s.debug("Not forcing recompilation, using cached sources")
		sources = s.getSources(sourcesDir)
	}

	if force || len(sources) == 0 {
		s.debug("Starting fresh compilation")
		s.protoc(cwd, sourcesDir)
		sources = s.getSources(sourcesDir)
	}

	s.debug("Sources: " + strings.Join(sources, ", "))
	s.sources = sources

	s.status = CompileStatus_STATUS_READY

	s.info("Compilation completed successfully, kaja-twirp is ready to go")

	return nil
}

func (s *ApiService) getSources(sourcesDir string) []string {
	var sources []string

	err := filepath.Walk(sourcesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			relativePath := "sources/" + strings.TrimPrefix(path, sourcesDir+"/")
			if strings.HasSuffix(relativePath, ".ts") {
				sources = append(sources, relativePath)
			}
		}
		return nil
	})

	if err != nil {
		s.error("Failed to walk sourcesDir", err)
	}

	return sources
}

func (s *ApiService) protoc(cwd string, sourcesDir string) {
	if _, err := os.Stat(sourcesDir); err == nil {
		s.debug("Directory " + sourcesDir + " already exists, removing it")
		os.RemoveAll(sourcesDir)
	}
	os.MkdirAll(sourcesDir, os.ModePerm)

	workspaceDir := filepath.Join(cwd, "../workspace")
	if _, err := os.Stat(workspaceDir); os.IsNotExist(err) {
		workspaceDir = filepath.Join(cwd, "../demo")
	}
	s.debug("workspaceDir: " + workspaceDir)

	binDir := filepath.Join(cwd, "../bin")
	s.debug("binDir: " + binDir)

	protocCommand := "protoc --plugin=protoc-gen-ts=" + binDir + "/protoc-gen-ts --ts_out " + sourcesDir + " --ts_opt long_type_bigint -I" + workspaceDir + " $(find " + workspaceDir + " -iname \"*.proto\")"
	s.debug("Running protoc")
	s.debug(protocCommand)

	cmd := exec.Command("sh", "-c", protocCommand)
	var stderr strings.Builder
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		s.error("Failed to run protoc", err)
		s.error(stderr.String(), err)
		fmt.Printf("Failed to run protoc: %v\nStderr: %s\n", err, stderr.String())
		return
	}

	s.debug("Protoc completed successfully")
}

func (s *ApiService) debug(message string) {
	slog.Info(message)
	s.logs = append(s.logs, &Log{
		Level:   LogLevel_LEVEL_DEBUG,
		Message: message,
	})
}

func (s *ApiService) info(message string) {
	slog.Info(message)
	s.logs = append(s.logs, &Log{
		Level:   LogLevel_LEVEL_INFO,
		Message: message,
	})
}

func (s *ApiService) error(message string, err error) {
	slog.Error(message, "error", err)
	s.logs = append(s.logs, &Log{
		Level:   LogLevel_LEVEL_ERROR,
		Message: message,
	})
}

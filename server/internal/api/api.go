package api

import (
	"context"
	fmt "fmt"
	"os"
	"os/exec"
	"path/filepath"
	strings "strings"
	"sync"
)

type ApiService struct{
	status CompileStatus
	logs   []*Log
	sources []string
	mu     sync.Mutex
}

func NewApiService() *ApiService {
	return &ApiService{
		status: CompileStatus_STATUS_READY,
		logs:	 []*Log{},
	}
}

func (s *ApiService) Compile(ctx context.Context, req *CompileRequest) (*CompileResponse, error) {
    s.mu.Lock()
    defer s.mu.Unlock()

    if s.status != CompileStatus_STATUS_RUNNING && req.LogOffset == 0 {
        s.status = CompileStatus_STATUS_RUNNING
        s.logs = []*Log{}
				s.sources = []string{}
        s.info("Compile started")
        go s.start()
    }

    return &CompileResponse{
        Status: s.status,
        Logs:   s.logs[req.LogOffset:],
				Sources: s.sources,
    }, nil
}

func (s *ApiService) start() {
	s.debug("cwd: " + getCwd())
	workspaceDir := filepath.Join(getCwd(), "../workspace")
	if _, err := os.Stat(workspaceDir); os.IsNotExist(err) {
			workspaceDir = filepath.Join(getCwd(), "../demo")
	}
	binDir := filepath.Join(getCwd(), "../bin")
	outputDir := filepath.Join(getCwd(), "./web/sources")
	s.debug("workspaceDir: " + workspaceDir)
	s.debug("outputDir: " + outputDir)

	if _, err := os.Stat(outputDir); err == nil {
			s.debug("Directory " + outputDir + " already exists, removing it")
			os.RemoveAll(outputDir)
	}
	os.MkdirAll(outputDir, os.ModePerm)

	protocCommand := "protoc --plugin=protoc-gen-ts=" + binDir + "/protoc-gen-ts --ts_out " + outputDir + " --ts_opt long_type_bigint -I" + workspaceDir + " $(find " + workspaceDir + " -iname \"*.proto\")"
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

	s.info("Protoc completed successfully")

	var sources []string
	err = filepath.Walk(outputDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
					return err
			}
			if !info.IsDir() {
					relativePath := "sources/" + strings.TrimPrefix(path, outputDir+ "/")
        	sources = append(sources, relativePath)
			}
			return nil
	})
	if err != nil {
			s.error("Failed to scan outputDir", err)
			return
	}

	s.info("Sources: " + strings.Join(sources, ", "))
	s.sources = sources

	s.status = CompileStatus_STATUS_READY
}

func (s *ApiService) info(message string) {
    s.logs = append(s.logs, &Log{
        Level:   LogLevel_LEVEL_INFO,
        Message: message,
    })
}

func (s *ApiService) debug(message string) {
    s.logs = append(s.logs, &Log{
        Level:   LogLevel_LEVEL_DEBUG,
        Message: message,
    })
}

func (s *ApiService) error(message string, err error) {
	fmt.Println(message)
	if err != nil {
		fmt.Println(err.Error())
	}
	
	s.logs = append(s.logs, &Log{
			Level:   LogLevel_LEVEL_ERROR,
			Message: message,
	})
}

func getCwd() string {
    dir, err := os.Getwd()
    if err != nil {
        return ""
    }
    return dir
}
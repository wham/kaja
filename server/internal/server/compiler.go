package server

import (
	"context"
	fmt "fmt"
	"os"
	"os/exec"
	"path/filepath"
	strings "strings"
	"sync"
)

type Compiler struct {
    status CompileStatus
    logs   []*Log
		sources []string
    mu     sync.Mutex
}

func NewCompiler() *Compiler {
    return &Compiler{
        status: CompileStatus_STATUS_READY,
        logs:   []*Log{},
    }
}

func (b *Compiler) Compile(ctx context.Context, req *CompileRequest) (*CompileResponse, error) {
    b.mu.Lock()
    defer b.mu.Unlock()

    if b.status != CompileStatus_STATUS_RUNNING && req.LogOffset == 0 {
        b.status = CompileStatus_STATUS_RUNNING
        b.logs = []*Log{}
				b.sources = []string{}
        b.info("Compile started")
        go b.start()
    }

    return &CompileResponse{
        Status: b.status,
        Logs:   b.logs[req.LogOffset:],
				Sources: b.sources,
    }, nil
}

func (b *Compiler) start() {
	b.debug("cwd: " + getCwd())
	workspaceDir := filepath.Join(getCwd(), "../workspace")
	if _, err := os.Stat(workspaceDir); os.IsNotExist(err) {
			workspaceDir = filepath.Join(getCwd(), "../demo")
	}
	binDir := filepath.Join(getCwd(), "../bin")
	outputDir := filepath.Join(getCwd(), "./web/sources")
	b.debug("workspaceDir: " + workspaceDir)
	b.debug("outputDir: " + outputDir)

	if _, err := os.Stat(outputDir); err == nil {
			b.debug("Directory " + outputDir + " already exists, removing it")
			os.RemoveAll(outputDir)
	}
	os.MkdirAll(outputDir, os.ModePerm)

	protocCommand := "protoc --plugin=protoc-gen-ts=" + binDir + "/protoc-gen-ts --ts_out " + outputDir + " --ts_opt long_type_bigint -I" + workspaceDir + " $(find " + workspaceDir + " -iname \"*.proto\")"
	b.debug("Running protoc")
	b.debug(protocCommand)

	cmd := exec.Command("sh", "-c", protocCommand)
    var stderr strings.Builder
    cmd.Stderr = &stderr

    err := cmd.Run()
    if err != nil {
				b.error("Failed to run protoc", err)
				b.error(stderr.String(), err)
        fmt.Printf("Failed to run protoc: %v\nStderr: %s\n", err, stderr.String())
        return
    }

	b.info("Protoc completed successfully")

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
			b.error("Failed to scan outputDir", err)
			return
	}

	b.info("Sources: " + strings.Join(sources, ", "))
	b.sources = sources

	b.status = CompileStatus_STATUS_READY
}

func (b *Compiler) info(message string) {
    b.logs = append(b.logs, &Log{
        Level:   LogLevel_LEVEL_INFO,
        Message: message,
    })
}

func (b *Compiler) debug(message string) {
    b.logs = append(b.logs, &Log{
        Level:   LogLevel_LEVEL_DEBUG,
        Message: message,
    })
}

func (b *Compiler) error(message string, err error) {
	fmt.Println(message)
	if err != nil {
		fmt.Println(err.Error())
	}
	
	b.logs = append(b.logs, &Log{
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
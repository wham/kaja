package api

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wham/kaja/v2/internal/tempdir"
	"github.com/wham/kaja/v2/internal/ui"
)

type Compiler struct {
	mu      sync.Mutex
	status  CompileStatus
	logger  *Logger
	sources []*Source
	stub    string
}

func NewCompiler() *Compiler {
	return &Compiler{
		status: CompileStatus_STATUS_READY,
	}
}

func (c *Compiler) start(projectName string, workspace string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	c.logger.debug("cwd: " + cwd)

	// Create a unique temp directory for this compilation
	sourcesDir, err := tempdir.NewCompilationDir()
	if err != nil {
		c.status = CompileStatus_STATUS_ERROR
		c.logger.error("Failed to create temp directory", err)
		return err
	}
	c.logger.debug("sourcesDir: " + sourcesDir)

	c.logger.debug("Starting compilation")
	err = c.protoc(cwd, sourcesDir, workspace)
	if err != nil {
		c.status = CompileStatus_STATUS_ERROR
		c.logger.error("Compilation failed", err)
		return err
	}

	c.sources = c.getSources(sourcesDir)

	c.logger.debug("Building stub")
	stub, err := ui.BuildStub(sourcesDir)
	if err != nil {
		c.status = CompileStatus_STATUS_ERROR
		c.logger.error("Failed to build stub", err)
		return err
	}
	c.stub = string(stub)

	c.status = CompileStatus_STATUS_READY
	c.logger.info("Compilation completed successfully, kaja is ready to go")

	return nil
}

func (c *Compiler) getSources(sourcesDir string) []*Source {
	var sources []*Source

	err := filepath.Walk(sourcesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			relativePath := strings.TrimPrefix(path, sourcesDir+"/")
			if strings.HasSuffix(relativePath, ".ts") {
				content, err := os.ReadFile(path)
				if err != nil {
					c.logger.error("Failed to read source file", err)
					return err
				}
				sources = append(sources, &Source{
					Path:    relativePath,
					Content: string(content),
				})
			}
		}
		return nil
	})

	if err != nil {
		c.logger.error("Failed to walk sourcesDir", err)
	}

	return sources
}

func (c *Compiler) protoc(cwd string, sourcesDir string, workspace string) error {
	var workspaceDir string
	if filepath.IsAbs(workspace) {
		workspaceDir = workspace
	} else {
		workspaceDir = filepath.Join(cwd, "../workspace/"+workspace)
	}
	c.logger.debug("workspaceDir: " + workspaceDir)

	buildDir := filepath.Join(cwd, "../build")
	c.logger.debug("binDir: " + buildDir)

	protocCommand := "protoc --plugin=protoc-gen-ts=" + buildDir + "/protoc-gen-ts --ts_out " + sourcesDir + " --ts_opt long_type_bigint -I" + workspaceDir + " $(find " + workspaceDir + " -iname \"*.proto\")"
	c.logger.debug("Running protoc")
	c.logger.debug(protocCommand)

	cmd := exec.Command("sh", "-c", protocCommand)
	var stderr strings.Builder
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		c.logger.error("Failed to run protoc", err)
		c.logger.error(stderr.String(), err)
		fmt.Printf("Failed to run protoc: %v\nStderr: %s\n", err, stderr.String())
		return fmt.Errorf("protoc failed: %v", err)
	}

	c.logger.debug("Protoc completed successfully")
	return nil
}

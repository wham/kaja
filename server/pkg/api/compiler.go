package api

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

type Compiler struct {
	mu      sync.Mutex
	status  CompileStatus
	logger  *Logger
	sources []*Source
}

func NewCompiler() *Compiler {
	return &Compiler{
		status: CompileStatus_STATUS_READY,
	}
}

func (c *Compiler) start(projectName string, workspace string, force bool) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	c.logger.debug("cwd: " + cwd)

	sourcesDir := filepath.Join(cwd, "./build/sources/"+projectName)
	c.logger.debug("sourcesDir: " + sourcesDir)

	var sources []*Source

	if !force {
		c.logger.debug("Not forcing recompilation, using cached sources")
		sources = c.getSources(sourcesDir)
	}

	if force || len(sources) == 0 {
		c.logger.debug("Starting fresh compilation")
		err := c.protoc(cwd, sourcesDir, workspace)
		if err != nil {
			c.status = CompileStatus_STATUS_ERROR
			c.logger.error("Compilation failed", err)
			return err
		}
		sources = c.getSources(sourcesDir)
	}

	c.sources = sources

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
	if _, err := os.Stat(sourcesDir); err == nil {
		c.logger.debug("Directory " + sourcesDir + " already exists, removing it")
		os.RemoveAll(sourcesDir)
	}
	os.MkdirAll(sourcesDir, os.ModePerm)

	workspaceDir := filepath.Join(cwd, "../workspace/"+workspace)
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

package api

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wham/kaja/v2/internal/tempdir"
	"github.com/wham/kaja/v2/internal/ui"
	"github.com/wham/kaja/v2/protoc-gen-kaja/kaja"
	"github.com/wham/protoc-go/protoc"
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

func (c *Compiler) start(id string, protoDir string) error {
	c.logger.debug("id: " + id)

	cwd, err := os.Getwd()
	if err != nil {
		c.status = CompileStatus_STATUS_ERROR
		c.logger.error("Failed to get working directory", err)
		return err
	}
	c.logger.debug("cwd: " + cwd)

	sourcesDir, err := tempdir.NewSourcesDir()
	if err != nil {
		c.status = CompileStatus_STATUS_ERROR
		c.logger.error("Failed to create temp directory", err)
		return err
	}
	c.logger.debug("sourcesDir: " + sourcesDir)

	c.logger.debug("Starting compilation")
	err = c.compile(cwd, sourcesDir, protoDir)
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
	c.logger.info("Compilation completed successfully, Kaja is ready to go")

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

func (c *Compiler) compile(cwd string, sourcesDir string, protoDir string) error {
	if !filepath.IsAbs(protoDir) {
		protoDir = filepath.Join(cwd, "../workspace/"+protoDir)
	}
	c.logger.debug("protoDir: " + protoDir)

	protoFiles, err := findProtoFiles(protoDir)
	if err != nil {
		return fmt.Errorf("finding proto files: %v", err)
	}
	if len(protoFiles) == 0 {
		return fmt.Errorf("no .proto files found in %s", protoDir)
	}
	c.logger.debug(fmt.Sprintf("Found %d proto files", len(protoFiles)))

	compiler := protoc.New(protoc.WithProtoPaths(protoDir))

	c.logger.debug("Compiling proto files")
	result, err := compiler.Compile(protoFiles...)
	if err != nil {
		return fmt.Errorf("protoc compile: %v", err)
	}

	c.logger.debug("Running protoc-gen-kaja")
	generated, err := result.RunLibraryPlugin(kaja.NewPlugin(), "")
	if err != nil {
		return fmt.Errorf("protoc-gen-kaja: %v", err)
	}

	for _, f := range generated {
		outPath := filepath.Join(sourcesDir, f.Name)
		if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
			return fmt.Errorf("creating directory for %s: %v", f.Name, err)
		}
		if err := os.WriteFile(outPath, []byte(f.Content), 0o644); err != nil {
			return fmt.Errorf("writing %s: %v", f.Name, err)
		}
	}

	c.logger.debug("Compilation completed successfully")
	return nil
}

func findProtoFiles(dir string) ([]string, error) {
	var files []string
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.EqualFold(filepath.Ext(path), ".proto") {
			rel, err := filepath.Rel(dir, path)
			if err != nil {
				return err
			}
			files = append(files, rel)
		}
		return nil
	})
	return files, err
}

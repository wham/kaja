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
	err = c.protoc(cwd, sourcesDir, protoDir)
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

// getBinDir returns the directory containing protoc and protoc-gen-ts binaries.
// For macOS .app bundles, it returns Contents/MacOS (same as main executable).
// Otherwise, it returns the build directory relative to cwd.
func getBinDir(cwd string) string {
	execPath, err := os.Executable()
	if err == nil {
		// Check if running from a macOS .app bundle
		if strings.Contains(execPath, ".app/Contents/MacOS") {
			return filepath.Dir(execPath)
		}
	}
	// Default: use build directory relative to cwd
	return filepath.Join(cwd, "./build")
}

// getIncludeDir returns the directory containing protobuf well-known types.
// For macOS .app bundles, it returns Contents/Resources/include.
// Otherwise, it returns the build/include directory relative to cwd.
func getIncludeDir(cwd string) string {
	execPath, err := os.Executable()
	if err == nil {
		// Check if running from a macOS .app bundle
		if strings.Contains(execPath, ".app/Contents/MacOS") {
			appIndex := strings.Index(execPath, ".app/Contents/MacOS")
			bundlePath := execPath[:appIndex+4]
			return filepath.Join(bundlePath, "Contents", "Resources", "include")
		}
	}
	// Default: use build/include directory relative to cwd
	return filepath.Join(cwd, "./build/include")
}

func (c *Compiler) protoc(cwd string, sourcesDir string, protoDir string) error {
	if !filepath.IsAbs(protoDir) {
		protoDir = filepath.Join(cwd, "../workspace/"+protoDir)
	}
	c.logger.debug("protoDir: " + protoDir)

	binDir := getBinDir(cwd)
	c.logger.debug("binDir: " + binDir)

	includeDir := getIncludeDir(cwd)
	c.logger.debug("includeDir: " + includeDir)

	protocBin := filepath.Join(binDir, "protoc")
	protocGenTs := filepath.Join(binDir, "protoc-gen-ts")

	protocCommand := "PATH=" + binDir + ":$PATH " + protocBin + " --plugin=protoc-gen-ts=" + protocGenTs + " --ts_out " + sourcesDir + " --ts_opt long_type_bigint -I" + includeDir + " -I" + protoDir + " $(find " + protoDir + " -iname \"*.proto\")"
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

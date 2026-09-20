package api

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wham/kaja/v2/internal/tempdir"
	"github.com/wham/kaja/v2/internal/ui"
	"github.com/wham/kaja/v2/internal/workspace"
	"github.com/wham/kaja/v2/pkg/grpc"
	"github.com/wham/kaja/v2/protoc-gen-kaja/kaja"
	"github.com/wham/protoc-go/protoc"
)

// Every message type is generated without a create and a binary codec of its own,
// leaving the runtime to drive all three off the field descriptors. That is most of
// what a message generates, and an app is compiled and bundled where it is read - in
// the browser - so the cost of the specialized codec is paid by the person waiting
// for the app to open, against calls a person makes one at a time.
const kajaParameter = "force_optimize_code_size"

type Compiler struct {
	logger *Logger
}

func NewCompiler(logger *Logger) *Compiler {
	return &Compiler{logger: logger}
}

// run compiles the proto directory into the TypeScript sources and the stub the
// client loads an app from. It runs where the call is answered, so its logger writes
// each line straight on to the stream.
func (c *Compiler) run(protoDir string) ([]*Source, string, error) {
	c.logger.info("Starting compilation")

	cwd, err := os.Getwd()
	if err != nil {
		c.logger.error("Failed to get working directory", err)
		return nil, "", err
	}
	c.logger.debug("cwd: " + cwd)

	sourcesDir, err := tempdir.NewSourcesDir()
	if err != nil {
		c.logger.error("Failed to create temp directory", err)
		return nil, "", err
	}
	c.logger.debug("sourcesDir: " + sourcesDir)

	if err := c.compile(sourcesDir, protoDir); err != nil {
		c.logger.error("Compilation failed", err)
		return nil, "", err
	}

	sources := c.getSources(sourcesDir)

	c.logger.debug("Building stub")
	stub, err := ui.BuildStub(sourcesDir)
	if err != nil {
		c.logger.error("Failed to build stub", err)
		return nil, "", err
	}

	c.logger.info("Compilation completed successfully, Kaja is ready to go")

	return sources, string(stub), nil
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

// compilerFor reads what a proto directory holds and says how to compile it. A
// surface kaja was pointed at is .proto files; one that came from reflection is the
// descriptors the server sent, compiled as they are rather than printed back out as
// text something else has to parse again.
func (c *Compiler) compilerFor(protoDir string) (*protoc.Compiler, []string, error) {
	set := filepath.Join(protoDir, grpc.DescriptorSetName)
	if _, err := os.Stat(set); err == nil {
		files, err := grpc.DescriptorSetFiles(set)
		if err != nil {
			return nil, nil, fmt.Errorf("reading descriptors: %v", err)
		}
		c.logger.debug(fmt.Sprintf("Found %d reflected file(s)", len(files)))
		return protoc.New(protoc.WithDescriptorSetIn(set)), files, nil
	}

	protoFiles, err := findProtoFiles(protoDir)
	if err != nil {
		return nil, nil, fmt.Errorf("finding proto files: %v", err)
	}
	if len(protoFiles) == 0 {
		return nil, nil, fmt.Errorf("no .proto files found in %s", protoDir)
	}
	c.logger.debug(fmt.Sprintf("Found %d proto files", len(protoFiles)))
	return protoc.New(protoc.WithProtoPaths(protoDir)), protoFiles, nil
}

func (c *Compiler) compile(sourcesDir string, protoDir string) error {
	protoDir = workspace.Resolve(protoDir)
	c.logger.debug("protoDir: " + protoDir)

	compiler, protoFiles, err := c.compilerFor(protoDir)
	if err != nil {
		return err
	}

	c.logger.debug("Compiling proto files")
	result, err := compiler.Compile(protoFiles...)
	if err != nil {
		return fmt.Errorf("protoc compile: %v", err)
	}

	c.logger.debug("Running protoc-gen-kaja")
	generated, err := result.RunLibraryPlugin(kaja.NewPlugin(), kajaParameter)
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

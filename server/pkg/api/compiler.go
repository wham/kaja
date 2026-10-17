package api

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wham/kaja/v2/pkg/grpc"
	"github.com/wham/kaja/v2/protoc-gen-kaja/kaja"
	"github.com/wham/protoc-go/protoc"
)

// kaja_manifest has the plugin answer with a manifest rather than with TypeScript: an
// app is data the UI builds its types from, never code it evaluates.
const kajaParameter = "kaja_manifest"

type Compiler struct {
	logger *Logger
}

func NewCompiler(logger *Logger) *Compiler {
	return &Compiler{logger: logger}
}

// run compiles the proto directory into the manifest the client loads an app from. It
// runs where the call is answered, so its logger writes each line straight on to the
// stream.
func (c *Compiler) run(protoDir string) (string, error) {
	c.logger.info("Starting compilation")

	manifest, err := c.compile(protoDir)
	if err != nil {
		c.logger.error("Compilation failed", err)
		return "", err
	}

	c.logger.info("Compilation completed successfully, Kaja is ready to go")
	return manifest, nil
}

// compilerFor reads what a proto directory holds and says how to compile it. A
// surface kaja was pointed at is .proto files; one that came from reflection is the
// descriptors the server sent, compiled as they are rather than printed back out as
// text something else has to parse again, and an app that generates its own surface
// leaves the descriptors it compiled for itself the same way.
func (c *Compiler) compilerFor(protoDir string) (*protoc.Compiler, []string, error) {
	set := filepath.Join(protoDir, grpc.DescriptorSetName)
	if _, err := os.Stat(set); err == nil {
		files, err := grpc.DescriptorSetFiles(set)
		if err != nil {
			return nil, nil, fmt.Errorf("reading descriptors: %v", err)
		}
		// In the order the .proto files would have been found in, so the manifest reads
		// the same whichever way the surface arrived.
		sort.Strings(files)
		c.logger.debug(fmt.Sprintf("Found %d compiled file(s)", len(files)))
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

func (c *Compiler) compile(protoDir string) (string, error) {
	c.logger.debug("protoDir: " + protoDir)

	compiler, protoFiles, err := c.compilerFor(protoDir)
	if err != nil {
		return "", err
	}

	c.logger.debug("Compiling proto files")
	result, err := compiler.Compile(protoFiles...)
	if err != nil {
		return "", fmt.Errorf("protoc compile: %v", err)
	}

	c.logger.debug("Running protoc-gen-kaja")
	generated, err := result.RunLibraryPlugin(kaja.NewPlugin(), kajaParameter)
	if err != nil {
		return "", fmt.Errorf("protoc-gen-kaja: %v", err)
	}
	for _, f := range generated {
		if f.Name == kaja.ManifestName {
			return f.Content, nil
		}
	}
	return "", fmt.Errorf("protoc-gen-kaja wrote no %s", kaja.ManifestName)
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

package api

import (
	"fmt"

	"github.com/wham/kaja/v2/pkg/apps/rpc"
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
func (c *Compiler) run(protoDir string, compiled *protoc.Result) (string, error) {
	c.logger.info("Starting compilation")

	var manifest string
	var err error
	if compiled != nil {
		manifest, err = c.generate(compiled)
	} else {
		manifest, err = c.compile(protoDir)
	}
	if err != nil {
		c.logger.error("Compilation failed", err)
		return "", err
	}

	c.logger.info("Compilation completed successfully, Kaja is ready to go")
	return manifest, nil
}

func (c *Compiler) compile(protoDir string) (string, error) {
	c.logger.debug("protoDir: " + protoDir)

	protoFiles, err := rpc.ProtoFiles(protoDir)
	if err != nil {
		return "", fmt.Errorf("finding proto files: %v", err)
	}
	if len(protoFiles) == 0 {
		return "", fmt.Errorf("no .proto files found in %s", protoDir)
	}
	c.logger.debug(fmt.Sprintf("Found %d proto files", len(protoFiles)))

	c.logger.debug("Compiling proto files")
	result, err := protoc.New(protoc.WithProtoPaths(protoDir)).Compile(protoFiles...)
	if err != nil {
		return "", fmt.Errorf("protoc compile: %v", err)
	}
	return c.generate(result)
}

func (c *Compiler) generate(result *protoc.Result) (string, error) {
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

// Package rpc implements the built-in "grpc" app: a gRPC service kaja talks to
// directly. Its proto surface comes either from a static directory on disk
// (parameter "proto_dir", resolved against the workspace) or from server reflection
// (parameter "reflection": "true").
//
// It is the one app kaja does not invoke in this process. A gRPC call is forwarded
// rather than transcoded - the request the client framed is the request that reaches
// the server, which is what carries a server stream through - so Open returns the
// upstream URL for the forwarder to dial rather than an instance to call.
package rpc

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/kaja/v2/pkg/grpc"
)

// App opens "grpc" apps.
type App struct{}

func New() *App { return &App{} }

func (a *App) Open(parameters map[string]string, protoDir string, log func(string)) (*apps.Opened, error) {
	url := strings.TrimSpace(parameters["url"])
	if url == "" {
		return nil, fmt.Errorf("missing required parameter %q", "url")
	}
	log("GRPC target: " + url)

	if strings.TrimSpace(parameters["reflection"]) == "true" {
		if err := reflect(url, TLS(parameters), Metadata(parameters), protoDir, log); err != nil {
			return nil, err
		}
		return &apps.Opened{ProtoDir: protoDir, Target: url}, nil
	}

	dir := strings.TrimSpace(parameters["proto_dir"])
	if dir == "" {
		return nil, fmt.Errorf("missing required parameter %q (set %q to use gRPC reflection)", "proto_dir", "reflection")
	}
	log("Proto directory: " + dir)
	// A relative dir is resolved by the compiler against the workspace.
	return &apps.Opened{ProtoDir: dir, Target: url}, nil
}

// reflect discovers the upstream's services via gRPC reflection and writes the
// reconstructed .proto files into protoDir. The app's own credential is sent
// with the reflection stream: a server that guards its methods usually guards
// the list of them too.
func reflect(url string, options grpc.TLSOptions, metadata map[string]string, protoDir string, log func(string)) error {
	client, err := grpc.NewReflectionClientFromString(url, options, metadata)
	if err != nil {
		return fmt.Errorf("creating reflection client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	log("Connecting to server for reflection...")
	result, err := client.Discover(ctx)
	if err != nil {
		return fmt.Errorf("discovering services: %w", err)
	}
	log(fmt.Sprintf("Discovered %d service(s): %v", len(result.Services), result.Services))

	if err := grpc.WriteProtoFiles(result, protoDir); err != nil {
		return fmt.Errorf("writing proto files: %w", err)
	}
	log("Proto files written to " + protoDir)
	return nil
}

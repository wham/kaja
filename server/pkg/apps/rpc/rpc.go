// Package rpc implements the built-in "grpc" and "twirp" apps: plain RPC services
// kaja talks to directly. Their proto surface comes either from a static directory
// on disk (parameter "proto_dir", resolved against the workspace) or, for gRPC,
// from server reflection (parameter "reflection": "true"). Unlike in-process apps,
// their methods are invoked by the client straight against the upstream URL, so
// Open just returns the proto directory, the target URL, and the transport.
package rpc

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/kaja/v2/pkg/grpc"
)

// App opens "grpc" or "twirp" apps. protocol is the transport reported back to the
// client ("grpc" or "twirp").
type App struct {
	protocol string
}

// New returns an App for the given transport: "grpc" or "twirp".
func New(protocol string) *App { return &App{protocol: protocol} }

func (a *App) Open(parameters map[string]string, protoDir string, log func(string)) (*apps.Opened, error) {
	url := strings.TrimSpace(parameters["url"])
	if url == "" {
		return nil, fmt.Errorf("missing required parameter %q", "url")
	}
	log(strings.ToUpper(a.protocol) + " target: " + url)

	if strings.TrimSpace(parameters["reflection"]) == "true" {
		if a.protocol != "grpc" {
			return nil, fmt.Errorf("reflection is only supported for grpc apps")
		}
		if err := reflect(url, protoDir, log); err != nil {
			return nil, err
		}
		return &apps.Opened{ProtoDir: protoDir, Target: url, Protocol: a.protocol}, nil
	}

	dir := strings.TrimSpace(parameters["proto_dir"])
	if dir == "" {
		return nil, fmt.Errorf("missing required parameter %q (set %q to use gRPC reflection)", "proto_dir", "reflection")
	}
	log("Proto directory: " + dir)
	// A relative dir is resolved by the compiler against the workspace.
	return &apps.Opened{ProtoDir: dir, Target: url, Protocol: a.protocol}, nil
}

// reflect discovers the upstream's services via gRPC reflection and writes the
// reconstructed .proto files into protoDir.
func reflect(url string, protoDir string, log func(string)) error {
	client, err := grpc.NewReflectionClientFromString(url)
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

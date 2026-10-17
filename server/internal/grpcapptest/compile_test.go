package grpcapptest

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/api"
)

// module is one module of the manifest an app compiles to, as the editor reads it.
type module struct {
	Path       string `json:"path"`
	EditorText string `json:"editorText"`
	Services   []struct {
		Methods []struct {
			Name string `json:"name"`
		} `json:"methods"`
	} `json:"services"`
}

// openAndCompile is what the window does when an app appears: one Compile call that
// opens it and compiles its proto surface into the modules a script is written against.
func openAndCompile(t *testing.T, app *api.WorkspaceApp) ([]module, []*api.Log) {
	t.Helper()
	path := t.TempDir() + "/kaja.json"
	if err := os.WriteFile(path, []byte(`{}`), 0o600); err != nil {
		t.Fatalf("write workspace: %v", err)
	}
	service := api.NewApiService(path, false, "", "", nil)
	t.Cleanup(func() { service.Close() })

	collected := &compileCollector{ctx: t.Context()}
	if err := service.Compile(&api.CompileRequest{App: app}, collected); err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if collected.status != api.CompileStatus_STATUS_READY {
		t.Fatalf("compile failed:\n%s", logText(collected.logs))
	}
	var manifest struct {
		Modules []module `json:"modules"`
	}
	if err := json.Unmarshal([]byte(collected.manifest), &manifest); err != nil {
		t.Fatalf("manifest: %v", err)
	}
	return manifest.Modules, collected.logs
}

// TestCompileReflectedSurface reflects a server, writes its protos and generates the
// TypeScript from them — the whole path between adding an app and writing a call.
func TestCompileReflectedSurface(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"routeguide", "health"}, Reflection: true})

	sources, _ := openAndCompile(t, &api.WorkspaceApp{
		Name: "guide",
		App:  &api.WorkspaceApp_Grpc{Grpc: &api.GrpcApp{Url: up.URL, Reflection: true}},
	})

	names := sourceNames(sources)
	t.Logf("generated: %v", names)
	generated := sourceText(sources)
	for _, wanted := range []string{"GetFeature", "ListFeatures", "RecordRoute", "RouteChat", "interface Feature", "HealthCheckRequest"} {
		if !strings.Contains(generated, wanted) {
			t.Errorf("the generated TypeScript has no %q", wanted)
		}
	}
}

// TestCompileInteropSurface is the grpc interop test service: every permutation of
// unary and streaming, and the message types the gRPC project tests clients with.
func TestCompileInteropSurface(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"interop"}, Reflection: true})

	sources, _ := openAndCompile(t, &api.WorkspaceApp{
		Name: "interop",
		App:  &api.WorkspaceApp_Grpc{Grpc: &api.GrpcApp{Url: up.URL, Reflection: true}},
	})

	t.Logf("generated: %v", sourceNames(sources))
	generated := sourceText(sources)
	for _, wanted := range []string{"UnaryCall", "StreamingOutputCall", "StreamingInputCall", "FullDuplexCall", "HalfDuplexCall"} {
		if !strings.Contains(generated, wanted) {
			t.Errorf("the generated TypeScript has no %q", wanted)
		}
	}
}

// TestCompileGoogleApis is the same for a spec kaja was pointed at rather than told:
// the real pubsub protos, imports and all.
func TestCompileGoogleApis(t *testing.T) {
	sources, _ := openAndCompile(t, &api.WorkspaceApp{
		Name: "pubsub",
		App:  &api.WorkspaceApp_Grpc{Grpc: &api.GrpcApp{Url: pubsub, ProtoDir: absolute(t, "testdata/googleapis")}},
	})

	t.Logf("generated: %v", sourceNames(sources))
	generated := sourceText(sources)
	for _, wanted := range []string{"ListTopics", "interface Topic", "CreateSchema"} {
		if !strings.Contains(generated, wanted) {
			t.Errorf("the generated TypeScript has no %q", wanted)
		}
	}
}

// TestCompileReflectedProtoFiles is what reflection left on disk: a server's own
// descriptors written back out as .proto, which is what the compiler then reads.
func TestCompileReflectedProtoFiles(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"routeguide"}, Reflection: true})

	_, logs := openAndCompile(t, &api.WorkspaceApp{
		Name: "guide",
		App:  &api.WorkspaceApp_Grpc{Grpc: &api.GrpcApp{Url: up.URL, Reflection: true}},
	})

	// The one place the directory is named is the log that says it was written.
	protoDir := ""
	for _, log := range logs {
		if dir, ok := strings.CutPrefix(log.GetMessage(), "Descriptors written to "); ok {
			protoDir = dir
		}
	}
	if protoDir == "" {
		t.Fatalf("the log never said where reflection wrote:\n%s", logText(logs))
	}
	var written []string
	filepath.Walk(protoDir, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			written = append(written, strings.TrimPrefix(path, protoDir))
		}
		return nil
	})
	t.Logf("reflection wrote: %v", written)
	if len(written) == 0 {
		t.Fatalf("reflection wrote no proto files")
	}
}

type compileCollector struct {
	api.Api_CompileServer
	ctx      context.Context
	status   api.CompileStatus
	manifest string
	logs     []*api.Log
}

func (c *compileCollector) Context() context.Context {
	if c.ctx == nil {
		return context.Background()
	}
	return c.ctx
}

func (c *compileCollector) Send(response *api.CompileResponse) error {
	c.logs = append(c.logs, response.GetLogs()...)
	if response.GetStatus() != api.CompileStatus_STATUS_RUNNING {
		c.status = response.GetStatus()
		c.manifest = response.GetManifest()
	}
	return nil
}

func logText(logs []*api.Log) string {
	lines := []string{}
	for _, log := range logs {
		lines = append(lines, fmt.Sprintf("[%s] %s", log.GetLevel(), log.GetMessage()))
	}
	if len(lines) == 0 {
		return "(no logs at all)"
	}
	return strings.Join(lines, "\n")
}

func sourceNames(modules []module) []string {
	names := []string{}
	for _, m := range modules {
		names = append(names, m.Path)
	}
	return names
}

func sourceText(modules []module) string {
	parts := []string{}
	for _, m := range modules {
		parts = append(parts, m.EditorText)
		// The editor's services leave out what streams from the client.
		for _, service := range m.Services {
			for _, method := range service.Methods {
				parts = append(parts, method.Name)
			}
		}
	}
	return strings.Join(parts, "\n")
}

package grpcapptest

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/api"
)

// openAndCompile is what the window does when an app appears: open it, then compile
// the proto directory it was handed into the TypeScript a script is written against.
func openAndCompile(t *testing.T, app *api.ConfigurationApp) (*api.OpenAppResponse, []*api.Source, []*api.Log) {
	t.Helper()
	path := t.TempDir() + "/kaja.json"
	if err := os.WriteFile(path, []byte(`{}`), 0o600); err != nil {
		t.Fatalf("write configuration: %v", err)
	}
	service := api.NewApiService(path, false, "", "", nil)

	opened, err := service.OpenApp(t.Context(), &api.OpenAppRequest{App: app})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	if opened.GetStatus() != api.OpenStatus_OPEN_STATUS_OK {
		t.Fatalf("open failed:\n%s", logText(opened.GetLogs()))
	}

	collected := &compileCollector{}
	if err := service.Compile(&api.CompileRequest{ProtoDir: opened.GetProtoDir()}, collected); err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if collected.status != api.CompileStatus_STATUS_READY {
		t.Fatalf("compile failed:\n%s", logText(collected.logs))
	}
	return opened, collected.sources, collected.logs
}

// TestCompileReflectedSurface reflects a server, writes its protos and generates the
// TypeScript from them — the whole path between adding an app and writing a call.
func TestCompileReflectedSurface(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"routeguide", "health"}, Reflection: true})

	_, sources, _ := openAndCompile(t, &api.ConfigurationApp{
		Name: "guide",
		App:  &api.ConfigurationApp_Grpc{Grpc: &api.GrpcApp{Url: up.URL, Reflection: true}},
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

	_, sources, _ := openAndCompile(t, &api.ConfigurationApp{
		Name: "interop",
		App:  &api.ConfigurationApp_Grpc{Grpc: &api.GrpcApp{Url: up.URL, Reflection: true}},
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
	_, sources, _ := openAndCompile(t, &api.ConfigurationApp{
		Name: "pubsub",
		App:  &api.ConfigurationApp_Grpc{Grpc: &api.GrpcApp{Url: pubsub, ProtoDir: absolute(t, "testdata/googleapis")}},
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

	opened, _, _ := openAndCompile(t, &api.ConfigurationApp{
		Name: "guide",
		App:  &api.ConfigurationApp_Grpc{Grpc: &api.GrpcApp{Url: up.URL, Reflection: true}},
	})

	var written []string
	filepath.Walk(opened.GetProtoDir(), func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			written = append(written, strings.TrimPrefix(path, opened.GetProtoDir()))
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
	status  api.CompileStatus
	sources []*api.Source
	logs    []*api.Log
}

func (c *compileCollector) Send(response *api.CompileResponse) error {
	c.logs = append(c.logs, response.GetLogs()...)
	if response.GetStatus() != api.CompileStatus_STATUS_RUNNING {
		c.status = response.GetStatus()
		c.sources = response.GetSources()
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

func sourceNames(sources []*api.Source) []string {
	names := []string{}
	for _, source := range sources {
		names = append(names, source.GetPath())
	}
	return names
}

func sourceText(sources []*api.Source) string {
	parts := []string{}
	for _, source := range sources {
		parts = append(parts, source.GetContent())
	}
	return strings.Join(parts, "\n")
}

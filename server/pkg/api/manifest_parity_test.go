package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/wham/kaja/v2/pkg/apps/mcp"
	"github.com/wham/kaja/v2/pkg/apps/openapi"
)

// TestWriteManifestParityFixtures compiles three surfaces and writes what the UI loads
// an app from, so ui/src/manifestParity.test.ts can hold the manifest against the
// TypeScript parse it replaces. It runs only when KAJA_PARITY_DIR names where to write.
func TestWriteManifestParityFixtures(t *testing.T) {
	out := os.Getenv("KAJA_PARITY_DIR")
	if out == "" {
		t.Skip("KAJA_PARITY_DIR not set")
	}
	if err := os.MkdirAll(out, 0o755); err != nil {
		t.Fatal(err)
	}

	surfaces := map[string]string{
		"big":         filepath.Join("..", "..", "..", "protoc-gen-kaja", "tests", "000_big"),
		"kitchensink": openapiProtoDir(t),
		"mcp":         mcpProtoDir(t),
	}
	for name, protoDir := range surfaces {
		sources, stub, manifest, err := NewCompiler(NewLogger()).run(protoDir)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		body, err := json.Marshal(map[string]any{"sources": sources, "stub": stub, "manifest": manifest})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(out, name+".json"), body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func openapiProtoDir(t *testing.T) string {
	spec, err := os.ReadFile(filepath.Join("..", "apps", "openapi", "testdata", "kitchensink.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	parameters := map[string]string{"spec_content": string(spec), "base_url": "https://example.com"}
	if _, err := openapi.New().Open(parameters, dir, func(string) {}); err != nil {
		t.Fatalf("open openapi: %v", err)
	}
	return dir
}

func mcpProtoDir(t *testing.T) string {
	results := map[string]string{
		"server/discover": `{"resultType":"complete","supportedVersions":["2026-07-28"],"capabilities":{"tools":{},"prompts":{},"resources":{}}}`,
		"tools/list": `{"resultType":"complete","tools":[{"name":"get_weather","description":"Get current weather information for a location",
			"inputSchema":{"type":"object","properties":{"location":{"type":"string","description":"City name or zip code"},
			"units":{"type":"string","enum":["metric","imperial"]},"days":{"type":"integer"},
			"window":{"type":"object","properties":{"from":{"type":"string"},"to":{"type":"string"}}}},"required":["location"]},
			"outputSchema":{"type":"object","properties":{"temperature":{"type":"number"},"conditions":{"type":"string"}}}}]}`,
		"prompts/list":   `{"resultType":"complete","prompts":[{"name":"summarize","description":"Summarize a text","arguments":[{"name":"text","required":true}]}]}`,
		"resources/list": `{"resultType":"complete","resources":[{"uri":"file:///readme","name":"readme"}]}`,
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var message struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		_ = json.Unmarshal(body, &message)
		w.Header().Set("Content-Type", "application/json")
		if result, ok := results[message.Method]; ok {
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":%s}`, message.ID, result)
			return
		}
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"Method not found"}}`, message.ID)
	}))
	t.Cleanup(server.Close)

	dir := t.TempDir()
	if _, err := mcp.New().Open(map[string]string{"url": server.URL + "/mcp"}, dir, func(string) {}); err != nil {
		t.Fatalf("open mcp: %v", err)
	}
	return dir
}

package openapi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestKitchenSinkSpec runs the kitchen-sink fixture (see the comment at the top
// of testdata/kitchensink.yaml for the constructs it exercises) through the
// full generate + compile pipeline.
func TestKitchenSinkSpec(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("testdata", "kitchensink.yaml"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	s, err := parseSpec(body)
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	gen, err := generateProto(s)
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}

	// The generated proto must compile into descriptors.
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "service.proto"), []byte(gen.proto), 0o644); err != nil {
		t.Fatalf("write proto: %v", err)
	}
	methods, err := compileMethods(dir, gen)
	if err != nil {
		t.Fatalf("compileMethods: %v", err)
	}
	if len(methods) != len(gen.bindings) {
		t.Errorf("compiled %d methods, want %d", len(methods), len(gen.bindings))
	}

	for _, frag := range []string{
		// The ingest body is "anyOf: [Signal, Signal[]]"; the single Signal is
		// the modeled happy path, with its fields present.
		"message IngestSignalsRequest {",
		`Signal body = `,
		"message Signal {",
		// Origin + description snippets from the spec surface as proto comments.
		"// from #/components/schemas/Signal",
		"// A single observed signal.",
		"// Comments preserve special chars like */ and <html>.",
		"// Stable identifier.",
		"// POST /signals",
		"// Zero-based page index.",
		`string id = `,
		`string source = `,
		`uint64 total = `,
		`uint32 count = `,
		`map<string, string> labels = `,
		// Interval is "anyOf: [string, IntervalEnum]" - a scalar union expands
		// to its first variant in place.
		`string interval = `,
		// Gauge is "oneOf: [GaugeFlat, GaugeTiered]" - the merged message
		// exposes the union's fields, and the variants' differing "scale"
		// schemas merge into a union of their own.
		"message Gauge {",
		`GaugeScale scale = `,
		"message GaugeScale {",
		`string factor = `,
		`repeated ScaleTier tiers = `,
		// Widget composes multi-entry allOf with sibling properties.
		"message Widget {",
		`string created_at = `,
		`string deprecated_name = `,
		// A component schema named like the request wrapper is renamed instead
		// of swallowing the wrapper's body field.
		"message CreateProbeRequest {\n  CreateProbeRequest2 body = 1",
		"message CreateProbeRequest2 {",
		// Probe is "allOf: [Resource, CreateProbeRequest]".
		"message Probe {",
		`rpc GetStatus(GetStatusRequest) returns (GetStatusResponse);`,
	} {
		if !strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto missing %q\n---\n%s", frag, gen.proto)
		}
	}
	if strings.Contains(gen.proto, "message IngestSignalsBody") {
		t.Errorf("mixed-shape anyOf should expand in place, not become a message\n---\n%s", gen.proto)
	}

	ingest := gen.bindings["openapi.kaja_kitchen_sink.Signals/IngestSignals"]
	if ingest == nil {
		t.Fatal("missing IngestSignals binding")
	}
	if ingest.verb != "POST" || ingest.pathTemplate != "/signals" || ingest.bodyKey != "body" {
		t.Errorf("IngestSignals binding unexpected: %+v", ingest)
	}
	if ingest.bodyContentType != "application/json" {
		t.Errorf("IngestSignals bodyContentType = %q, want application/json", ingest.bodyContentType)
	}

	// Query styles: $ref'd page is explode:false, filterLabels is deepObject,
	// advancedFilter is declared via content.
	list := gen.bindings["openapi.kaja_kitchen_sink.Signals/ListSignals"]
	if list == nil {
		t.Fatal("missing ListSignals binding")
	}
	styles := map[string]string{}
	for _, qp := range list.queryParams {
		styles[qp.name] = qp.style
	}
	for name, style := range map[string]string{"page": "csv", "order": "", "expand": "csv", "filterLabels": "deepObject", "advancedFilter": ""} {
		got, ok := styles[name]
		if !ok || got != style {
			t.Errorf("query param %q style = %q (present=%t), want %q", name, got, ok, style)
		}
	}

	// ListReportsResult is "oneOf: [Report[], PaginatedReports]" - a mixed-shape
	// union response resolves to its first variant, the array.
	if b := gen.bindings["openapi.kaja_kitchen_sink.Reports/ListReports"]; b == nil || b.responseWrap != "array" {
		t.Errorf("ListReports binding unexpected: %+v", b)
	}
	if b := gen.bindings["openapi.kaja_kitchen_sink.KajaKitchenSink/GetStatus"]; b == nil || b.responseWrap != "text" {
		t.Errorf("GetStatus binding unexpected: %+v", b)
	}
}

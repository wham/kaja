package openapi

import (
	"os"
	"path/filepath"
	"slices"
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
	if err := gen.write(dir); err != nil {
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
		// the modeled happy path. It is the operation's whole input, so it is the
		// request message itself rather than a field inside one.
		"rpc IngestSignals(Signal) returns (IngestSignalsResponse) {",
		"message Signal {",
		`string id = `,
		`string source = `,
		`uint64 total = `,
		`uint32 count = `,
		`map<string, string> labels = `,
		// Interval is "anyOf: [string, IntervalEnum]" - a same-category (all
		// string) scalar union expands to its first variant in place.
		`string interval = `,
		// A union mixing incompatible scalars and a bare free-form property both
		// map to google.protobuf.Value so any JSON value round-trips.
		`import "google/protobuf/struct.proto";`,
		`google.protobuf.Value data = `,
		`google.protobuf.Value value = `,
		// A free-form map value (additionalProperties: {}) carries any JSON.
		`map<string, google.protobuf.Value> payload = `,
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
		// A component schema named like the request the operation would have
		// generated simply is that request.
		"rpc CreateProbe(CreateProbeRequest) returns (Probe) {",
		"message CreateProbeRequest {\n  string target = 1",
		// Probe is "allOf: [Resource, CreateProbeRequest]".
		"message Probe {",
		`rpc GetStatus(GetStatusRequest) returns (GetStatusResponse) {`,
		// A body beside parameters keeps its envelope field, and says so.
		`WidgetBase body = 4 [json_name = "body", (kaja.http_payload) = HTTP_PAYLOAD_BODY];`,
		// Header parameters are ordinary fields carrying their header name.
		`string x_trace_id = 2 [json_name = "X-Trace-Id", (kaja.http_in) = "header"];`,
		`string if_match = 3 [json_name = "If-Match", (kaja.http_in) = "header"];`,
		// An array body has no message to be, so its envelope stays too.
		`repeated Report body = 1 [json_name = "body", (kaja.http_payload) = HTTP_PAYLOAD_BODY];`,
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
	if ingest.verb != "POST" || ingest.pathTemplate != "/signals" || !ingest.bodyWhole || ingest.bodyKey != "" {
		t.Errorf("IngestSignals binding unexpected: %+v", ingest)
	}
	if ingest.bodyContentType != "application/json" {
		t.Errorf("IngestSignals bodyContentType = %q, want application/json", ingest.bodyContentType)
	}

	update := gen.bindings["openapi.kaja_kitchen_sink.Widgets/UpdateWidget"]
	if update == nil {
		t.Fatal("missing UpdateWidget binding")
	}
	if update.bodyWhole || update.bodyKey != "body" {
		t.Errorf("UpdateWidget binding unexpected: %+v", update)
	}
	if want := []string{"X-Trace-Id", "If-Match"}; !slices.Equal(update.headerParams, want) {
		t.Errorf("UpdateWidget headerParams = %q, want %q", update.headerParams, want)
	}

	// An array body cannot be a message, so the envelope survives.
	if b := gen.bindings["openapi.kaja_kitchen_sink.Reports/CreateReports"]; b == nil || b.bodyWhole || b.bodyKey != "body" {
		t.Errorf("CreateReports binding unexpected: %+v", b)
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

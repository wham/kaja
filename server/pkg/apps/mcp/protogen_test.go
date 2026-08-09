package mcp

import (
	"encoding/json"
	"strings"
	"testing"
)

// generate renders the proto for a surface with one tool taking the given input
// schema, which is what most of these are about.
func generate(t *testing.T, inputSchema string) string {
	t.Helper()
	gen, err := generateProto(&Surface{
		ServerInfo: Implementation{Name: "Test", Version: "1"},
		Tools:      []Tool{{Name: "do_thing", InputSchema: json.RawMessage(inputSchema)}},
	})
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	return gen.proto
}

func requireLines(t *testing.T, proto string, lines ...string) {
	t.Helper()
	for _, line := range lines {
		if !strings.Contains(proto, line) {
			t.Errorf("expected %q in the generated proto:\n%s", line, proto)
		}
	}
}

func TestScalarFields(t *testing.T) {
	proto := generate(t, `{
		"type": "object",
		"properties": {
			"name": {"type": "string"},
			"count": {"type": "integer"},
			"total": {"type": "integer", "format": "int64"},
			"ratio": {"type": "number"},
			"enabled": {"type": "boolean"}
		}
	}`)
	requireLines(t, proto,
		`string name = 1 [json_name = "name"];`,
		`int32 count = 2 [json_name = "count"];`,
		`int64 total = 3 [json_name = "total"];`,
		`double ratio = 4 [json_name = "ratio"];`,
		`bool enabled = 5 [json_name = "enabled"];`,
	)
}

// Fields are numbered in the order the schema declares them, not alphabetically:
// sorting would renumber a message the moment a tool gains a property, and would
// reorder the request away from how the tool documents itself.
func TestFieldsKeepDeclarationOrder(t *testing.T) {
	proto := generate(t, `{"type":"object","properties":{"zebra":{"type":"string"},"alpha":{"type":"string"}}}`)
	zebra := strings.Index(proto, "string zebra = 1")
	alpha := strings.Index(proto, "string alpha = 2")
	if zebra < 0 || alpha < 0 || zebra > alpha {
		t.Errorf("expected zebra first:\n%s", proto)
	}
}

func TestCamelCasePropertyKeepsItsJsonName(t *testing.T) {
	proto := generate(t, `{"type":"object","properties":{"repoName":{"type":"string"},"HTTPUrl":{"type":"string"}}}`)
	requireLines(t, proto,
		`string repo_name = 1 [json_name = "repoName"];`,
		`string http_url = 2 [json_name = "HTTPUrl"];`,
	)
}

func TestNestedObjectBecomesItsOwnMessage(t *testing.T) {
	proto := generate(t, `{
		"type": "object",
		"properties": {
			"filter": {"type": "object", "properties": {"since": {"type": "string"}}}
		}
	}`)
	requireLines(t, proto,
		"message DoThingRequestFilter {",
		`string since = 1 [json_name = "since"];`,
		`DoThingRequestFilter filter = 1 [json_name = "filter"];`,
	)
}

func TestArraysAreRepeated(t *testing.T) {
	proto := generate(t, `{
		"type": "object",
		"properties": {
			"tags": {"type": "array", "items": {"type": "string"}},
			"points": {"type": "array", "items": {"type": "object", "properties": {"x": {"type": "number"}}}},
			"matrix": {"type": "array", "items": {"type": "array", "items": {"type": "number"}}}
		}
	}`)
	requireLines(t, proto,
		`repeated string tags = 1 [json_name = "tags"];`,
		"message DoThingRequestPointsItem {",
		`repeated DoThingRequestPointsItem points = 2 [json_name = "points"];`,
		// proto has no repeated-of-repeated, so the rows stay JSON.
		`repeated google.protobuf.Value matrix = 3 [json_name = "matrix"];`,
		`import "google/protobuf/struct.proto";`,
	)
}

func TestFreeFormObjectsBecomeValuesAndMaps(t *testing.T) {
	proto := generate(t, `{
		"type": "object",
		"properties": {
			"payload": {"type": "object"},
			"labels": {"type": "object", "additionalProperties": {"type": "string"}},
			"anything": {}
		}
	}`)
	requireLines(t, proto,
		`google.protobuf.Value payload = 1 [json_name = "payload"];`,
		`map<string, string> labels = 2 [json_name = "labels"];`,
		`google.protobuf.Value anything = 3 [json_name = "anything"];`,
	)
}

func TestRefsResolveAndRecurseSafely(t *testing.T) {
	proto := generate(t, `{
		"type": "object",
		"properties": {
			"node": {"$ref": "#/$defs/Node"}
		},
		"$defs": {
			"Node": {
				"type": "object",
				"properties": {
					"label": {"type": "string"},
					"children": {"type": "array", "items": {"$ref": "#/$defs/Node"}}
				}
			}
		}
	}`)
	requireLines(t, proto,
		"message Node {",
		`string label = 1 [json_name = "label"];`,
		`repeated Node children = 2 [json_name = "children"];`,
		`Node node = 1 [json_name = "node"];`,
	)
}

// A 2020-12 union with "null" is the same field as its non-null counterpart:
// a proto3 field already models an absent value.
func TestNullableTypeKeepsItsShape(t *testing.T) {
	proto := generate(t, `{"type":"object","properties":{"note":{"type":["string","null"]}}}`)
	requireLines(t, proto, `string note = 1 [json_name = "note"];`)
}

func TestAllOfMerges(t *testing.T) {
	proto := generate(t, `{
		"allOf": [
			{"type": "object", "properties": {"a": {"type": "string"}}},
			{"type": "object", "properties": {"b": {"type": "string"}}}
		],
		"type": "object",
		"properties": {"c": {"type": "string"}}
	}`)
	requireLines(t, proto,
		`string c = 1 [json_name = "c"];`,
		`string a = 2 [json_name = "a"];`,
		`string b = 3 [json_name = "b"];`,
	)
}

// proto3 has no `required`, and an enum's allowed values live nowhere else, so
// both are said in the comment - which is what reaches the editor as JSDoc.
func TestDocumentationCarriesRequiredAndEnum(t *testing.T) {
	proto := generate(t, `{
		"type": "object",
		"properties": {
			"units": {"type": "string", "description": "Measurement system", "enum": ["metric", "imperial"]}
		},
		"required": ["units"]
	}`)
	requireLines(t, proto,
		"// Measurement system",
		`// One of: "metric", "imperial"`,
		"// [required]",
	)
}

func TestToolNamesBecomeMethods(t *testing.T) {
	gen, err := generateProto(&Surface{Tools: []Tool{
		{Name: "get_weather"},
		{Name: "search.web"},
		{Name: "getWeather"},
		{Name: "123"},
	}})
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	for _, want := range []string{"mcp.Tools/GetWeather", "mcp.Tools/SearchWeb", "mcp.Tools/GetWeather2", "mcp.Tools/Tool123"} {
		if _, ok := gen.bindings[want]; !ok {
			t.Errorf("expected a binding for %s, got %v", want, keys(gen.bindings))
		}
	}
	// A method that had to be renamed still calls the tool by its own name.
	if gen.bindings["mcp.Tools/GetWeather2"].name != "getWeather" {
		t.Errorf("binding = %+v", gen.bindings["mcp.Tools/GetWeather2"])
	}
}

// A tool that declares an output schema gets a typed structured result; one that
// doesn't keeps the JSON it returned.
func TestOutputSchemaShapesTheResult(t *testing.T) {
	typed, err := generateProto(&Surface{Tools: []Tool{{
		Name:         "read",
		OutputSchema: json.RawMessage(`{"type":"object","properties":{"lines":{"type":"integer"}}}`),
	}}})
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	requireLines(t, typed.proto,
		"message ReadResult {",
		`ReadResult structured_content = 3 [json_name = "structuredContent"];`,
	)

	list, err := generateProto(&Surface{Tools: []Tool{{
		Name:         "list",
		OutputSchema: json.RawMessage(`{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"}}}}`),
	}}})
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	requireLines(t, list.proto, `repeated ListResult structured_content = 3 [json_name = "structuredContent"];`)

	untyped, err := generateProto(&Surface{Tools: []Tool{{Name: "ping"}}})
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	requireLines(t, untyped.proto, `google.protobuf.Value structured_content = 3 [json_name = "structuredContent"];`)
}

// Only the kinds the server exposes are emitted: an empty service is a row in
// the tree that leads nowhere.
func TestOnlyExposedKindsBecomeServices(t *testing.T) {
	toolsOnly, err := generateProto(&Surface{Tools: []Tool{{Name: "ping"}}})
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	if len(toolsOnly.serviceTypeNames) != 1 || toolsOnly.serviceTypeNames[0] != "mcp.Tools" {
		t.Errorf("services = %v", toolsOnly.serviceTypeNames)
	}

	everything, err := generateProto(&Surface{
		Tools:     []Tool{{Name: "ping"}},
		Resources: []Resource{{URI: "file:///a"}},
		Prompts:   []Prompt{{Name: "review"}},
	})
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	if len(everything.serviceTypeNames) != 3 {
		t.Errorf("services = %v", everything.serviceTypeNames)
	}
	for _, want := range []string{"mcp.Resources/ListResources", "mcp.Resources/ReadResource", "mcp.Prompts/ListPrompts", "mcp.Prompts/Review"} {
		if _, ok := everything.bindings[want]; !ok {
			t.Errorf("expected a binding for %s, got %v", want, keys(everything.bindings))
		}
	}

	if _, err := generateProto(&Surface{}); err == nil {
		t.Error("expected a server that exposes nothing to be refused")
	}
}

// The server's own hints about a tool are shown, and named as its word.
func TestAnnotationsReachTheComment(t *testing.T) {
	yes := true
	gen, err := generateProto(&Surface{Tools: []Tool{{
		Name:        "search",
		Description: "Search the web",
		Annotations: &ToolAnnotation{ReadOnlyHint: &yes},
	}}})
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	requireLines(t, gen.proto, "// Search the web", "// The server describes this tool as read-only.", "// MCP tool: search")
}

func TestLastSSEData(t *testing.T) {
	stream := ":\r\n" +
		"\r\n" +
		"event: message\r\n" +
		"data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{}}\r\n" +
		"\r\n" +
		"event: message\r\n" +
		"data: {\"jsonrpc\":\"2.0\",\"id\":1,\r\n" +
		"data: \"result\":{\"ok\":true}}\r\n" +
		"\r\n"
	got := string(lastSSEData([]byte(stream)))
	if !strings.Contains(got, `"result"`) || strings.Contains(got, "notifications/progress") {
		t.Errorf("lastSSEData = %s", got)
	}
}

func TestEncodeHeaderValue(t *testing.T) {
	tests := map[string]string{
		"get_weather":  "get_weather",
		"Hello, 世界":    "=?base64?SGVsbG8sIOS4lueVjA==?=",
		" padded ":     "=?base64?IHBhZGRlZCA=?=",
		"line1\nline2": "=?base64?bGluZTEKbGluZTI=?=",
	}
	for value, want := range tests {
		if got := encodeHeaderValue(value); got != want {
			t.Errorf("encodeHeaderValue(%q) = %q, want %q", value, got, want)
		}
	}
}

func TestPickVersion(t *testing.T) {
	if got := pickVersion([]string{"2025-06-18", "2026-07-28"}); got != ProtocolVersion {
		t.Errorf("pickVersion = %q, want the newest both speak", got)
	}
	if got := pickVersion([]string{"1900-01-01"}); got != "" {
		t.Errorf("pickVersion = %q, want none", got)
	}
}

func keys[T any](m map[string]T) []string {
	out := make([]string, 0, len(m))
	for key := range m {
		out = append(out, key)
	}
	return out
}

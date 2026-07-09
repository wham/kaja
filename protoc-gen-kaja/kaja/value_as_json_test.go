package kaja_test

import (
	"strings"
	"testing"

	"github.com/wham/kaja/v2/protoc-gen-kaja/kaja"
	"github.com/wham/protoc-go/protoc"
)

const valueAsJsonProto = `syntax = "proto3";
package demo;
import "google/protobuf/struct.proto";

message Event {
  string type = 1;
  map<string, google.protobuf.Value> data = 2;
  google.protobuf.Value payload = 3;
}
`

func generateEventsTS(t *testing.T, parameter string) string {
	t.Helper()
	c := protoc.New(protoc.WithOverlay(map[string]string{"events.proto": valueAsJsonProto}))
	result, err := c.Compile("events.proto")
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	files, err := result.RunLibraryPlugin(kaja.NewPlugin(), parameter)
	if err != nil {
		t.Fatalf("run plugin: %v", err)
	}
	for _, f := range files {
		if strings.HasSuffix(f.Name, "events.ts") {
			return f.Content
		}
	}
	t.Fatal("events.ts not generated")
	return ""
}

// Without the parameter, Value fields keep the wire-oneof Value type.
func TestValueAsJson_DefaultKeepsValueType(t *testing.T) {
	ts := generateEventsTS(t, "")
	if !strings.Contains(ts, "[key: string]: Value;") {
		t.Errorf("expected map value to render as Value, got:\n%s", ts)
	}
	if !strings.Contains(ts, "payload?: Value;") {
		t.Errorf("expected singular field to render as Value, got:\n%s", ts)
	}
	if strings.Contains(ts, "JsonValue") {
		t.Errorf("did not expect JsonValue without the parameter, got:\n%s", ts)
	}
}

// With value_as_json, Value fields render as plain JsonValue (any JSON), the
// import is added, but the message class still serializes through the real Value.
func TestValueAsJson_RendersJsonValue(t *testing.T) {
	ts := generateEventsTS(t, "value_as_json")
	if !strings.Contains(ts, "[key: string]: JsonValue;") {
		t.Errorf("expected map value to render as JsonValue, got:\n%s", ts)
	}
	if !strings.Contains(ts, "payload?: JsonValue;") {
		t.Errorf("expected singular field to render as JsonValue, got:\n%s", ts)
	}
	if !strings.Contains(ts, `import type { JsonValue } from "@protobuf-ts/runtime";`) {
		t.Errorf("expected JsonValue import, got:\n%s", ts)
	}
	// The message machinery is untouched: it still reads/writes real Value.
	if !strings.Contains(ts, "Value.internalBinaryWrite(") {
		t.Errorf("expected class to still serialize via Value, got:\n%s", ts)
	}
}

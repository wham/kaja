package mcp

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestReadHeaderParams(t *testing.T) {
	cases := []struct {
		name   string
		schema string
		want   []HeaderParam
	}{
		{
			name: "a primitive property is mirrored under its annotated name",
			schema: `{"type":"object","properties":{
				"region":{"type":"string","x-mcp-header":"Region"},
				"query":{"type":"string"}}}`,
			want: []HeaderParam{{Name: "Region", Path: []string{"region"}}},
		},
		{
			name: "a nested property is reached through properties alone",
			schema: `{"type":"object","properties":{
				"target":{"type":"object","properties":{
					"tenant":{"type":"integer","x-mcp-header":"Tenant"},
					"live":{"type":"boolean","x-mcp-header":"Live"}}}}}`,
			want: []HeaderParam{
				{Name: "Live", Path: []string{"target", "live"}},
				{Name: "Tenant", Path: []string{"target", "tenant"}},
			},
		},
		{
			name:   "a union with null is the type itself",
			schema: `{"type":"object","properties":{"region":{"type":["string","null"],"x-mcp-header":"Region"}}}`,
			want:   []HeaderParam{{Name: "Region", Path: []string{"region"}}},
		},
		{
			name:   "a property called x-mcp-header is a property",
			schema: `{"type":"object","properties":{"x-mcp-header":{"type":"string"}}}`,
			want:   nil,
		},
		{
			name:   "a value the document states is not an annotation",
			schema: `{"type":"object","properties":{"body":{"type":"object","default":{"x-mcp-header":"Nope"}}}}`,
			want:   nil,
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got, err := readHeaderParams(json.RawMessage(test.schema))
			if err != nil {
				t.Fatalf("readHeaderParams: %v", err)
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Errorf("got %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestReadHeaderParamsRejects(t *testing.T) {
	cases := []struct {
		name   string
		schema string
		reason string
	}{
		{
			name:   "an empty name",
			schema: `{"type":"object","properties":{"region":{"type":"string","x-mcp-header":""}}}`,
			reason: "is empty",
		},
		{
			name:   "a name outside the token syntax",
			schema: `{"type":"object","properties":{"region":{"type":"string","x-mcp-header":"Re gion"}}}`,
			reason: "is not a header name",
		},
		{
			name:   "a name carrying a newline",
			schema: `{"type":"object","properties":{"region":{"type":"string","x-mcp-header":"Re\ngion"}}}`,
			reason: "is not a header name",
		},
		{
			name: "two names that differ only in case",
			schema: `{"type":"object","properties":{
				"a":{"type":"string","x-mcp-header":"Region"},
				"b":{"type":"string","x-mcp-header":"region"}}}`,
			reason: "two parameters are annotated",
		},
		{
			name:   "a number parameter",
			schema: `{"type":"object","properties":{"ratio":{"type":"number","x-mcp-header":"Ratio"}}}`,
			reason: "which is not a string, an integer or a boolean",
		},
		{
			name:   "an object parameter",
			schema: `{"type":"object","properties":{"target":{"type":"object","x-mcp-header":"Target"}}}`,
			reason: "which is not a string, an integer or a boolean",
		},
		{
			name:   "a parameter declaring no type",
			schema: `{"type":"object","properties":{"region":{"x-mcp-header":"Region"}}}`,
			reason: "which is not a string, an integer or a boolean",
		},
		{
			name:   "an annotation under items",
			schema: `{"type":"object","properties":{"regions":{"type":"array","items":{"type":"string","x-mcp-header":"Region"}}}}`,
			reason: "reachable from the schema root",
		},
		{
			name: "an annotation under a composition keyword",
			schema: `{"type":"object","properties":{"region":{"anyOf":[
				{"type":"string","x-mcp-header":"Region"},{"type":"null"}]}}}`,
			reason: "reachable from the schema root",
		},
		{
			name:   "an annotation under $defs",
			schema: `{"type":"object","$defs":{"Region":{"type":"string","x-mcp-header":"Region"}}}`,
			reason: "reachable from the schema root",
		},
		{
			name:   "an annotation on the schema root",
			schema: `{"type":"object","x-mcp-header":"Root","properties":{}}`,
			reason: "reachable from the schema root",
		},
		{
			name:   "an annotation that is not a string",
			schema: `{"type":"object","properties":{"region":{"type":"string","x-mcp-header":42}}}`,
			reason: "is not a string",
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := readHeaderParams(json.RawMessage(test.schema))
			if err == nil {
				t.Fatal("expected the tool definition to be rejected")
			}
			if !strings.Contains(err.Error(), test.reason) {
				t.Errorf("reason = %q, want it to mention %q", err, test.reason)
			}
		})
	}
}

func TestMirroredValues(t *testing.T) {
	params := []HeaderParam{
		{Name: "Region", Path: []string{"region"}},
		{Name: "Tenant", Path: []string{"target", "tenant"}},
		{Name: "Live", Path: []string{"live"}},
		{Name: "Absent", Path: []string{"absent"}},
		{Name: "Null", Path: []string{"nothing"}},
	}
	arguments := map[string]json.RawMessage{
		"region":  json.RawMessage(`"us-west1"`),
		"target":  json.RawMessage(`{"tenant":42}`),
		"live":    json.RawMessage(`false`),
		"nothing": json.RawMessage(`null`),
	}
	got := mirroredValues(params, arguments)
	want := map[string]string{"Region": "us-west1", "Tenant": "42", "Live": "false"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %#v, want %#v", got, want)
	}
}

package openapi

import (
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// pruneDescriptor compiles a message with a scalar, a collection of each kind, a
// nested message and a free-form member, so every pruning shape can be exercised.
func pruneDescriptor(t *testing.T) protoreflect.MessageDescriptor {
	t.Helper()
	const spec = `
openapi: 3.1.0
info: { title: Prune API, version: "1.0.0" }
paths:
  /things/{id}:
    get:
      operationId: getThing
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Thing" }
components:
  schemas:
    Thing:
      type: object
      properties:
        name: { type: string }
        count: { type: integer }
        tags: { type: array, items: { type: string } }
        parts: { type: array, items: { $ref: "#/components/schemas/Part" } }
        labels: { type: object, additionalProperties: { type: string } }
        anything: {}
        owner: { $ref: "#/components/schemas/Part" }
    Part:
      type: object
      properties:
        id: { type: string }
        size: { type: integer }
`
	s, err := parseSpec([]byte(spec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	gen, err := generateProto(s)
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	dir := t.TempDir()
	if err := gen.write(dir); err != nil {
		t.Fatalf("write proto: %v", err)
	}
	methods, err := compileMethods(dir, gen)
	if err != nil {
		t.Fatalf("compileMethods: %v", err)
	}
	for _, m := range methods {
		return m.output
	}
	t.Fatal("no method compiled")
	return nil
}

func TestPruneMismatched(t *testing.T) {
	desc := pruneDescriptor(t)
	cases := []struct {
		name   string
		body   string
		want   string
		pruned bool
	}{
		{
			name:   "scalar member that cannot be a number is dropped",
			body:   `{"name":"a","count":"https://api.example.test/things/1/items"}`,
			want:   `{"name":"a"}`,
			pruned: true,
		},
		{
			name:   "link answered for a declared collection is dropped",
			body:   `{"name":"a","parts":"https://api.example.test/things/1/parts/items"}`,
			want:   `{"name":"a"}`,
			pruned: true,
		},
		{
			name:   "list keeps the elements that fit",
			body:   `{"tags":["a",3,null,{"x":1},"b"]}`,
			want:   `{"tags":["a","b"]}`,
			pruned: true,
		},
		{
			name:   "message element is repaired rather than dropped",
			body:   `{"parts":[{"id":"p1","size":"big"},{"id":"p2","size":2}]}`,
			want:   `{"parts":[{"id":"p1"},{"id":"p2","size":2}]}`,
			pruned: true,
		},
		{
			name:   "map keeps the entries that fit",
			body:   `{"labels":{"a":"x","b":5}}`,
			want:   `{"labels":{"a":"x"}}`,
			pruned: true,
		},
		{
			name:   "nested member is repaired rather than dropped",
			body:   `{"owner":{"id":"p1","size":[1]}}`,
			want:   `{"owner":{"id":"p1"}}`,
			pruned: true,
		},
		{
			name:   "free-form member takes any value",
			body:   `{"anything":"https://api.example.test/things/1/items"}`,
			want:   `{"anything":"https://api.example.test/things/1/items"}`,
			pruned: false,
		},
		{
			name:   "unknown member is left for DiscardUnknown",
			body:   `{"mystery":[1],"name":3}`,
			want:   `{"mystery":[1]}`,
			pruned: true,
		},
		{
			name:   "a body that is not the object is left alone",
			body:   `["a","b"]`,
			want:   `["a","b"]`,
			pruned: false,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, pruned := pruneMismatched(desc, []byte(c.body))
			if pruned != c.pruned {
				t.Errorf("pruned = %v, want %v", pruned, c.pruned)
			}
			assertJSONEq(t, got, c.want)
			if pruned {
				msg := dynamicpb.NewMessage(desc)
				if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(got, msg); err != nil {
					t.Errorf("pruned JSON does not decode: %v", err)
				}
			}
		})
	}
}

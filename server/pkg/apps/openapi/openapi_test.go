package openapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/dynamicpb"

	"github.com/wham/kaja/v2/pkg/apps"
	kajagen "github.com/wham/kaja/v2/protoc-gen-kaja/kaja"
	"github.com/wham/protoc-go/protoc"
)

// encodeRequest builds the protobuf request bytes for a method from a JSON object.
func encodeRequest(t *testing.T, inst *instance, method, requestJSON string) []byte {
	t.Helper()
	m := inst.lookup(method)
	if m == nil {
		t.Fatalf("method %q not found", method)
	}
	msg := dynamicpb.NewMessage(m.input)
	if err := protojson.Unmarshal([]byte(requestJSON), msg); err != nil {
		t.Fatalf("build request for %q: %v", method, err)
	}
	b, err := proto.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	return b
}

// decodeResponse turns a method's protobuf response bytes back into JSON.
func decodeResponse(t *testing.T, inst *instance, method string, result *invoked) []byte {
	t.Helper()
	m := inst.lookup(method)
	msg := dynamicpb.NewMessage(m.output)
	if err := proto.Unmarshal(result.Body, msg); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	j, err := protojson.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal response json: %v", err)
	}
	return j
}

const petstoreSpec = `
openapi: 3.0.0
info:
  title: Swagger Petstore
  version: 1.0.0
servers:
  - url: /v3
paths:
  /pets:
    get:
      operationId: listPets
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Pet"
    post:
      operationId: createPet
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Pet"
      responses:
        "201":
          description: created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Pet"
  /pets/{petId}:
    get:
      operationId: getPetById
      parameters:
        - name: petId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Pet"
components:
  schemas:
    Pet:
      type: object
      properties:
        id:
          type: integer
        name:
          type: string
        tag:
          type: string
`

func parseOrFatal(t *testing.T) *spec {
	t.Helper()
	s, err := parseSpec([]byte(petstoreSpec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	return s
}

func TestGenerateProto(t *testing.T) {
	gen, err := generateProto(parseOrFatal(t))
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}

	if want := []string{"openapi.swagger_petstore.SwaggerPetstore"}; len(gen.serviceTypeNames) != 1 || gen.serviceTypeNames[0] != want[0] {
		t.Errorf("serviceTypeNames = %q, want %q", gen.serviceTypeNames, want)
	}

	for _, frag := range []string{
		"syntax = \"proto3\";",
		"package openapi.swagger_petstore;",
		"message Pet {",
		"int32 id = 1 [json_name = \"id\"];",
		"string name = 2 [json_name = \"name\"];",
		"rpc ListPets(ListPetsRequest) returns (ListPetsResponse) {",
		// The body is the operation's whole input, so it is the request itself.
		"rpc CreatePet(Pet) returns (Pet) {",
		"rpc GetPetById(GetPetByIdRequest) returns (Pet) {",
		// An array response has no message to be, so it is wrapped - and the
		// wrapper says it is one.
		"repeated Pet items = 1 [json_name = \"items\", (kaja.http_payload) = HTTP_PAYLOAD_ITEMS];",
		"import \"kaja/http.proto\";",
		// path + query params become fields
		"int32 pet_id = 1 [json_name = \"petId\", (kaja.http_in) = \"path\", (kaja.http_required) = true];",
		"int32 limit = 1 [json_name = \"limit\", (kaja.http_in) = \"query\"];",
	} {
		if !strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto missing %q\n---\n%s", frag, gen.proto)
		}
	}

	for _, key := range []string{
		"openapi.swagger_petstore.SwaggerPetstore/ListPets",
		"openapi.swagger_petstore.SwaggerPetstore/CreatePet",
		"openapi.swagger_petstore.SwaggerPetstore/GetPetById",
	} {
		if _, ok := gen.bindings[key]; !ok {
			t.Errorf("missing binding %q", key)
		}
	}

	if b := gen.bindings["openapi.swagger_petstore.SwaggerPetstore/GetPetById"]; b != nil {
		if b.verb != "GET" || b.pathTemplate != "/pets/{petId}" || len(b.pathParams) != 1 || b.pathParams[0] != "petId" {
			t.Errorf("GetPetById binding unexpected: %+v", b)
		}
		if b.responseWrap != "object" {
			t.Errorf("GetPetById responseWrap = %q, want object", b.responseWrap)
		}
	}
	if b := gen.bindings["openapi.swagger_petstore.SwaggerPetstore/ListPets"]; b != nil {
		if b.responseWrap != "array" || len(b.queryParams) != 1 || b.queryParams[0].name != "limit" {
			t.Errorf("ListPets binding unexpected: %+v", b)
		}
	}
}

// TestGenerateProtoTagGrouping checks that operations are split into one service
// per OpenAPI tag, with untagged operations falling into the title-named service.
func TestGenerateProtoTagGrouping(t *testing.T) {
	const taggedSpec = `
openapi: 3.0.0
info:
  title: Store
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      tags: ["Pets"]
      responses:
        "200": { description: ok }
  /pets/{id}:
    delete:
      operationId: deletePet
      tags: ["Pets"]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "204": { description: gone }
  /orders:
    post:
      operationId: createOrder
      tags: ["Orders"]
      responses:
        "201": { description: created }
  /health:
    get:
      operationId: health
      responses:
        "200": { description: ok }
`
	s, err := parseSpec([]byte(taggedSpec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	gen, err := generateProto(s)
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}

	// Services follow first-appearance order: /health (untagged -> Store) sorts
	// before /orders and /pets.
	want := []string{
		"openapi.store.Store",
		"openapi.store.Orders",
		"openapi.store.Pets",
	}
	if len(gen.serviceTypeNames) != len(want) {
		t.Fatalf("serviceTypeNames = %q, want %q", gen.serviceTypeNames, want)
	}
	for i, w := range want {
		if gen.serviceTypeNames[i] != w {
			t.Errorf("serviceTypeNames[%d] = %q, want %q", i, gen.serviceTypeNames[i], w)
		}
	}

	for _, frag := range []string{
		"service Store {",
		"service Pets {",
		"service Orders {",
		"rpc Health(HealthRequest) returns (HealthResponse) {",
		"rpc ListPets(ListPetsRequest) returns (ListPetsResponse) {",
		"rpc DeletePet(DeletePetRequest) returns (DeletePetResponse) {",
		"rpc CreateOrder(CreateOrderRequest) returns (CreateOrderResponse) {",
	} {
		if !strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto missing %q\n---\n%s", frag, gen.proto)
		}
	}

	for _, key := range []string{
		"openapi.store.Store/Health",
		"openapi.store.Pets/ListPets",
		"openapi.store.Pets/DeletePet",
		"openapi.store.Orders/CreateOrder",
	} {
		if _, ok := gen.bindings[key]; !ok {
			t.Errorf("missing binding %q", key)
		}
	}
}

// meteringSpec mirrors a metering-style API's shapes: parameters declared as
// "#/components/parameters" references, map-typed properties
// (additionalProperties), and "allOf: [$ref]" wrappers around enums and maps.
const meteringSpec = `
openapi: 3.0.0
info:
  title: Metering
  version: 1.0.0
servers:
  - url: /
paths:
  /meters:
    get:
      operationId: listMeters
      parameters:
        - $ref: "#/components/parameters/page"
        - $ref: "#/components/parameters/order"
        - $ref: "#/components/parameters/missing"
        - name: includeDeleted
          in: query
          schema: { type: boolean }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Meter"
components:
  parameters:
    page:
      name: page
      in: query
      schema: { type: integer }
    order:
      name: order
      in: query
      schema:
        allOf:
          - $ref: "#/components/schemas/SortOrder"
        default: ASC
  schemas:
    SortOrder:
      type: string
      enum: [ASC, DESC]
    Metadata:
      type: object
      additionalProperties: { type: string }
    Meter:
      type: object
      properties:
        slug: { type: string }
        groupBy:
          type: object
          additionalProperties: { type: string }
        metadata:
          type: object
          allOf:
            - $ref: "#/components/schemas/Metadata"
          nullable: true
        aggregation:
          allOf:
            - $ref: "#/components/schemas/SortOrder"
`

// TestParameterRefsAndMaps locks in that referenced parameters land in the
// request message (an unresolvable reference is dropped), additionalProperties
// objects become proto maps, and references to enum/map schemas are expanded in
// place instead of producing empty messages.
func TestParameterRefsAndMaps(t *testing.T) {
	s, err := parseSpec([]byte(meteringSpec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	gen, err := generateProto(s)
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}

	for _, frag := range []string{
		`int32 page = 1 [json_name = "page", (kaja.http_in) = "query"];`,
		`string order = 2 [json_name = "order", (kaja.http_in) = "query", (kaja.enum_values) = "ASC", (kaja.enum_values) = "DESC"];`,
		`bool include_deleted = 3 [json_name = "includeDeleted", (kaja.http_in) = "query"];`,
		`string aggregation = 1 [json_name = "aggregation", (kaja.enum_values) = "ASC", (kaja.enum_values) = "DESC"];`,
		`map<string, string> group_by = 2 [json_name = "groupBy"];`,
		`map<string, string> metadata = 3 [json_name = "metadata"];`,
	} {
		if !strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto missing %q\n---\n%s", frag, gen.proto)
		}
	}
	for _, frag := range []string{"message SortOrder", "message Metadata"} {
		if strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto should not contain %q\n---\n%s", frag, gen.proto)
		}
	}

	b := gen.bindings["openapi.metering.Metering/ListMeters"]
	if b == nil {
		t.Fatal("missing ListMeters binding")
	}
	names := make([]string, len(b.queryParams))
	for i, qp := range b.queryParams {
		names[i] = qp.name
	}
	if want := []string{"page", "order", "includeDeleted"}; strings.Join(names, ",") != strings.Join(want, ",") {
		t.Errorf("queryParams = %q, want %q", names, want)
	}
}

// TestInvokeMapField reproduces calling List Meters with empty parameters: the
// upstream response carries map-valued and null map fields, which must decode
// into the generated map<string, string> fields.
func TestInvokeMapField(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, meteringSpec)
	})
	mux.HandleFunc("/meters", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" {
			t.Errorf("unexpected query %q for empty request", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `[{"slug":"tokens","groupBy":{"model":"$.model"},"metadata":null,"aggregation":"SUM"}]`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	opened, err := New().Open(map[string]string{"spec_url": srv.URL + "/openapi.yaml"}, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	inst := opened.Instance.(*instance)

	const method = "openapi.metering.Metering/ListMeters"
	out, err := invoke(inst, method, encodeRequest(t, inst, method, `{}`), nil)
	if err != nil {
		t.Fatalf("ListMeters: %v", err)
	}
	assertJSONEq(t, decodeResponse(t, inst, method, out),
		`{"items":[{"slug":"tokens","groupBy":{"model":"$.model"},"aggregation":"SUM"}]}`)
}

// TestOpenAndInvoke exercises the full path: a fake upstream serves both the spec
// and the REST API; we open the app and invoke each generated method.
func TestOpenAndInvoke(t *testing.T) {
	var lastBody string
	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, petstoreSpec)
	})
	mux.HandleFunc("/v3/pets/1", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":1,"name":"Rex","tag":"dog"}`)
	})
	mux.HandleFunc("/v3/pets", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			b, _ := io.ReadAll(r.Body)
			lastBody = string(b)
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"id":7,"name":"Milo"}`)
			return
		}
		if got := r.URL.Query().Get("limit"); got != "5" {
			t.Errorf("limit query = %q, want 5", got)
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `[{"id":1,"name":"Rex"},{"id":2,"name":"Milo"}]`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	dir := t.TempDir()
	app := New()
	opened, err := app.Open(map[string]string{"spec_url": srv.URL + "/openapi.yaml"}, dir, func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	inst := opened.Instance.(*instance)

	if _, err := os.Stat(filepath.Join(dir, "service.proto")); err != nil {
		t.Errorf("expected service.proto written: %v", err)
	}

	const svc = "openapi.swagger_petstore.SwaggerPetstore"

	// GET /pets/{petId} -> object pass-through
	out, err := invoke(inst, svc+"/GetPetById", encodeRequest(t, inst, svc+"/GetPetById", `{"petId":1}`), nil)
	if err != nil {
		t.Fatalf("GetPetById: %v", err)
	}
	assertJSONEq(t, decodeResponse(t, inst, svc+"/GetPetById", out), `{"id":1,"name":"Rex","tag":"dog"}`)

	// GET /pets?limit=5 -> array wrapped under "items"
	out, err = invoke(inst, svc+"/ListPets", encodeRequest(t, inst, svc+"/ListPets", `{"limit":5}`), nil)
	if err != nil {
		t.Fatalf("ListPets: %v", err)
	}
	var listResp struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(decodeResponse(t, inst, svc+"/ListPets", out), &listResp); err != nil {
		t.Fatalf("ListPets response unmarshal: %v", err)
	}
	if len(listResp.Items) != 2 {
		t.Errorf("ListPets items = %d, want 2", len(listResp.Items))
	}

	// POST /pets: the request message is the body, so it is sent as written.
	out, err = invoke(inst, svc+"/CreatePet", encodeRequest(t, inst, svc+"/CreatePet", `{"name":"Milo","tag":"cat"}`), nil)
	if err != nil {
		t.Fatalf("CreatePet: %v", err)
	}
	assertJSONEq(t, []byte(lastBody), `{"name":"Milo","tag":"cat"}`)
	assertJSONEq(t, decodeResponse(t, inst, svc+"/CreatePet", out), `{"id":7,"name":"Milo"}`)
}

const headerParamSpec = `
openapi: 3.0.0
info: { title: Trace, version: 1.0.0 }
servers:
  - url: https://example.invalid
paths:
  /items/{itemId}:
    patch:
      operationId: patchItem
      parameters:
        - name: itemId
          in: path
          required: true
          schema: { type: string }
        - name: X-Trace-Id
          in: header
          schema: { type: string }
        - name: If-Match
          in: header
          schema: { type: string }
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name: { type: string }
      responses:
        "204": { description: done }
`

// TestHeaderParameters locks in that a header parameter is sent as an HTTP
// request header rather than as part of the payload: it never reaches the body,
// it is reported back among the exchanged request headers, and a value typed for
// this one call outranks a header the app is configured to always send.
func TestHeaderParameters(t *testing.T) {
	var gotHeader http.Header
	var gotBody string
	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, headerParamSpec) })
	mux.HandleFunc("/items/42", func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Clone()
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusNoContent)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	opened, err := New().Open(map[string]string{"spec_url": srv.URL + "/openapi.yaml", "base_url": srv.URL}, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	inst := opened.Instance.(*instance)
	const method = "openapi.trace.Trace/PatchItem"

	request := encodeRequest(t, inst, method, `{"itemId":"42","X-Trace-Id":"abc-123","body":{"name":"Milo"}}`)
	result, err := invoke(inst, method, request, map[string]string{"X-Trace-Id": "configured", "X-Tenant": "acme"})
	if err != nil {
		t.Fatalf("PatchItem: %v", err)
	}

	if got := gotHeader.Get("X-Trace-Id"); got != "abc-123" {
		t.Errorf("X-Trace-Id = %q, want the per-call value abc-123", got)
	}
	if got := gotHeader.Get("X-Tenant"); got != "acme" {
		t.Errorf("X-Tenant = %q, want the configured value acme", got)
	}
	// Declared but left unset: an empty header parameter is not sent at all.
	if _, ok := gotHeader["If-Match"]; ok {
		t.Errorf("If-Match sent though it was left unset: %q", gotHeader.Get("If-Match"))
	}
	assertJSONEq(t, []byte(gotBody), `{"name":"Milo"}`)
	if got := result.RequestHeaders["X-Trace-Id"]; got != "abc-123" {
		t.Errorf("reported request header X-Trace-Id = %q, want abc-123", got)
	}
}

// TestInvokeUpstreamError locks in that an HTTP error response surfaces as a
// structured apps.UpstreamError — status, extracted message, and raw body —
// rather than a flat error string.
func TestInvokeUpstreamError(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, petstoreSpec) })
	mux.HandleFunc("/v3/pets/1", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusBadRequest)
		io.WriteString(w, `{"type":"about:blank","title":"Bad Request","status":400,"detail":"request body has an error: doesn't match schema"}`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	opened, err := New().Open(map[string]string{"spec_url": srv.URL + "/openapi.yaml"}, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	inst := opened.Instance.(*instance)
	const method = "openapi.swagger_petstore.SwaggerPetstore/GetPetById"
	_, err = invoke(inst, method, encodeRequest(t, inst, method, `{"petId":1}`), nil)
	var upstream *apps.UpstreamError
	if !errors.As(err, &upstream) {
		t.Fatalf("expected apps.UpstreamError for 400 upstream, got %v", err)
	}
	if upstream.Status != http.StatusBadRequest {
		t.Errorf("Status = %d, want 400", upstream.Status)
	}
	if upstream.Message != "request body has an error: doesn't match schema" {
		t.Errorf("Message = %q", upstream.Message)
	}
	if !strings.Contains(string(upstream.Body), `"title":"Bad Request"`) {
		t.Errorf("Body = %s", upstream.Body)
	}
	if upstream.Method != http.MethodGet || !strings.HasSuffix(upstream.URL, "/v3/pets/1") {
		t.Errorf("request = %s %s", upstream.Method, upstream.URL)
	}
}

// TestInvokeUnreadableResponse locks in that a 200 the app cannot shape into the
// method's response is reported as the HTTP call it made, with the body verbatim -
// the API deviating from its own document is only visible in what it sent back, and
// a codec error on its own names neither the call nor the answer.
func TestInvokeUnreadableResponse(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, petstoreSpec) })
	mux.HandleFunc("/v3/pets/1", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// The document declares an object; the API answers with an array, which no
		// amount of member pruning can shape into one.
		io.WriteString(w, `["Fido","Rex"]`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	opened, err := New().Open(map[string]string{"spec_url": srv.URL + "/openapi.yaml"}, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	inst := opened.Instance.(*instance)
	const method = "openapi.swagger_petstore.SwaggerPetstore/GetPetById"
	_, err = invoke(inst, method, encodeRequest(t, inst, method, `{"petId":1}`), nil)

	var upstream *apps.UpstreamError
	if !errors.As(err, &upstream) {
		t.Fatalf("expected apps.UpstreamError for an unreadable response, got %v", err)
	}
	if !upstream.Unreadable {
		t.Errorf("Unreadable = false, want true")
	}
	if upstream.Status != http.StatusOK {
		t.Errorf("Status = %d, want 200", upstream.Status)
	}
	if upstream.TransportStatus() != http.StatusBadGateway {
		t.Errorf("TransportStatus = %d, want 502", upstream.TransportStatus())
	}
	// The reason names the message the body was read against, which with the body
	// is the whole diagnosis.
	if !strings.Contains(upstream.Message, "Pet") {
		t.Errorf("Message = %q", upstream.Message)
	}
	if !strings.Contains(string(upstream.Body), `["Fido","Rex"]`) {
		t.Errorf("Body = %s", upstream.Body)
	}
	if upstream.Method != http.MethodGet || !strings.HasSuffix(upstream.URL, "/v3/pets/1") {
		t.Errorf("request = %s %s", upstream.Method, upstream.URL)
	}
}

// TestInvokeMismatchedMemberDropped locks in that a response member whose value
// cannot be read into the field the document declares is dropped like a member
// the document never declared, and the rest of the response is read. The shape is
// a live API drifting from its document: a collection the document declares
// inline answered as a link to it.
func TestInvokeMismatchedMemberDropped(t *testing.T) {
	const spec = `
openapi: 3.1.0
info: { title: Sequence API, version: "1.0.0" }
paths:
  /sequences:
    post:
      operationId: createSequence
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name: { type: string }
      responses:
        "201":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Sequence" }
components:
  schemas:
    Sequence:
      type: object
      properties:
        id: { type: string }
        name: { type: string }
        annotations:
          type: array
          items: { $ref: "#/components/schemas/Annotation" }
        creator:
          oneOf:
            - { $ref: "#/components/schemas/UserRef" }
            - { type: "null" }
    Annotation:
      type: object
      properties:
        start: { type: integer }
    UserRef:
      type: object
      properties:
        id: { type: string }
`
	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, spec) })
	mux.HandleFunc("/sequences", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		io.WriteString(w, `{
  "id": "prtn_1",
  "name": "GFP",
  "annotations": "https://api.example.test/sequences/prtn_1/annotations/items",
  "creator": {"id": "ent_1", "__typename": "User"}
}`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	opened, err := New().Open(map[string]string{"spec_url": srv.URL + "/openapi.yaml", "base_url": srv.URL}, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	inst := opened.Instance.(*instance)
	const method = "openapi.sequence_api.SequenceApi/CreateSequence"
	result, err := invoke(inst, method, encodeRequest(t, inst, method, `{"name":"GFP"}`), nil)
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	// The link the API answered for annotations is dropped; everything else is
	// read, the unknown __typename member discarded as before.
	assertJSONEq(t, decodeResponse(t, inst, method, result),
		`{"id":"prtn_1","name":"GFP","creator":{"id":"ent_1"}}`)
}

// TestInt64Format locks in that integer fields with format int64 map to int64,
// so large IDs (e.g. the petstore's) don't overflow int32 during transcoding.
func TestInt64Format(t *testing.T) {
	const spec = `
openapi: 3.0.0
info:
  title: Big
paths:
  /things/{id}:
    get:
      operationId: getThing
      parameters:
        - name: id
          in: path
          schema:
            type: integer
            format: int64
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Thing"
components:
  schemas:
    Thing:
      type: object
      properties:
        id:
          type: integer
          format: int64
        count:
          type: integer
`
	s, err := parseSpec([]byte(spec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	gen, err := generateProto(s)
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	for _, frag := range []string{
		`int32 count = 1 [json_name = "count"];`, // plain integer -> int32 (fields sorted)
		`int64 id = 2 [json_name = "id"];`,       // format int64 -> int64
	} {
		if !strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto missing %q\n---\n%s", frag, gen.proto)
		}
	}
}

// eventsSpec mirrors an event-ingestion API's shapes: an anyOf union of a
// single event and a batch (mixed shapes), a discriminated oneOf union of
// object variants, structured "+json" content types, and explode/deepObject
// query styles.
const eventsSpec = `
openapi: 3.0.0
info:
  title: Events
  version: 1.0.0
servers:
  - url: /
paths:
  /events:
    post:
      operationId: ingestEvents
      requestBody:
        required: true
        content:
          application/vnd.kaja.events+json:
            schema:
              $ref: "#/components/schemas/IngestEventsBody"
      responses:
        "204":
          description: accepted
    get:
      operationId: listEvents
      parameters:
        - name: expand
          in: query
          style: form
          explode: false
          schema:
            type: array
            items: { type: string }
        - name: filterGroupBy
          in: query
          style: deepObject
          schema:
            type: object
            additionalProperties: { type: string }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Event"
  /cards:
    post:
      operationId: createCard
      requestBody:
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Card"
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Card"
  /metrics:
    get:
      operationId: getMetrics
      responses:
        "200":
          description: ok
          content:
            text/plain:
              schema: { type: string }
components:
  schemas:
    IngestEventsBody:
      anyOf:
        - $ref: "#/components/schemas/Event"
        - type: array
          items:
            $ref: "#/components/schemas/Event"
    Event:
      type: object
      required: [id, type]
      properties:
        id: { type: string }
        type: { type: string }
        total: { type: integer, format: uint64 }
        count: { type: integer, format: uint32 }
    Card:
      oneOf:
        - $ref: "#/components/schemas/FlatCard"
        - $ref: "#/components/schemas/TieredCard"
      discriminator:
        propertyName: type
    FlatCard:
      type: object
      properties:
        type: { type: string, enum: [flat] }
        name: { type: string }
        amount: { type: string }
    TieredCard:
      type: object
      properties:
        type: { type: string, enum: [tiered] }
        name: { type: string }
        tiers:
          type: array
          items: { type: string }
`

// TestUnionSchemas locks in oneOf/anyOf handling: a mixed-shape anyOf models
// its first variant, and a discriminated oneOf of objects merges the variants'
// properties into one message.
func TestUnionSchemas(t *testing.T) {
	s, err := parseSpec([]byte(eventsSpec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	gen, err := generateProto(s)
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}

	for _, frag := range []string{
		// anyOf [Event, Event[]] models the single Event, which is the whole
		// request and so needs no envelope around it.
		`rpc IngestEvents(Event) returns (IngestEventsResponse) {`,
		// integer formats
		`uint64 total = `,
		`uint32 count = `,
		// oneOf [FlatCard, TieredCard] merges into one Card message.
		"message Card {",
		`string amount = 1 [json_name = "amount"];`,
		`string name = 2 [json_name = "name"];`,
		`repeated string tiers = 3 [json_name = "tiers"];`,
		`string type = 4 [json_name = "type", (kaja.enum_values) = "flat", (kaja.enum_values) = "tiered"];`,
		// text/plain response becomes a string value.
		`rpc GetMetrics(GetMetricsRequest) returns (GetMetricsResponse) {`,
	} {
		if !strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto missing %q\n---\n%s", frag, gen.proto)
		}
	}
	if strings.Contains(gen.proto, "message IngestEventsBody") {
		t.Errorf("mixed-shape anyOf should expand in place, not become a message\n---\n%s", gen.proto)
	}

	ingest := gen.bindings["openapi.events.Events/IngestEvents"]
	if ingest == nil {
		t.Fatal("missing IngestEvents binding")
	}
	if !ingest.bodyWhole || ingest.bodyContentType != "application/vnd.kaja.events+json" {
		t.Errorf("IngestEvents binding unexpected: %+v", ingest)
	}
	metrics := gen.bindings["openapi.events.Events/GetMetrics"]
	if metrics == nil || metrics.responseWrap != "text" {
		t.Errorf("GetMetrics binding unexpected: %+v", metrics)
	}
}

// TestIngestEventsInvoke reproduces an event-ingestion call end to end: the
// event fields must reach the upstream as the raw JSON body with the spec's
// "+json" content type, and query parameters must honour their styles.
func TestIngestEventsInvoke(t *testing.T) {
	var gotBody, gotContentType, gotRawQuery string
	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, eventsSpec)
	})
	mux.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			b, _ := io.ReadAll(r.Body)
			gotBody = string(b)
			gotContentType = r.Header.Get("Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		gotRawQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `[]`)
	})
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		io.WriteString(w, "events_total 42")
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	opened, err := New().Open(map[string]string{"spec_url": srv.URL + "/openapi.yaml"}, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	inst := opened.Instance.(*instance)
	const svc = "openapi.events.Events"

	// POST /events with the single-event body.
	out, err := invoke(inst, svc+"/IngestEvents", encodeRequest(t, inst, svc+"/IngestEvents", `{"id":"1","type":"prompt"}`), nil)
	if err != nil {
		t.Fatalf("IngestEvents: %v", err)
	}
	assertJSONEq(t, decodeResponse(t, inst, svc+"/IngestEvents", out), `{}`)
	assertJSONEq(t, []byte(gotBody), `{"id":"1","type":"prompt"}`)
	if gotContentType != "application/vnd.kaja.events+json" {
		t.Errorf("Content-Type = %q, want application/vnd.kaja.events+json", gotContentType)
	}

	// GET /events with csv and deepObject query styles.
	_, err = invoke(inst, svc+"/ListEvents", encodeRequest(t, inst, svc+"/ListEvents",
		`{"expand":["lines","preceding"],"filterGroupBy":{"model":"gpt-4","region":"us"}}`), nil)
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	if want := "expand=lines%2Cpreceding&filterGroupBy%5Bmodel%5D=gpt-4&filterGroupBy%5Bregion%5D=us"; gotRawQuery != want {
		t.Errorf("query = %q, want %q", gotRawQuery, want)
	}

	// GET /metrics returns plain text wrapped as a string value.
	out, err = invoke(inst, svc+"/GetMetrics", encodeRequest(t, inst, svc+"/GetMetrics", `{}`), nil)
	if err != nil {
		t.Fatalf("GetMetrics: %v", err)
	}
	assertJSONEq(t, decodeResponse(t, inst, svc+"/GetMetrics", out), `{"value":"events_total 42"}`)
}

// TestFreeFormResponseDecode reproduces the reported failure: a response whose
// schema types a field loosely (a bare free-form property, or a union that mixes
// scalars) must decode whatever JSON the API actually returns — a boolean, a
// nested object, an array — instead of being forced into a string and rejected
// by protojson.
func TestFreeFormResponseDecode(t *testing.T) {
	const spec = `
openapi: 3.0.0
info:
  title: Loose
  version: 1.0.0
servers:
  - url: /
paths:
  /events:
    get:
      operationId: listEvents
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Event"
components:
  schemas:
    Event:
      type: object
      properties:
        id: { type: string }
        value:
          oneOf:
            - type: string
            - type: boolean
            - type: number
        data:
          description: arbitrary JSON payload
`
	// The upstream returns events whose "value" is a boolean and a number, and a
	// "data" payload that is a nested object — none of which a string field would
	// accept.
	const upstreamBody = `[{"id":"1","value":true,"data":{"nested":[1,true,"x"]}},{"id":"2","value":42.5,"data":"plain string"}]`

	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, spec) })
	mux.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, upstreamBody)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	opened, err := New().Open(map[string]string{"spec_url": srv.URL + "/openapi.yaml"}, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	inst := opened.Instance.(*instance)
	const method = "openapi.loose.Loose/ListEvents"

	out, err := invoke(inst, method, encodeRequest(t, inst, method, `{}`), nil)
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	assertJSONEq(t, decodeResponse(t, inst, method, out),
		`{"items":[{"id":"1","value":true,"data":{"nested":[1,true,"x"]}},{"id":"2","value":42.5,"data":"plain string"}]}`)
}

// TestTranscodeArrayQuery checks that an array-typed query parameter is expanded
// into repeated query values (tags=a&tags=b) rather than a single JSON literal.
func TestTranscodeArrayQuery(t *testing.T) {
	var gotRawQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotRawQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `[]`)
	}))
	defer srv.Close()

	in := &instance{baseURL: srv.URL, client: srv.Client()}
	binding := &methodBinding{verb: "GET", pathTemplate: "/pet/findByTags", queryParams: []queryParam{{name: "tags"}}, responseWrap: "array"}

	if _, err := in.transcode(binding, []byte(`{"tags":["foo","bar"]}`), nil); err != nil {
		t.Fatalf("transcode: %v", err)
	}
	if gotRawQuery != "tags=foo&tags=bar" {
		t.Errorf("query = %q, want %q", gotRawQuery, "tags=foo&tags=bar")
	}
}

// TestOpenFromUploadedSpec opens the app from inline spec content (JSON and
// YAML) instead of a URL, and invokes a method against the fake upstream. The
// spec's absolute server URL points at the upstream so no document URL is needed.
func TestOpenFromUploadedSpec(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":1,"name":"Rex","tag":"dog"}`)
	}))
	defer srv.Close()

	yamlSpec := `
openapi: 3.0.0
info:
  title: Uploaded Petstore
  version: 1.0.0
servers:
  - url: ` + srv.URL + `
paths:
  /pets/{petId}:
    get:
      operationId: getPetById
      parameters:
        - name: petId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: A pet
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: integer }
                  name: { type: string }
                  tag: { type: string }
`
	jsonSpec := fmt.Sprintf(`{
  "openapi": "3.0.0",
  "info": {"title": "Uploaded Petstore", "version": "1.0.0"},
  "servers": [{"url": %q}],
  "paths": {
    "/pets/{petId}": {
      "get": {
        "operationId": "getPetById",
        "parameters": [{"name": "petId", "in": "path", "required": true, "schema": {"type": "integer"}}],
        "responses": {"200": {"description": "A pet", "content": {"application/json": {"schema": {"type": "object", "properties": {"id": {"type": "integer"}, "name": {"type": "string"}, "tag": {"type": "string"}}}}}}}
      }
    }
  }
}`, srv.URL)

	const svc = "openapi.uploaded_petstore.UploadedPetstore"
	for _, tc := range []struct{ name, content string }{{"yaml", yamlSpec}, {"json", jsonSpec}} {
		t.Run(tc.name, func(t *testing.T) {
			opened, err := New().Open(map[string]string{"spec_content": tc.content}, t.TempDir(), func(string) {})
			if err != nil {
				t.Fatalf("Open: %v", err)
			}
			inst := opened.Instance.(*instance)
			out, err := invoke(inst, svc+"/GetPetById", encodeRequest(t, inst, svc+"/GetPetById", `{"petId":1}`), nil)
			if err != nil {
				t.Fatalf("GetPetById: %v", err)
			}
			assertJSONEq(t, decodeResponse(t, inst, svc+"/GetPetById", out), `{"id":1,"name":"Rex","tag":"dog"}`)
		})
	}
}

// TestLoadSpecSendsCredentials verifies the spec fetch authenticates: a URL that
// serves the document only to an authenticated request must load when credentials
// are supplied. Both a bearer token and HTTP Basic are exercised.
func TestLoadSpecSendsCredentials(t *testing.T) {
	spec := `openapi: 3.0.1
info: {title: Guarded, version: "1"}
servers: [{url: "https://api.example.com"}]
paths:
  /ping:
    get:
      responses:
        "200": {description: OK}
`
	for _, tc := range []struct {
		name, wantAuth        string
		token, user, password string
	}{
		{name: "bearer", wantAuth: "Bearer secret-token", token: "secret-token"},
		{name: "basic", wantAuth: "Basic " + base64.StdEncoding.EncodeToString([]byte("user:pass")), user: "user", password: "pass"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != tc.wantAuth {
					http.Redirect(w, r, "/signin", http.StatusFound)
					return
				}
				w.Header().Set("Content-Type", "application/yaml")
				io.WriteString(w, spec)
			}))
			defer srv.Close()

			s, problem := loadSpec(srv.URL+"/openapi.yaml", fetchCredentials{token: tc.token, username: tc.user, password: tc.password}, func(string) {})
			if problem != nil {
				t.Fatalf("loadSpec: %v", problem)
			}
			if s.Info.Title != "Guarded" {
				t.Errorf("title = %q", s.Info.Title)
			}
		})
	}
}

// TestLoadSpecReportsLoginRedirect covers the real failure behind a misleading
// YAML error: an unauthenticated fetch is redirected to an HTML sign-in page,
// which must surface as a web page, not a parse error.
func TestLoadSpecReportsLoginRedirect(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/signin" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			io.WriteString(w, "<!doctype html>\n<html><title>Sign in</title></html>")
			return
		}
		http.Redirect(w, r, "/signin", http.StatusFound)
	}))
	defer srv.Close()

	var logs []string
	_, problem := loadSpec(srv.URL+"/openapi.yaml", fetchCredentials{}, func(m string) { logs = append(logs, m) })
	if problem == nil {
		t.Fatal("expected a problem for an unauthenticated fetch")
	}
	if problem.Kind != problemHTML {
		t.Errorf("kind = %q, want %q (%v)", problem.Kind, problemHTML, problem)
	}
	// The compile log should make the redirect diagnosable.
	joined := strings.Join(logs, "\n")
	if !strings.Contains(joined, "redirected to") || !strings.Contains(joined, "text/html") {
		t.Errorf("logs did not surface the redirect/content-type: %q", joined)
	}
}

// TestLoadSpecReportsUnauthorizedStatus checks that a 401 spec response is
// reported as an authentication problem.
func TestLoadSpecReportsUnauthorizedStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusUnauthorized)
	}))
	defer srv.Close()

	_, problem := loadSpec(srv.URL+"/openapi.yaml", fetchCredentials{}, func(string) {})
	if problem == nil || problem.Kind != problemUnauthorized {
		t.Fatalf("problem = %v, want kind %q", problem, problemUnauthorized)
	}
}

// TestLoadSpecNonYAMLErrorIncludesSnippet checks that a fetched-but-unparseable
// non-HTML body surfaces its content type and a preview, so the log explains the
// failure instead of a bare YAML error.
func TestLoadSpecNonYAMLErrorIncludesSnippet(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"error": "not found", "code": 404}`)
	}))
	defer srv.Close()

	_, problem := loadSpec(srv.URL+"/openapi.yaml", fetchCredentials{}, func(string) {})
	if problem == nil {
		t.Fatal("expected a problem for a non-spec body")
	}
	if !strings.Contains(problem.Detail, "application/json") || !strings.Contains(problem.Detail, "starts with") {
		t.Errorf("detail = %q, want content type and preview", problem.Detail)
	}
}

// TestOpenUploadedSpecRequiresAbsoluteServer rejects an uploaded spec whose
// server URL is relative (or absent): with no document URL there is nothing to
// resolve it against.
func TestOpenUploadedSpecRequiresAbsoluteServer(t *testing.T) {
	relativeServerSpec := `
openapi: 3.0.0
info:
  title: Relative
  version: 1.0.0
servers:
  - url: /v3
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        "200": { description: ok }
`
	if _, err := New().Open(map[string]string{"spec_content": relativeServerSpec}, t.TempDir(), func(string) {}); err == nil {
		t.Fatal("expected error for uploaded spec with relative server URL, got nil")
	}
}

// TestBaseURLOverride checks that the base_url parameter wins over the spec's
// servers list, and rescues an uploaded spec that has no absolute server URL.
func TestBaseURLOverride(t *testing.T) {
	specWithServer := &spec{Servers: []server{{URL: "https://spec.example.com/v1"}}}
	specNoServer := &spec{}
	specTemplatedServer := &spec{Servers: []server{{
		URL:       "https://{region}.example.com/{version}",
		Variables: map[string]serverVariable{"region": {Default: "eu-west"}, "version": {Default: "v2"}},
	}}}

	tests := []struct {
		name     string
		specURL  string
		override string
		spec     *spec
		want     string
	}{
		{"override wins over spec server", "https://docs.example.com/openapi.json", "https://api.example.com/v3", specWithServer, "https://api.example.com/v3"},
		{"override rescues uploaded spec without server", "", "https://api.example.com/v3", specNoServer, "https://api.example.com/v3"},
		{"override trailing slash trimmed", "", "https://api.example.com/v3/", specNoServer, "https://api.example.com/v3"},
		{"blank override falls back to spec server", "https://docs.example.com/openapi.json", "  ", specWithServer, "https://spec.example.com/v1"},
		{"templated server falls back to its variable defaults", "", "", specTemplatedServer, "https://eu-west.example.com/v2"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveBaseURL(tc.specURL, tc.override, tc.spec)
			if err != nil {
				t.Fatalf("resolveBaseURL: %v", err)
			}
			if got != tc.want {
				t.Errorf("resolveBaseURL = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestOpenUploadedSpecWithBaseURLOverride opens an uploaded spec whose server URL
// is relative (normally an error) and confirms the base_url override makes it work.
func TestOpenUploadedSpecWithBaseURLOverride(t *testing.T) {
	relativeServerSpec := `
openapi: 3.0.0
info:
  title: Relative
  version: 1.0.0
servers:
  - url: /v3
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        "200": { description: ok }
`
	opened, err := New().Open(map[string]string{
		"spec_content": relativeServerSpec,
		"base_url":     "https://api.example.com",
	}, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open with base_url override: %v", err)
	}
	if in, ok := opened.Instance.(*instance); !ok || in.baseURL != "https://api.example.com" {
		t.Fatalf("baseURL = %q, want %q", opened.Instance.(*instance).baseURL, "https://api.example.com")
	}
}

// TestOpenRequiresSpecSource rejects an app configured with neither a URL nor
// uploaded content.
func TestOpenRequiresSpecSource(t *testing.T) {
	if _, err := New().Open(map[string]string{}, t.TempDir(), func(string) {}); err == nil {
		t.Fatal("expected error when neither spec_url nor spec_content is set, got nil")
	}
}

func TestOpenRejectsNonHTTPScheme(t *testing.T) {
	for _, specURL := range []string{"file:///etc/passwd", "gopher://example.com/", "ftp://example.com/spec.yaml"} {
		if _, err := New().Open(map[string]string{"spec_url": specURL}, t.TempDir(), func(string) {}); err == nil {
			t.Errorf("expected error opening spec_url %q, got nil", specURL)
		}
	}
}

func assertJSONEq(t *testing.T, got []byte, want string) {
	t.Helper()
	var g, w any
	if err := json.Unmarshal(got, &g); err != nil {
		t.Fatalf("unmarshal got %s: %v", got, err)
	}
	if err := json.Unmarshal([]byte(want), &w); err != nil {
		t.Fatalf("unmarshal want: %v", err)
	}
	gb, _ := json.Marshal(g)
	wb, _ := json.Marshal(w)
	if string(gb) != string(wb) {
		t.Errorf("JSON mismatch\n got: %s\nwant: %s", gb, wb)
	}
}

// OpenAPI 3.1 (JSON Schema) lets a schema "type" be an array, e.g.
// ["string", "null"] for a nullable value. We keep the first non-"null" entry
// so a 3.1 nullable type generates the same proto field as its 3.0 counterpart.
func TestOpenAPI31NullableType(t *testing.T) {
	const spec = `
openapi: 3.1.0
info: { title: Nullable API, version: "1.0.0" }
servers: [{ url: https://example.test }]
paths:
  /events:
    get:
      operationId: listEvents
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Event" }
components:
  schemas:
    Event:
      type: object
      properties:
        id: { type: string }
        nextPerformanceId: { type: ["string", "null"] }
        capacity: { type: ["integer", "null"], format: int64 }
`
	s, err := parseSpec([]byte(spec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	gen, err := generateProto(s)
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	for _, frag := range []string{
		"message Event {",
		"string next_performance_id = ",
		"int64 capacity = ",
	} {
		if !strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto missing %q\n---\n%s", frag, gen.proto)
		}
	}

	// The generated proto must compile into descriptors.
	dir := t.TempDir()
	if err := gen.write(dir); err != nil {
		t.Fatalf("write proto: %v", err)
	}
	if _, err := compileMethods(dir, gen); err != nil {
		t.Fatalf("compileMethods: %v", err)
	}
}

// The other way OpenAPI 3.1 writes a nullable value is a union with a bare
// {"type": "null"} variant. It says exactly what ["string", "null"] says, so the
// null entry is dropped before the union is classified: the field keeps the type
// the API declares instead of degrading to google.protobuf.Value, a $ref stays the
// shared message rather than being copied into an inline one, and a union of object
// variants still merges into the superset message.
func TestOpenAPI31NullableUnion(t *testing.T) {
	const spec = `
openapi: 3.1.0
info: { title: Nullable Union API, version: "1.0.0" }
servers: [{ url: https://example.test }]
paths:
  /events:
    get:
      operationId: listEvents
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Event" }
components:
  schemas:
    Event:
      type: object
      properties:
        id: { type: string }
        authors:
          oneOf:
            - { type: string, format: uri }
            - { type: "null" }
        capacity:
          oneOf:
            - { type: integer, format: int64 }
            - { type: "null" }
        aliases:
          oneOf:
            - { type: array, items: { type: string } }
            - { type: "null" }
        folder:
          oneOf:
            - { $ref: "#/components/schemas/FolderRef" }
            - { type: "null" }
        scale:
          oneOf:
            - { $ref: "#/components/schemas/FlatScale" }
            - { $ref: "#/components/schemas/TieredScale" }
            - { type: "null" }
    FolderRef:
      type: object
      properties:
        id: { type: string }
    FlatScale:
      type: object
      properties:
        factor: { type: number, format: double }
    TieredScale:
      type: object
      properties:
        tiers: { type: integer }
`
	s, err := parseSpec([]byte(spec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	gen, err := generateProto(s)
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}
	for _, frag := range []string{
		"message Event {",
		"string authors = ",
		"int64 capacity = ",
		"repeated string aliases = ",
		// The one remaining variant is a $ref, so the property keeps the shared
		// message instead of merging its properties into a copy of it.
		"FolderRef folder = ",
		// Two object variants still merge into one superset message.
		"double factor = ",
		"int32 tiers = ",
	} {
		if !strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto missing %q\n---\n%s", frag, gen.proto)
		}
	}
	if strings.Contains(gen.proto, "google.protobuf.Value") {
		t.Errorf("nullable union degraded to Value\n---\n%s", gen.proto)
	}

	// The generated proto must compile into descriptors.
	dir := t.TempDir()
	if err := gen.write(dir); err != nil {
		t.Fatalf("write proto: %v", err)
	}
	if _, err := compileMethods(dir, gen); err != nil {
		t.Fatalf("compileMethods: %v", err)
	}
}

func TestOpenAPITypeUnmarshal(t *testing.T) {
	cases := map[string]string{
		`"string"`:           "string",
		`["string","null"]`:  "string",
		`["null","integer"]`: "integer",
		`["null"]`:           "",
		`null`:               "",
	}
	for in, want := range cases {
		var ty openAPIType
		if err := json.Unmarshal([]byte(in), &ty); err != nil {
			t.Errorf("unmarshal %s: %v", in, err)
			continue
		}
		if string(ty) != want {
			t.Errorf("unmarshal %s = %q, want %q", in, string(ty), want)
		}
	}
}

// TestGenerateProtoHTTPMarks checks the marks that tell a caller what a method
// does and what it has to send: the HTTP request behind each method, where a
// parameter travels, which fields the API insists on, and the descriptions it
// gives them.
func TestGenerateProtoHTTPMarks(t *testing.T) {
	const markedSpec = `
openapi: 3.0.0
info:
  title: Meters
  version: 1.0.0
paths:
  /meters:
    get:
      operationId: listMeters
      parameters:
        - name: pageSize
          in: query
          description: |
            How many meters to return. Defaults to 25 when omitted.
          schema: { type: integer }
      responses:
        "200": { description: ok }
    post:
      operationId: createMeter
      requestBody:
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Meter"
      responses:
        "201": { description: created }
components:
  schemas:
    Meter:
      type: object
      required: [slug]
      properties:
        slug:
          type: string
          description: Unique identifier of the meter.
        note:
          type: string
`
	s, err := parseSpec([]byte(markedSpec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	gen, err := generateProto(s)
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}

	for _, frag := range []string{
		`option (kaja.http_request) = "GET /meters";`,
		`option (kaja.http_request) = "POST /meters";`,
		`// Unique identifier of the meter.`,
		`string slug = 2 [json_name = "slug", (kaja.http_required) = true];`,
		`string note = 1 [json_name = "note"];`,
		// A description is folded to its first sentence, so a listing built from
		// it stays one line per field.
		`// How many meters to return.`,
		`int32 page_size = 1 [json_name = "pageSize", (kaja.http_in) = "query"];`,
	} {
		if !strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto missing %q\n---\n%s", frag, gen.proto)
		}
	}

	// The generated proto must still compile with the option file beside it.
	dir := t.TempDir()
	if err := gen.write(dir); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := compileMethods(dir, gen); err != nil {
		t.Fatalf("compileMethods: %v", err)
	}
}

// TestGenerateTypeScriptCarriesHTTPMarks closes the loop the marks exist for:
// a spec becomes a proto, the proto compiles, and protoc-gen-kaja carries the
// options into the generated TypeScript, which is where the client and the MCP
// catalog read them from. Everything upstream of that is only a proto file.
func TestGenerateTypeScriptCarriesHTTPMarks(t *testing.T) {
	const spec = `
openapi: 3.0.0
info:
  title: Meters
  version: 1.0.0
paths:
  /meters/{slug}:
    get:
      operationId: getMeter
      parameters:
        - name: slug
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Meter"
components:
  schemas:
    Meter:
      type: object
      required: [slug]
      properties:
        slug:
          type: string
          description: Unique identifier of the meter.
        state:
          type: string
          enum: [active, paused]
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
		t.Fatalf("write: %v", err)
	}

	result, err := protoc.New(protoc.WithProtoPaths(dir)).Compile("service.proto", "kaja/http.proto")
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	files, err := result.RunLibraryPlugin(kajagen.NewPlugin(), "")
	if err != nil {
		t.Fatalf("protoc-gen-kaja: %v", err)
	}

	var ts string
	for _, f := range files {
		if strings.HasSuffix(f.Name, "service.ts") {
			ts = f.Content
		}
	}
	if ts == "" {
		t.Fatalf("no service.ts generated from %v", files)
	}

	// A field carrying values is still the string it was: the set is read beside
	// the field, never in place of its type.
	if !strings.Contains(ts, "state: string;") {
		t.Errorf("declared values must leave the field a string\n---\n%s", ts)
	}

	for _, frag := range []string{
		`"kaja.http_request": "GET /meters/{slug}"`,
		`"kaja.http_in": "path"`,
		`"kaja.http_required": true`,
		`"kaja.enum_values": ["active", "paused"]`,
		// The API's description reaches the generated interface as JSDoc, which is
		// what the MCP catalog reads a field's doc from.
		"Unique identifier of the meter.",
	} {
		if !strings.Contains(ts, frag) {
			t.Errorf("generated TypeScript missing %q\n---\n%s", frag, ts)
		}
	}
}

// enumValuesSpec declares a closed set of values in each of the ways a document
// spells one, beside the shapes that only look like one.
const enumValuesSpec = `
openapi: 3.0.0
info:
  title: Pets
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: findPets
      parameters:
        - name: status
          in: query
          schema: { type: string, enum: [available, pending, sold] }
        - name: kinds
          in: query
          schema:
            type: array
            items: { type: string, enum: [cat, dog] }
        - name: size
          in: query
          schema: { type: integer, enum: [1, 2, 3] }
        - name: mood
          in: query
          schema: { type: string, enum: [calm, null] }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Pet"
components:
  schemas:
    Pet:
      type: object
      properties:
        state:
          allOf:
            - $ref: "#/components/schemas/State"
          default: available
        origin:
          anyOf:
            - $ref: "#/components/schemas/State"
            - type: string
        habitat:
          oneOf:
            - { type: string, enum: [indoor] }
            - { type: string, enum: [outdoor] }
        tally:
          type: string
          enum: [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x, y]
    State:
      type: string
      enum: [available, sold]
`

// TestDeclaredEnumValues locks in what reaches (kaja.enum_values): the values a
// document declares for a field, wherever it declares them, and nothing where
// the field takes more than a list.
func TestDeclaredEnumValues(t *testing.T) {
	s, err := parseSpec([]byte(enumValuesSpec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	gen, err := generateProto(s)
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}

	for _, frag := range []string{
		// The values a parameter declares outright.
		`string status = 1 [json_name = "status", (kaja.http_in) = "query", (kaja.enum_values) = "available", (kaja.enum_values) = "pending", (kaja.enum_values) = "sold"];`,
		// An array declares them on the items it repeats.
		`repeated string kinds = 2 [json_name = "kinds", (kaja.http_in) = "query", (kaja.enum_values) = "cat", (kaja.enum_values) = "dog"];`,
		// A nullable enum lists a null proto3 has no need of; the rest still
		// stands.
		`string mood = 4 [json_name = "mood", (kaja.http_in) = "query", (kaja.enum_values) = "calm"];`,
		// An "allOf: [$ref]" wrapper attaching a default is read through to the
		// component holding the values.
		`string state = 3 [json_name = "state", (kaja.enum_values) = "available", (kaja.enum_values) = "sold"];`,
		// Every variant of the union declares values, so the field takes their
		// union and no more.
		`string habitat = 1 [json_name = "habitat", (kaja.enum_values) = "indoor", (kaja.enum_values) = "outdoor"];`,
	} {
		if !strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto missing %q\n---\n%s", frag, gen.proto)
		}
	}

	// An integer enum carries nothing: the values would be read back as the
	// strings they are not. A number is written the same way in every document
	// anyway.
	if !strings.Contains(gen.proto, `int32 size = 3 [json_name = "size", (kaja.http_in) = "query"];`) {
		t.Errorf("a non-string enum must carry no values\n---\n%s", gen.proto)
	}
	// One variant of the union takes any string, so the field takes more than
	// the other variant lists and carries none of it.
	if !strings.Contains(gen.proto, `string origin = 2 [json_name = "origin"];`) {
		t.Errorf("a union with an open-ended variant must carry no values\n---\n%s", gen.proto)
	}
	// Past the cap the set is dropped whole rather than cut short, which would
	// claim the API takes less than it does.
	if !strings.Contains(gen.proto, `string tally = 4 [json_name = "tally"];`) {
		t.Errorf("a set past the cap must be dropped whole\n---\n%s", gen.proto)
	}
}

// namespacedSpec mirrors an API whose tags and operationIds are dotted paths
// that all restate the API's own name, and restate the resource again in every
// operation: "Lab.Sequence.Get" under the tag "Lab.Sequence".
const namespacedSpec = `
openapi: 3.0.0
info:
  title: Lab
  version: 1.0.0
paths:
  /sequences:
    get:
      operationId: Lab.Sequence.List
      tags: ["Lab.Sequence", "Tier 5 Rate Limit"]
      responses:
        "200": { description: ok }
  /sequences/{id}:
    get:
      operationId: Lab.Sequence.Get
      tags: ["Lab.Sequence"]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200": { description: ok }
  /sequences/{id}/authors:
    get:
      operationId: Lab.Sequence.authors.List
      tags: ["Lab.Sequence"]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200": { description: ok }
  /schemas/{id}:
    get:
      operationId: Lab.SequenceSchema.Get
      tags: ["Lab.SequenceSchema"]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200": { description: ok }
  /tasks/{id}:
    get:
      operationId: Lab.BulkTask.Get
      tags: ["Lab.Tasks"]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200": { description: ok }
`

func TestGenerateProtoTrimsRepeatedNames(t *testing.T) {
	s, err := parseSpec([]byte(namespacedSpec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	gen, err := generateProto(s)
	if err != nil {
		t.Fatalf("generateProto: %v", err)
	}

	for _, frag := range []string{
		// "Lab." is on every tag and every operationId, so it says nothing the
		// app's own name does not, and the service is what is left of the tag.
		"service Sequence {",
		"service SequenceSchema {",
		// A method is read inside its service, so it drops the service's name and
		// keeps what it adds. Two services may both declare Get.
		"rpc List(SequenceListRequest) returns (SequenceListResponse) {",
		"rpc Get(SequenceGetRequest) returns (SequenceGetResponse) {",
		"rpc AuthorsList(SequenceAuthorsListRequest) returns (SequenceAuthorsListResponse) {",
		"rpc Get(SequenceSchemaGetRequest) returns (SequenceSchemaGetResponse) {",
		// An operationId that does not start with its own tag is left whole
		// rather than trimmed at a guess.
		"rpc BulkTaskGet(BulkTaskGetRequest) returns (BulkTaskGetResponse) {",
	} {
		if !strings.Contains(gen.proto, frag) {
			t.Errorf("generated proto missing %q\n---\n%s", frag, gen.proto)
		}
	}

	for _, key := range []string{
		"openapi.lab.Sequence/List",
		"openapi.lab.Sequence/Get",
		"openapi.lab.Sequence/AuthorsList",
		"openapi.lab.SequenceSchema/Get",
		"openapi.lab.Tasks/BulkTaskGet",
	} {
		if _, ok := gen.bindings[key]; !ok {
			t.Errorf("missing binding %q, have %v", key, slices.Sorted(maps.Keys(gen.bindings)))
		}
	}
}

func TestSharedNamespace(t *testing.T) {
	for _, tc := range []struct {
		name string
		spec string
		want string
	}{
		{"agreed", namespacedSpec, "Lab"},
		{"undotted names have no namespace to share", petstoreSpec, ""},
		{
			name: "a segment two operations disagree on is telling them apart",
			spec: `
openapi: 3.0.0
info: { title: Lab, version: 1.0.0 }
paths:
  /a: { get: { operationId: One.Get, responses: { "200": { description: ok } } } }
  /b: { get: { operationId: Two.Get, responses: { "200": { description: ok } } } }
`,
			want: "",
		},
		{
			name: "one namespaced operation is not a convention",
			spec: `
openapi: 3.0.0
info: { title: Lab, version: 1.0.0 }
paths:
  /a: { get: { operationId: One.Get, responses: { "200": { description: ok } } } }
  /b: { get: { operationId: plain, responses: { "200": { description: ok } } } }
`,
			want: "",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, err := parseSpec([]byte(tc.spec))
			if err != nil {
				t.Fatalf("parseSpec: %v", err)
			}
			if got := sharedNamespace(s); got != tc.want {
				t.Errorf("sharedNamespace = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestTrimServiceName(t *testing.T) {
	for _, tc := range []struct{ method, service, want string }{
		{"SequenceGet", "Sequence", "Get"},
		{"SequenceSchemaGet", "SequenceSchema", "Get"},
		// The remainder has to start a new word, or the trim is cutting a longer
		// name in half.
		{"SequenceSchemaGet", "Sequences", "SequenceSchemaGet"},
		{"Sequences", "Sequence", "Sequences"},
		// A method that is nothing but its service's name keeps it.
		{"Sequence", "Sequence", "Sequence"},
		{"ListPets", "Pets", "ListPets"},
	} {
		if got := trimServiceName(tc.method, tc.service); got != tc.want {
			t.Errorf("trimServiceName(%q, %q) = %q, want %q", tc.method, tc.service, got, tc.want)
		}
	}
}

// invoked is one call as these tests read it. Every app here answers with one message,
// so the stream a call hands back is collapsed to that message and the report beside it.
type invoked struct {
	Body            []byte
	RequestHeaders  map[string]string
	ResponseHeaders map[string]string
}

func invoke(in *instance, method string, request []byte, headers map[string]string) (*invoked, error) {
	stream, err := in.Invoke(context.Background(), &apps.Call{Method: method, Request: request, Headers: headers})
	if err != nil {
		return nil, err
	}
	body, err := stream.Recv()
	if err != nil {
		return nil, err
	}
	result := &invoked{Body: body}
	if report := stream.Report(); report != nil {
		result.RequestHeaders = report.RequestHeaders
		result.ResponseHeaders = report.ResponseHeaders
	}
	return result, nil
}

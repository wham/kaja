package openapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/dynamicpb"
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
func decodeResponse(t *testing.T, inst *instance, method string, response []byte) []byte {
	t.Helper()
	m := inst.lookup(method)
	msg := dynamicpb.NewMessage(m.output)
	if err := proto.Unmarshal(response, msg); err != nil {
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
		"rpc ListPets(ListPetsRequest) returns (ListPetsResponse);",
		"rpc CreatePet(CreatePetRequest) returns (Pet);",
		"rpc GetPetById(GetPetByIdRequest) returns (Pet);",
		// array response is wrapped
		"repeated Pet items = 1 [json_name = \"items\"];",
		// request body becomes a single field
		"Pet body = 1 [json_name = \"body\"];",
		// path + query params become fields
		"int32 pet_id = 1 [json_name = \"petId\"];",
		"int32 limit = 1 [json_name = \"limit\"];",
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
		if b.responseWrap != "array" || len(b.queryParams) != 1 || b.queryParams[0] != "limit" {
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
		"rpc Health(HealthRequest) returns (HealthResponse);",
		"rpc ListPets(ListPetsRequest) returns (ListPetsResponse);",
		"rpc DeletePet(DeletePetRequest) returns (DeletePetResponse);",
		"rpc CreateOrder(CreateOrderRequest) returns (CreateOrderResponse);",
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
	inst := opened.(*instance)

	if _, err := os.Stat(filepath.Join(dir, "service.proto")); err != nil {
		t.Errorf("expected service.proto written: %v", err)
	}

	const svc = "openapi.swagger_petstore.SwaggerPetstore"

	// GET /pets/{petId} -> object pass-through
	out, err := inst.Invoke(svc+"/GetPetById", encodeRequest(t, inst, svc+"/GetPetById", `{"petId":1}`), nil)
	if err != nil {
		t.Fatalf("GetPetById: %v", err)
	}
	assertJSONEq(t, decodeResponse(t, inst, svc+"/GetPetById", out), `{"id":1,"name":"Rex","tag":"dog"}`)

	// GET /pets?limit=5 -> array wrapped under "items"
	out, err = inst.Invoke(svc+"/ListPets", encodeRequest(t, inst, svc+"/ListPets", `{"limit":5}`), nil)
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

	// POST /pets with body
	out, err = inst.Invoke(svc+"/CreatePet", encodeRequest(t, inst, svc+"/CreatePet", `{"body":{"name":"Milo","tag":"cat"}}`), nil)
	if err != nil {
		t.Fatalf("CreatePet: %v", err)
	}
	assertJSONEq(t, []byte(lastBody), `{"name":"Milo","tag":"cat"}`)
	assertJSONEq(t, decodeResponse(t, inst, svc+"/CreatePet", out), `{"id":7,"name":"Milo"}`)
}

func TestInvokeUpstreamError(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, petstoreSpec) })
	mux.HandleFunc("/v3/pets/1", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"boom"}`, http.StatusInternalServerError)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	opened, err := New().Open(map[string]string{"spec_url": srv.URL + "/openapi.yaml"}, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	inst := opened.(*instance)
	const method = "openapi.swagger_petstore.SwaggerPetstore/GetPetById"
	if _, err := inst.Invoke(method, encodeRequest(t, inst, method, `{"petId":1}`), nil); err == nil {
		t.Fatal("expected error for 500 upstream, got nil")
	}
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
	binding := &methodBinding{verb: "GET", pathTemplate: "/pet/findByTags", queryParams: []string{"tags"}, responseWrap: "array"}

	if _, err := in.transcode(binding, []byte(`{"tags":["foo","bar"]}`), nil); err != nil {
		t.Fatalf("transcode: %v", err)
	}
	if gotRawQuery != "tags=foo&tags=bar" {
		t.Errorf("query = %q, want %q", gotRawQuery, "tags=foo&tags=bar")
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

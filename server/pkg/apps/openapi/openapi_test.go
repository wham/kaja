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
)

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

	if want := "openapi.swagger_petstore.SwaggerPetstore"; gen.serviceTypeName != want {
		t.Errorf("serviceTypeName = %q, want %q", gen.serviceTypeName, want)
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
	inst, err := app.Open(map[string]string{"spec_url": srv.URL + "/openapi.yaml"}, dir, func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, "service.proto")); err != nil {
		t.Errorf("expected service.proto written: %v", err)
	}

	const svc = "openapi.swagger_petstore.SwaggerPetstore"

	// GET /pets/{petId} -> object pass-through
	out, err := inst.Invoke(svc+"/GetPetById", []byte(`{"petId":1}`), nil)
	if err != nil {
		t.Fatalf("GetPetById: %v", err)
	}
	assertJSONEq(t, out, `{"id":1,"name":"Rex","tag":"dog"}`)

	// GET /pets?limit=5 -> array wrapped under "items"
	out, err = inst.Invoke(svc+"/ListPets", []byte(`{"limit":5}`), nil)
	if err != nil {
		t.Fatalf("ListPets: %v", err)
	}
	var listResp struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(out, &listResp); err != nil {
		t.Fatalf("ListPets response unmarshal: %v (%s)", err, out)
	}
	if len(listResp.Items) != 2 {
		t.Errorf("ListPets items = %d, want 2 (%s)", len(listResp.Items), out)
	}

	// POST /pets with body
	out, err = inst.Invoke(svc+"/CreatePet", []byte(`{"body":{"name":"Milo","tag":"cat"}}`), nil)
	if err != nil {
		t.Fatalf("CreatePet: %v", err)
	}
	assertJSONEq(t, []byte(lastBody), `{"name":"Milo","tag":"cat"}`)
	assertJSONEq(t, out, `{"id":7,"name":"Milo"}`)
}

func TestInvokeUpstreamError(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, petstoreSpec) })
	mux.HandleFunc("/v3/pets/1", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"boom"}`, http.StatusInternalServerError)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	inst, err := New().Open(map[string]string{"spec_url": srv.URL + "/openapi.yaml"}, t.TempDir(), func(string) {})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if _, err := inst.Invoke("openapi.swagger_petstore.SwaggerPetstore/GetPetById", []byte(`{"petId":1}`), nil); err == nil {
		t.Fatal("expected error for 500 upstream, got nil")
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

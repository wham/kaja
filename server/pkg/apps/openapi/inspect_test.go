package openapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const inspectSpec = `
openapi: 3.0.4
info:
  title: Pet Store
  version: 1.0.27
servers:
  - url: https://api.example.com/v3
    description: Production
  - url: https://sandbox.example.com/v3
    description: Sandbox
security:
  - oauth: [read]
  - api_key: []
paths:
  /pets:
    get:
      tags: [pet]
      responses:
        "200": {description: OK}
    post:
      tags: [pet]
      security:
        - api_key: []
      responses:
        "200": {description: OK}
  /orders:
    get:
      tags: [store]
      security: []
      responses:
        "200": {description: OK}
components:
  securitySchemes:
    oauth:
      type: oauth2
      description: OAuth 2.0
    api_key:
      type: apiKey
      in: header
      name: X-API-KEY
    basicAuth:
      type: http
      scheme: basic
`

func inspectDocument(t *testing.T, parameters map[string]string) *Document {
	t.Helper()
	document, problem := Inspect(parameters, func(string) {})
	if problem != nil {
		t.Fatalf("Inspect: %v (%s)", problem.Message, problem.Kind)
	}
	return document
}

func TestInspectSummarizesDocument(t *testing.T) {
	document := inspectDocument(t, map[string]string{"spec_content": inspectSpec})

	if document.Title != "Pet Store" || document.Version != "1.0.27" || document.OpenAPIVersion != "3.0.4" {
		t.Errorf("identity = %q %q %q", document.Title, document.Version, document.OpenAPIVersion)
	}
	if document.OperationCount != 3 {
		t.Errorf("operations = %d, want 3", document.OperationCount)
	}
	if document.TagCount != 2 {
		t.Errorf("tags = %d, want 2", document.TagCount)
	}
	if !document.PerOperationSecurity {
		t.Error("want per-operation security, two operations override it")
	}
	if len(document.Servers) != 2 || document.Servers[0].URL != "https://api.example.com/v3" || document.Servers[0].Description != "Production" {
		t.Errorf("servers = %+v", document.Servers)
	}
	if document.GuessedBaseURL != "" {
		t.Errorf("guessed base URL = %q, want none when the document declares servers", document.GuessedBaseURL)
	}
}

// The scheme the most operations accept comes first, so the form preselects it.
func TestInspectOrdersSchemesByCoverage(t *testing.T) {
	document := inspectDocument(t, map[string]string{"spec_content": inspectSpec})

	if len(document.SecuritySchemes) != 3 {
		t.Fatalf("schemes = %d, want 3", len(document.SecuritySchemes))
	}
	first := document.SecuritySchemes[0]
	if first.Key != "api_key" || first.OperationCount != 2 {
		t.Errorf("first scheme = %q with %d operations, want api_key with 2", first.Key, first.OperationCount)
	}
	if first.Type != "apiKey" || first.In != "header" || first.ParameterName != "X-API-KEY" {
		t.Errorf("api_key scheme = %+v", first)
	}
	if second := document.SecuritySchemes[1]; second.Key != "oauth" || second.OperationCount != 1 {
		t.Errorf("second scheme = %q with %d operations, want oauth with 1", second.Key, second.OperationCount)
	}
	// Declared but never required: it stays selectable, with no coverage.
	if last := document.SecuritySchemes[2]; last.Key != "basicAuth" || last.OperationCount != 0 {
		t.Errorf("last scheme = %+v, want basicAuth with no coverage", last)
	}
}

// A scheme that only ever appears alongside another one can't be satisfied by a
// single credential, and says so.
func TestInspectMarksSchemesThatNeedOthers(t *testing.T) {
	const spec = `
openapi: 3.1.0
info: {title: Signed, version: "1"}
security:
  - api_key: []
    hmac: []
paths:
  /thing:
    get:
      responses:
        "200": {description: OK}
components:
  securitySchemes:
    api_key: {type: apiKey, in: header, name: X-API-KEY}
    hmac: {type: apiKey, in: header, name: X-Signature}
`
	document := inspectDocument(t, map[string]string{"spec_content": spec})

	for _, scheme := range document.SecuritySchemes {
		if !scheme.RequiresOthers {
			t.Errorf("scheme %q: want requiresOthers", scheme.Key)
		}
		if scheme.OperationCount != 0 {
			t.Errorf("scheme %q: coverage = %d, want 0 - it is never accepted alone", scheme.Key, scheme.OperationCount)
		}
	}
}

func TestInspectReadsServerVariables(t *testing.T) {
	const spec = `
openapi: 3.0.0
info: {title: Regional, version: "1"}
servers:
  - url: https://{region}.example.com/{version}
    variables:
      region:
        default: eu-west
        enum: [eu-west, us-east]
        description: Where your data lives
      version:
        default: v2
paths:
  /thing:
    get:
      responses:
        "200": {description: OK}
`
	document := inspectDocument(t, map[string]string{"spec_content": spec})

	variables := document.Servers[0].Variables
	if len(variables) != 2 {
		t.Fatalf("variables = %+v, want region and version", variables)
	}
	// In the order they appear in the URL, so the fields read like the URL does.
	if variables[0].Name != "region" || variables[0].Default != "eu-west" || len(variables[0].Enum) != 2 {
		t.Errorf("region = %+v", variables[0])
	}
	if variables[1].Name != "version" || variables[1].Default != "v2" || len(variables[1].Enum) != 0 {
		t.Errorf("version = %+v", variables[1])
	}
}

// A relative server URL - how the Petstore and many others write it - is only
// usable once it is resolved against the document it came from.
func TestInspectResolvesRelativeServerURL(t *testing.T) {
	const spec = `
openapi: 3.0.0
info: {title: Relative, version: "1"}
servers:
  - url: /api/v3
paths:
  /thing:
    get:
      responses:
        "200": {description: OK}
`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/yaml")
		io.WriteString(w, spec)
	}))
	defer srv.Close()

	document := inspectDocument(t, map[string]string{"spec_url": srv.URL + "/docs/openapi.yaml"})
	if want := srv.URL + "/api/v3"; document.Servers[0].URL != want {
		t.Errorf("server = %q, want %q", document.Servers[0].URL, want)
	}
}

// With no servers of its own, the origin the document was fetched from is the
// only guess available - and the form says where the guess came from.
func TestInspectGuessesBaseURLFromDocumentURL(t *testing.T) {
	const spec = `
openapi: 3.0.0
info: {title: Serverless, version: "1"}
paths:
  /thing:
    get:
      responses:
        "200": {description: OK}
`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/yaml")
		io.WriteString(w, spec)
	}))
	defer srv.Close()

	document := inspectDocument(t, map[string]string{"spec_url": srv.URL + "/openapi.yaml"})
	if document.GuessedBaseURL != srv.URL {
		t.Errorf("guessed base URL = %q, want %q", document.GuessedBaseURL, srv.URL)
	}
	if len(document.Servers) != 0 {
		t.Errorf("servers = %+v, want none", document.Servers)
	}
}

func TestInspectClassifiesProblems(t *testing.T) {
	tests := []struct {
		name        string
		parameters  map[string]string
		wantKind    problemKind
		wantMessage string
	}{
		{
			name:        "swagger 2.0",
			parameters:  map[string]string{"spec_content": "swagger: \"2.0\"\ninfo: {title: Legacy, version: \"1\"}\n"},
			wantKind:    problemSwagger2,
			wantMessage: "Swagger 2.0",
		},
		{
			name:       "not a document",
			parameters: map[string]string{"spec_content": "{\"error\": \"not found\"}"},
			wantKind:   problemNotADocument,
		},
		{
			name:       "malformed",
			parameters: map[string]string{"spec_content": "openapi: 3.0.0\n  info: oops\n"},
			wantKind:   problemMalformed,
		},
		{
			name:       "unreachable",
			parameters: map[string]string{"spec_url": "https://kaja.invalid/openapi.json"},
			wantKind:   problemUnreachable,
		},
		{
			name:       "no source",
			parameters: map[string]string{},
			wantKind:   problemNotADocument,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			document, problem := Inspect(tc.parameters, func(string) {})
			if document != nil {
				t.Fatalf("want a problem, got document %+v", document)
			}
			if problem.Kind != string(tc.wantKind) {
				t.Errorf("kind = %q, want %q (%s)", problem.Kind, tc.wantKind, problem.Message)
			}
			if tc.wantMessage != "" && !strings.Contains(problem.Message, tc.wantMessage) {
				t.Errorf("message = %q, want it to mention %q", problem.Message, tc.wantMessage)
			}
		})
	}
}

// A document behind a login is read once the spec header is given, and that
// header is sent instead of the API's own credentials.
func TestInspectSendsSpecHeader(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Gate") != "open" {
			http.Error(w, "nope", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/yaml")
		io.WriteString(w, inspectSpec)
	}))
	defer srv.Close()

	if _, problem := Inspect(map[string]string{"spec_url": srv.URL}, func(string) {}); problem == nil || problem.Kind != string(problemUnauthorized) {
		t.Fatalf("problem = %v, want %q", problem, problemUnauthorized)
	}

	document := inspectDocument(t, map[string]string{
		"spec_url":          srv.URL,
		"spec_header_name":  "X-Gate",
		"spec_header_value": "open",
	})
	if document.Title != "Pet Store" {
		t.Errorf("title = %q", document.Title)
	}
}

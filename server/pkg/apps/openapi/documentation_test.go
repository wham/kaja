package openapi

import (
	"strings"
	"testing"
)

const documentedSpec = `
openapi: 3.1.0
info: { title: Theatre, version: "1.0" }
paths:
  /shows:
    get:
      summary: What is playing where
      description: |
        The schedule, soonest first.
      operationId: listShows
      parameters:
        - name: city
          in: query
          description: Only screenings in this city.
          example: Chicago
          schema: { type: string }
      responses:
        "200": { description: One page of the schedule. }
        "400": { description: The limit is out of range. }
  /shows/{showId}:
    get:
      summary: One show
      deprecated: true
      parameters:
        - name: showId
          in: path
          required: true
          schema: { type: string }
      responses:
        "200": { description: The show. }
    delete:
      summary: Cancel a show
      responses:
        "204": { description: Gone. }
`

func documented(t *testing.T) *instance {
	t.Helper()
	s, err := parseSpec([]byte(documentedSpec))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	if s.raw == nil {
		t.Fatal("the document was parsed but not kept")
	}
	return &instance{raw: s.raw}
}

// The point of the fragment is what the generated proto could not carry: the prose
// under a parameter, its example, and the response codes that are never values.
func TestDocumentationShowsWhatTheProtoDropped(t *testing.T) {
	documentation, ok := documented(t).Documentation("GET /shows")
	if !ok {
		t.Fatal("expected GET /shows to be documented")
	}

	if documentation.Summary != "What is playing where" {
		t.Errorf("Summary = %q", documentation.Summary)
	}
	if !strings.Contains(documentation.Description, "The schedule, soonest first.") {
		t.Errorf("Description = %q", documentation.Description)
	}
	if documentation.Language != "yaml" {
		t.Errorf("Language = %q, want yaml", documentation.Language)
	}
	for _, want := range []string{"operationId: listShows", "Only screenings in this city.", "example: Chicago", `"400"`} {
		if !strings.Contains(documentation.Document, want) {
			t.Errorf("document is missing %q:\n%s", want, documentation.Document)
		}
	}
	// It is one operation, not the path item: the sibling verb is not in it.
	if strings.Contains(documentation.Document, "Cancel a show") {
		t.Errorf("document carried a sibling operation:\n%s", documentation.Document)
	}
	// The prose is stated above the fragment, so it is not restated inside it.
	for _, unwanted := range []string{"summary:", "description: |", "What is playing where"} {
		if strings.Contains(documentation.Document, unwanted) {
			t.Errorf("document restated the prose (%q):\n%s", unwanted, documentation.Document)
		}
	}
}

// A templated path is the one a script most needs the document for, and the path is
// carried verbatim from the document into the method's mark, so it is looked up whole.
func TestDocumentationFindsATemplatedPath(t *testing.T) {
	in := documented(t)

	documentation, ok := in.Documentation("GET /shows/{showId}")
	if !ok {
		t.Fatal("expected GET /shows/{showId} to be documented")
	}
	if documentation.Summary != "One show" || !documentation.Deprecated {
		t.Errorf("Summary = %q, Deprecated = %v", documentation.Summary, documentation.Deprecated)
	}

	// Two operations under one path are two answers.
	cancel, ok := in.Documentation("DELETE /shows/{showId}")
	if !ok || cancel.Summary != "Cancel a show" {
		t.Errorf("DELETE /shows/{showId} = %+v, ok = %v", cancel, ok)
	}
}

// A hover with nothing to say says nothing, so every miss is a miss rather than an
// error: a path the document does not declare, a verb it does not declare under a
// path it does, and anything that is not an operation at all.
func TestDocumentationMissesWithoutFailing(t *testing.T) {
	in := documented(t)

	for _, operation := range []string{"GET /nope", "POST /shows", "", "GET", "nonsense", "GET shows", "  "} {
		if documentation, ok := in.Documentation(operation); ok {
			t.Errorf("Documentation(%q) answered %+v, want a miss", operation, documentation)
		}
	}
}

// An operation whose whole declaration is prose has nothing left to show below it,
// and an empty fragment is better than a "{}".
func TestDocumentationLeavesNoEmptyFragment(t *testing.T) {
	s, err := parseSpec([]byte(`
openapi: 3.1.0
info: { title: T, version: "1" }
paths:
  /ping:
    get:
      summary: Ping
      description: Says hello.
`))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}

	documentation, ok := (&instance{raw: s.raw}).Documentation("GET /ping")
	if !ok {
		t.Fatal("expected the operation to be documented")
	}
	if documentation.Document != "" {
		t.Errorf("Document = %q, want empty", documentation.Document)
	}
	if documentation.Summary != "Ping" {
		t.Errorf("Summary = %q", documentation.Summary)
	}
}

func TestDocumentationMissesWhereNoDocumentWasKept(t *testing.T) {
	if _, ok := (&instance{}).Documentation("GET /shows"); ok {
		t.Error("an instance with no document answered for one")
	}
}

// A YAML document and a JSON one are shown the same way, because both have already
// been reduced to JSON by the time they are kept.
func TestDocumentationReadsAJsonDocument(t *testing.T) {
	s, err := parseSpec([]byte(`{"openapi":"3.1.0","info":{"title":"T","version":"1"},"paths":{"/shows":{"get":{"summary":"Shows","responses":{"200":{"description":"ok"}}}}}}`))
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}

	documentation, ok := (&instance{raw: s.raw}).Documentation("GET /shows")
	if !ok {
		t.Fatal("expected the operation to be documented")
	}
	if documentation.Summary != "Shows" {
		t.Errorf("Summary = %q", documentation.Summary)
	}
	// Rendered as YAML whatever the document was written in — the summary having moved
	// out of the fragment and into its own field.
	if !strings.Contains(documentation.Document, "description: ok") {
		t.Errorf("expected YAML, got:\n%s", documentation.Document)
	}
}

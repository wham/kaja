package mcp

import (
	"strings"
	"testing"
)

// An app built from a REST document addresses its methods the way the document does.
// The catalog carries both doors, and what is shown is whichever the method has — so
// the signature an agent reads is the one its example is an instance of.
func restCatalog() Catalog {
	return Catalog{Apps: []CatalogApp{{
		Name:        "theatre",
		Type:        "openapi",
		RestBinding: "theatre",
		Services: []CatalogService{{
			Name:       "Shows",
			ImportPath: "theatre",
			Methods: []CatalogMethod{
				{
					Name:          "GetShow",
					Signature:     "GetShow(input: Input<GetShowRequest>): Call<Show>",
					RestSignature: `get(path: "/shows/{showId}", request: WithPath<GetShowRequest, "showId">, options?: CallOptions): Call<Show>`,
					Input:         "GetShowRequest",
					Output:        "Show",
					HTTP:          "GET /shows/{showId}",
					Doc:           "Fetch one show by its id.",
					Example:       "import { api as theatre } from \"theatre\";\n\ntheatre.get(\"/shows/{showId}\", { showId: \"\" });",
				},
				{
					Name:      "Ping",
					Signature: "Ping(input: Input<PingRequest>): Call<PingResponse>",
					Input:     "PingRequest",
					Output:    "PingResponse",
					Example:   "import { Shows } from \"theatre\";\n\nShows.Ping({});",
				},
			},
		}},
	}}}
}

func TestDescribeMethodShowsTheRestDoor(t *testing.T) {
	catalog := restCatalog()
	resolved, _, ok := catalog.findMethod("Shows.GetShow")
	if !ok {
		t.Fatal("findMethod did not resolve Shows.GetShow")
	}

	out := catalog.describeMethod(resolved)
	if !strings.Contains(out, `import { api as theatre } from "theatre";`) {
		t.Errorf("expected the door's import line, got:\n%s", out)
	}
	if !strings.Contains(out, `theatre.get(path: "/shows/{showId}"`) {
		t.Errorf("expected the door's signature, got:\n%s", out)
	}
	// The service door is a second address, not a second thing to read here.
	if strings.Contains(out, "Shows.GetShow(input:") {
		t.Errorf("expected the service signature to be left out, got:\n%s", out)
	}
}

func TestDescribeMethodKeepsTheServiceDoorWhereThereIsNoPath(t *testing.T) {
	catalog := restCatalog()
	resolved, _, ok := catalog.findMethod("Shows.Ping")
	if !ok {
		t.Fatal("findMethod did not resolve Shows.Ping")
	}

	out := catalog.describeMethod(resolved)
	if !strings.Contains(out, `import { Shows } from "theatre";`) {
		t.Errorf("expected the service import line, got:\n%s", out)
	}
	if !strings.Contains(out, "Shows.Ping(input:") {
		t.Errorf("expected the service signature, got:\n%s", out)
	}
}

// The path is in the signature, so repeating it beside the line says it twice.
func TestListServicesNamesThePathOnceAndKeepsTheEffect(t *testing.T) {
	catalog := restCatalog()
	out := catalog.listServices("", "", "")

	if !strings.Contains(out, `get(path: "/shows/{showId}"`) {
		t.Errorf("expected the door's signature in the index, got:\n%s", out)
	}
	if strings.Count(out, "GET /shows/{showId}") != 0 {
		t.Errorf("expected the HTTP mark to be left out beside it, got:\n%s", out)
	}
	if !strings.Contains(out, "read") {
		t.Errorf("expected the read/write effect to survive, got:\n%s", out)
	}
}

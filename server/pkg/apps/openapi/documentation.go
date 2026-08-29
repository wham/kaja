package openapi

import (
	"encoding/json"
	"strings"

	"github.com/wham/kaja/v2/pkg/apps"
	"sigs.k8s.io/yaml"
)

// Documentation answers with the operation as its own document states it.
//
// The generated proto carries what kaja could model — the request, the response,
// which fields travel in the path — and drops the rest: the examples, the response
// codes the method never returns as values, the vendor extensions, the prose under
// each parameter. That is the half a person reads before writing a call, so it is
// served from the document rather than reconstructed from what was kept.
//
// Lazily, one operation at a time: a document with nine hundred operations would
// otherwise ride along with every compile, and only the one under the cursor is ever
// read.
func (in *instance) Documentation(operation string) (*apps.Documentation, bool) {
	verb, path, ok := splitOperation(operation)
	if !ok || in.raw == nil {
		return nil, false
	}

	body, ok := operationJSON(in.raw, verb, path)
	if !ok {
		return nil, false
	}

	// Read twice: once for the fields worth stating on their own, once as the
	// document to show. Only the second can carry what kaja has no field for.
	var described struct {
		Summary     string `json:"summary"`
		Description string `json:"description"`
		Deprecated  bool   `json:"deprecated"`
	}
	_ = json.Unmarshal(body, &described)

	// The summary and the description are stated above the fragment, so leaving them in
	// it prints the API's own prose twice — and, because JSON objects render in key
	// order, a long description would be the first thing under a heading that has just
	// said it. What is left is what nothing else says: the parameters, the examples,
	// the response codes, and whatever the document declares that kaja has no field for.
	var declared map[string]json.RawMessage
	if err := json.Unmarshal(body, &declared); err != nil {
		return nil, false
	}
	delete(declared, "summary")
	delete(declared, "description")

	remaining, err := json.Marshal(declared)
	if err != nil {
		return nil, false
	}
	document, err := yaml.JSONToYAML(remaining)
	if err != nil {
		return nil, false
	}
	// An operation that declared nothing but prose has an empty document, not "{}".
	if strings.TrimSpace(string(document)) == "{}" {
		document = nil
	}

	return &apps.Documentation{
		Summary:     strings.TrimSpace(described.Summary),
		Description: strings.TrimSpace(described.Description),
		Deprecated:  described.Deprecated,
		Document:    strings.TrimRight(string(document), "\n"),
		Language:    "yaml",
	}, true
}

// splitOperation reads "GET /shows/{showId}" back into the two halves that address
// an operation in a document.
func splitOperation(operation string) (verb string, path string, ok bool) {
	verb, path, found := strings.Cut(strings.TrimSpace(operation), " ")
	if !found {
		return "", "", false
	}
	path = strings.TrimSpace(path)
	if verb == "" || !strings.HasPrefix(path, "/") {
		return "", "", false
	}
	return strings.ToLower(verb), path, true
}

// operationJSON walks paths → <path> → <verb> without decoding the rest of the
// document, which for a large API is most of it.
func operationJSON(raw []byte, verb string, path string) ([]byte, bool) {
	var document struct {
		Paths map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, false
	}
	item, ok := document.Paths[path]
	if !ok {
		return nil, false
	}
	var operations map[string]json.RawMessage
	if err := json.Unmarshal(item, &operations); err != nil {
		return nil, false
	}
	// A document's verbs are lowercase by the specification, but it costs nothing to
	// read one that shouts.
	for name, body := range operations {
		if strings.EqualFold(name, verb) {
			return body, true
		}
	}
	return nil, false
}

package openapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"sigs.k8s.io/yaml"
)

// spec models the small subset of OpenAPI 3.x that the minimal happy-path app
// understands. sigs.k8s.io/yaml honours the json tags and parses both JSON and
// YAML documents.
type spec struct {
	OpenAPI    string               `json:"openapi"`
	Info       info                 `json:"info"`
	Servers    []server             `json:"servers"`
	Paths      map[string]*pathItem `json:"paths"`
	Components components           `json:"components"`
	// Security lists the authentication requirements applied to every operation
	// unless an operation overrides them. Each entry is one alternative.
	Security []map[string][]string `json:"security"`
}

type info struct {
	Title   string `json:"title"`
	Version string `json:"version"`
}

type server struct {
	URL string `json:"url"`
}

type pathItem struct {
	Parameters []*parameter `json:"parameters"`
	Get        *operation   `json:"get"`
	Put        *operation   `json:"put"`
	Post       *operation   `json:"post"`
	Delete     *operation   `json:"delete"`
	Patch      *operation   `json:"patch"`
}

// operations returns the defined HTTP verbs in a stable order.
func (p *pathItem) operations() []verbOp {
	var ops []verbOp
	for _, vo := range []verbOp{
		{"GET", p.Get}, {"POST", p.Post}, {"PUT", p.Put}, {"DELETE", p.Delete}, {"PATCH", p.Patch},
	} {
		if vo.op != nil {
			ops = append(ops, vo)
		}
	}
	return ops
}

type verbOp struct {
	verb string
	op   *operation
}

type operation struct {
	OperationID string               `json:"operationId"`
	Summary     string               `json:"summary"`
	Description string               `json:"description"`
	Tags        []string             `json:"tags"`
	Parameters  []*parameter         `json:"parameters"`
	RequestBody *requestBody         `json:"requestBody"`
	Responses   map[string]*response `json:"responses"`
}

type parameter struct {
	Ref      string               `json:"$ref"` // reference to #/components/parameters/<name>
	Name     string               `json:"name"`
	In       string               `json:"in"` // path | query | header | cookie
	Required bool                 `json:"required"`
	Schema   *schema              `json:"schema"`
	Style    string               `json:"style"`   // form (default) | deepObject | ...
	Explode  *bool                `json:"explode"` // default true for form style
	Content  map[string]mediaType `json:"content"` // alternative to schema: a serialized media type
}

type requestBody struct {
	Required bool                 `json:"required"`
	Content  map[string]mediaType `json:"content"`
}

type response struct {
	Description string               `json:"description"`
	Content     map[string]mediaType `json:"content"`
}

type mediaType struct {
	Schema *schema `json:"schema"`
}

type components struct {
	Schemas         map[string]*schema         `json:"schemas"`
	Parameters      map[string]*parameter      `json:"parameters"`
	SecuritySchemes map[string]*securityScheme `json:"securitySchemes"`
}

// securityScheme models the OpenAPI 3.x security scheme types kaja understands:
// http (bearer/basic), apiKey (header/query/cookie), and oauth2/openIdConnect
// (treated as bearer tokens).
type securityScheme struct {
	Type   string `json:"type"`   // http | apiKey | oauth2 | openIdConnect
	Scheme string `json:"scheme"` // bearer | basic (for type http)
	In     string `json:"in"`     // header | query | cookie (for type apiKey)
	Name   string `json:"name"`   // parameter name (for type apiKey)
}

type schema struct {
	Ref                  string                `json:"$ref"`
	Type                 string                `json:"type"`
	Format               string                `json:"format"`
	Items                *schema               `json:"items"`
	Properties           map[string]*schema    `json:"properties"`
	AdditionalProperties *additionalProperties `json:"additionalProperties"`
	AllOf                []*schema             `json:"allOf"`
	OneOf                []*schema             `json:"oneOf"`
	AnyOf                []*schema             `json:"anyOf"`
	Required             []string              `json:"required"`
	Enum                 []interface{}         `json:"enum"`
}

// additionalProperties is either a boolean or a schema in OpenAPI documents.
type additionalProperties struct {
	Allowed bool
	Schema  *schema
}

func (a *additionalProperties) UnmarshalJSON(b []byte) error {
	if err := json.Unmarshal(b, &a.Allowed); err == nil {
		return nil
	}
	a.Allowed = true
	return json.Unmarshal(b, &a.Schema)
}

// jsonContent returns the JSON media type to use, preferring plain
// application/json, then charset-suffixed variants, then structured-syntax
// "+json" types (application/vnd.example+json etc.). The returned string is the
// content type as declared in the spec.
func jsonContent(content map[string]mediaType) (string, mediaType, bool) {
	if mt, ok := content["application/json"]; ok {
		return "application/json", mt, true
	}
	keys := make([]string, 0, len(content))
	for ct := range content {
		keys = append(keys, ct)
	}
	sort.Strings(keys)
	for _, ct := range keys {
		if strings.HasPrefix(ct, "application/json") {
			return ct, content[ct], true
		}
	}
	for _, ct := range keys {
		base := ct
		if i := strings.Index(base, ";"); i >= 0 {
			base = strings.TrimSpace(base[:i])
		}
		if strings.HasSuffix(base, "+json") {
			return ct, content[ct], true
		}
	}
	return "", mediaType{}, false
}

// textContent reports whether the content declares a text/* media type.
func textContent(content map[string]mediaType) bool {
	for ct := range content {
		if strings.HasPrefix(ct, "text/") {
			return true
		}
	}
	return false
}

// loadSpec fetches and parses an OpenAPI document from a URL.
func loadSpec(specURL string) (*spec, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(specURL)
	if err != nil {
		return nil, fmt.Errorf("fetching spec: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching spec: unexpected status %s", resp.Status)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, fmt.Errorf("reading spec: %w", err)
	}

	return parseSpec(body)
}

func parseSpec(body []byte) (*spec, error) {
	var s spec
	if err := yaml.Unmarshal(body, &s); err != nil {
		return nil, fmt.Errorf("parsing spec: %w", err)
	}
	if s.OpenAPI == "" {
		return nil, fmt.Errorf("not an OpenAPI 3.x document (missing \"openapi\" field)")
	}
	if len(s.Paths) == 0 {
		return nil, fmt.Errorf("spec has no paths")
	}
	return &s, nil
}

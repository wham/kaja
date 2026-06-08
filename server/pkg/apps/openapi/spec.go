package openapi

import (
	"fmt"
	"io"
	"net/http"
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
	Name     string  `json:"name"`
	In       string  `json:"in"` // path | query | header | cookie
	Required bool    `json:"required"`
	Schema   *schema `json:"schema"`
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
	Schemas map[string]*schema `json:"schemas"`
}

type schema struct {
	Ref        string             `json:"$ref"`
	Type       string             `json:"type"`
	Format     string             `json:"format"`
	Items      *schema            `json:"items"`
	Properties map[string]*schema `json:"properties"`
	Required   []string           `json:"required"`
	Enum       []interface{}      `json:"enum"`
}

// jsonContent returns the application/json media type, if present.
func jsonContent(content map[string]mediaType) (mediaType, bool) {
	mt, ok := content["application/json"]
	if ok {
		return mt, true
	}
	// Be lenient about charset suffixes etc.
	for ct, mt := range content {
		if len(ct) >= 16 && ct[:16] == "application/json" {
			return mt, true
		}
	}
	return mediaType{}, false
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

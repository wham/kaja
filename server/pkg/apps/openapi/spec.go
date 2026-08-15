package openapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"sigs.k8s.io/yaml"
)

// spec models the small subset of OpenAPI 3.x that the minimal happy-path app
// understands. sigs.k8s.io/yaml honours the json tags and parses both JSON and
// YAML documents.
type spec struct {
	OpenAPI string `json:"openapi"`
	// Swagger is the version field of the predecessor format. It is only read to
	// tell a Swagger 2.0 document apart from a document that is not an API
	// description at all.
	Swagger    string               `json:"swagger"`
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
	URL         string                    `json:"url"`
	Description string                    `json:"description"`
	Variables   map[string]serverVariable `json:"variables"`
}

// serverVariable is one {placeholder} in a server URL.
type serverVariable struct {
	Default     string   `json:"default"`
	Enum        []string `json:"enum"`
	Description string   `json:"description"`
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
	// Security overrides the document-level requirements for this operation. An
	// empty (but present) list means the operation needs no credentials.
	Security []map[string][]string `json:"security"`
}

type parameter struct {
	Ref         string               `json:"$ref"` // reference to #/components/parameters/<name>
	Name        string               `json:"name"`
	In          string               `json:"in"` // path | query | header | cookie
	Description string               `json:"description"`
	Required    bool                 `json:"required"`
	Schema      *schema              `json:"schema"`
	Style       string               `json:"style"`   // form (default) | deepObject | ...
	Explode     *bool                `json:"explode"` // default true for form style
	Content     map[string]mediaType `json:"content"` // alternative to schema: a serialized media type
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
	Schemas         map[string]*schema    `json:"schemas"`
	Parameters      map[string]*parameter `json:"parameters"`
	SecuritySchemes securitySchemes       `json:"securitySchemes"`
}

// securityScheme models the OpenAPI 3.x security scheme types kaja understands:
// http (bearer/basic), apiKey (header/query/cookie), and oauth2/openIdConnect
// (treated as bearer tokens).
type securityScheme struct {
	Type             string `json:"type"`   // http | apiKey | oauth2 | openIdConnect | mutualTLS
	Scheme           string `json:"scheme"` // bearer | basic (for type http)
	In               string `json:"in"`     // header | query | cookie (for type apiKey)
	Name             string `json:"name"`   // parameter name (for type apiKey)
	BearerFormat     string `json:"bearerFormat"`
	Description      string `json:"description"`
	OpenIDConnectURL string `json:"openIdConnectUrl"`
}

// securitySchemes is components.securitySchemes, keeping the order the document
// declares them in. The order decides which scheme the app form preselects when
// two are equally applicable, so it has to be stable across reads - a plain Go
// map isn't.
type securitySchemes struct {
	names  []string
	byName map[string]*securityScheme
}

func (s *securitySchemes) UnmarshalJSON(b []byte) error {
	if err := json.Unmarshal(b, &s.byName); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(b))
	// Consume the opening brace, then read the keys in the order they appear.
	if _, err := decoder.Token(); err != nil {
		return err
	}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return err
		}
		name, ok := key.(string)
		if !ok {
			return fmt.Errorf("securitySchemes: unexpected key %v", key)
		}
		s.names = append(s.names, name)
		var discard json.RawMessage
		if err := decoder.Decode(&discard); err != nil {
			return err
		}
	}
	return nil
}

// names in declaration order.
func (s *securitySchemes) order() []string { return s.names }

func (s *securitySchemes) get(name string) *securityScheme { return s.byName[name] }

func (s *securitySchemes) len() int { return len(s.byName) }

// openAPIType is a schema "type". OpenAPI 3.0 writes a single string
// ("string"), while OpenAPI 3.1 (JSON Schema) also allows an array such as
// ["string", "null"] to express a nullable type. We keep the first non-"null"
// entry so a 3.1 nullable type is treated exactly like its 3.0 counterpart —
// proto3 fields already model an absent value.
type openAPIType string

func (t *openAPIType) UnmarshalJSON(data []byte) error {
	var v interface{}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	switch val := v.(type) {
	case string:
		*t = openAPIType(val)
	case []interface{}:
		for _, e := range val {
			if s, ok := e.(string); ok && s != "null" {
				*t = openAPIType(s)
				break
			}
		}
	}
	return nil
}

type schema struct {
	Ref                  string                `json:"$ref"`
	Type                 openAPIType           `json:"type"`
	Description          string                `json:"description"`
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

// problemKind classifies why a document couldn't be read. The app form shows a
// different banner - and a different next move - for each one.
type problemKind string

const (
	problemUnreachable  problemKind = "unreachable"  // DNS, TCP or TLS failure
	problemUnauthorized problemKind = "unauthorized" // 401 or 403: the document itself is protected
	problemHTTPError    problemKind = "httpError"    // any other non-200 response
	problemHTML         problemKind = "html"         // a web page, usually a sign-in redirect
	problemNotADocument problemKind = "notADocument" // parsed, but not an API description
	problemSwagger2     problemKind = "swagger2"     // the predecessor format
	problemMalformed    problemKind = "malformed"    // not parseable as JSON or YAML
)

// problem is a document that couldn't be read. Message is one line addressed to
// the user; Detail carries the underlying transport or parser error verbatim.
type problem struct {
	Kind    problemKind
	Message string
	Detail  string
}

func (p *problem) Error() string {
	if p.Detail == "" {
		return p.Message
	}
	return p.Message + ": " + p.Detail
}

// fetchCredentials are the credentials used to fetch the document itself, which
// are not necessarily the ones the API it describes wants.
type fetchCredentials struct {
	token       string
	username    string
	password    string
	headerName  string
	headerValue string
}

// loadSpec fetches and parses an OpenAPI document from a URL, authenticating the
// request with the user's credentials so specs served behind a login (e.g. a
// tenant's /api/v2/openapi.yaml) can be read. The spec's own security schemes are
// not known yet, so it falls back the same way invocations do: username/password
// as HTTP Basic, otherwise a bearer token. An explicit spec header wins over both.
func loadSpec(specURL string, credentials fetchCredentials, log func(string)) (*spec, *problem) {
	body, contentType, p := fetchSpec(specURL, credentials, log)
	if p != nil {
		return nil, p
	}
	return readSpec(body, contentType)
}

// fetchSpec reads the document itself. It is split out from loadSpec because an
// export freezes the bytes into the bundle rather than the parse of them: what
// travels is the document, so the exported app reads exactly what was read here.
func fetchSpec(specURL string, credentials fetchCredentials, log func(string)) ([]byte, string, *problem) {
	req, err := http.NewRequest(http.MethodGet, specURL, nil)
	if err != nil {
		return nil, "", &problem{Kind: problemUnreachable, Message: "Couldn't fetch " + hostOf(specURL), Detail: err.Error()}
	}
	req.Header.Set("Accept", "application/yaml, application/json, text/yaml, text/plain, */*")
	applyFetchAuth(req, credentials)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", &problem{Kind: problemUnreachable, Message: "Couldn't reach " + hostOf(specURL), Detail: unwrapURLError(err)}
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	log(fmt.Sprintf("Spec response: HTTP %d, Content-Type %q", resp.StatusCode, contentType))
	if final := resp.Request.URL.String(); final != specURL {
		// A redirect to a different location (typically a sign-in page) is the
		// usual reason an authenticated spec ends up as unparseable HTML.
		log("Request was redirected to " + final)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, "", specFetchProblem(specURL, resp)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, "", &problem{Kind: problemUnreachable, Message: "Couldn't read the response from " + hostOf(specURL), Detail: err.Error()}
	}
	log(fmt.Sprintf("Read %d bytes of spec", len(body)))

	return body, contentType, nil
}

// readSpec parses a fetched or uploaded document, classifying what came back when
// it isn't an OpenAPI 3.x document. Naming the actual content (an HTML sign-in
// page, a Swagger 2.0 document) beats a cryptic YAML error against it.
func readSpec(body []byte, contentType string) (*spec, *problem) {
	if isHTML(contentType, body) {
		return nil, &problem{
			Kind:    problemHTML,
			Message: "That URL returned a web page, not an OpenAPI document",
			Detail:  "Look for a link labelled \"OpenAPI\", \"spec\", or an /openapi.json path.",
		}
	}

	var s spec
	if err := yaml.Unmarshal(body, &s); err != nil {
		return nil, &problem{Kind: problemMalformed, Message: "Couldn't parse the document", Detail: err.Error()}
	}

	if s.OpenAPI == "" {
		if strings.HasPrefix(s.Swagger, "2.") {
			return nil, &problem{
				Kind:    problemSwagger2,
				Message: "This is Swagger " + s.Swagger + ", not OpenAPI 3.x",
				Detail:  "Convert it to OpenAPI 3 first - kaja reads 3.0 and 3.1 documents.",
			}
		}
		return nil, &problem{
			Kind:    problemNotADocument,
			Message: "That isn't an OpenAPI document",
			Detail:  fmt.Sprintf("It declares no %q version (Content-Type %q, starts with %q)", "openapi", contentType, snippet(body)),
		}
	}
	if len(s.Paths) == 0 {
		return nil, &problem{
			Kind:    problemNotADocument,
			Message: "That document declares no paths",
			Detail:  "There is nothing to call - check that it is the complete document.",
		}
	}
	return &s, nil
}

// hostOf names the host in a URL for a user-facing message, falling back to the
// whole URL when it doesn't parse.
func hostOf(rawURL string) string {
	if u, err := url.Parse(rawURL); err == nil && u.Host != "" {
		return u.Host
	}
	return rawURL
}

// unwrapURLError returns the transport error without the "Get \"<url>\":" prefix
// net/http adds - the URL is already on screen, right above the message.
func unwrapURLError(err error) string {
	var urlError *url.Error
	if errors.As(err, &urlError) && urlError.Err != nil {
		return urlError.Err.Error()
	}
	return err.Error()
}

// snippet returns a short, single-line preview of a fetched body for diagnostics.
func snippet(body []byte) string {
	const max = 120
	s := strings.TrimSpace(string(body))
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\n", " "), "\r", "")
	if len(s) > max {
		s = s[:max] + "…"
	}
	return s
}

// applyFetchAuth adds the user's credentials to a spec-fetch request. An explicit
// header is sent as given; otherwise it mirrors resolveAuth's no-scheme fallback,
// since the spec is not parsed yet.
func applyFetchAuth(req *http.Request, credentials fetchCredentials) {
	if credentials.headerName != "" {
		req.Header.Set(credentials.headerName, credentials.headerValue)
		return
	}
	switch {
	case credentials.username != "" || credentials.password != "":
		req.SetBasicAuth(credentials.username, credentials.password)
	case credentials.token != "":
		req.Header.Set("Authorization", "Bearer "+credentials.token)
	}
}

// specFetchProblem classifies a non-200 spec response, calling out authentication
// for the statuses that indicate it.
func specFetchProblem(specURL string, resp *http.Response) *problem {
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return &problem{
			Kind:    problemUnauthorized,
			Message: fmt.Sprintf("That URL needs credentials - the host returned %d", resp.StatusCode),
			Detail:  "Give a header to send while fetching. It's stored separately from the app's own auth.",
		}
	default:
		return &problem{
			Kind:    problemHTTPError,
			Message: fmt.Sprintf("%s returned HTTP %d", hostOf(specURL), resp.StatusCode),
			Detail:  resp.Status,
		}
	}
}

// isHTML reports whether a fetched spec response is actually an HTML document,
// judged by content type and, failing that, the body's opening tag.
func isHTML(contentType string, body []byte) bool {
	if strings.Contains(strings.ToLower(contentType), "text/html") {
		return true
	}
	head := strings.ToLower(strings.TrimSpace(string(body)))
	return strings.HasPrefix(head, "<!doctype html") || strings.HasPrefix(head, "<html")
}

// parseSpec reads a document whose content type is unknown, as an error rather
// than a classified problem.
func parseSpec(body []byte) (*spec, error) {
	s, p := readSpec(body, "")
	if p != nil {
		return nil, p
	}
	return s, nil
}

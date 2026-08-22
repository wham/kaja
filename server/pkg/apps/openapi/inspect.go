package openapi

import (
	"net/url"
	"path"
	"sort"
	"strings"
)

// Document is what an OpenAPI document says about itself, read before an app is
// created so the New OpenAPI app form can fill itself in from it.
type Document struct {
	Title           string
	Version         string
	OpenAPIVersion  string
	OperationCount  int
	TagCount        int
	Servers         []DocumentServer
	SecuritySchemes []DocumentSecurityScheme
	// GuessedBaseURL is the document URL's origin, set only when the document
	// declares no servers of its own.
	GuessedBaseURL string
	// PerOperationSecurity reports whether any operation declares its own
	// security. When none does, every scheme applies to every operation and the
	// coverage counts carry no information.
	PerOperationSecurity bool
}

type DocumentServer struct {
	URL         string
	Description string
	Variables   []DocumentServerVariable
}

type DocumentServerVariable struct {
	Name        string
	Default     string
	Enum        []string
	Description string
}

type DocumentSecurityScheme struct {
	Key              string
	Type             string
	Scheme           string
	BearerFormat     string
	In               string
	ParameterName    string
	OpenIDConnectURL string
	Description      string
	// OperationCount is how many operations accept this scheme on its own.
	OperationCount int
	// RequiresOthers marks a scheme that only ever appears alongside another one,
	// which a single credential per app can't satisfy.
	RequiresOthers bool
}

// Problem is a document that couldn't be read, classified so the form can name
// the next move instead of printing a raw error.
type Problem struct {
	Kind    string
	Message string
	Detail  string
}

// Inspect reads the document an openapi app would be opened with and reports what
// it declares, without creating the app. It takes the same flattened parameters
// as Open.
func Inspect(parameters map[string]string, log func(string)) (*Document, *Problem) {
	specURL := strings.TrimSpace(parameters["spec_url"])
	specContent := strings.TrimSpace(parameters["spec_content"])

	var s *spec
	var p *problem
	switch {
	case specContent != "":
		log("Parsing uploaded OpenAPI spec")
		s, p = readSpec([]byte(specContent), "")
	case specURL != "":
		if err := requireHTTPScheme(specURL); err != nil {
			return nil, &Problem{Kind: string(problemUnreachable), Message: "That isn't a URL kaja can fetch", Detail: err.Error()}
		}
		log("Fetching OpenAPI spec from " + specURL)
		s, _, p = loadSpec(specURL, specFetchCredentials(parameters), log)
	default:
		return nil, &Problem{Kind: string(problemNotADocument), Message: "No document yet", Detail: "Give a URL, or upload a file."}
	}
	if p != nil {
		return nil, &Problem{Kind: string(p.Kind), Message: p.Message, Detail: p.Detail}
	}
	return describe(s, specURL), nil
}

// specFetchCredentials collects the credentials used to fetch the document
// itself. They double as the API's credentials when no separate spec header is
// configured.
func specFetchCredentials(parameters map[string]string) fetchCredentials {
	return fetchCredentials{
		token:       strings.TrimSpace(parameters["token"]),
		username:    strings.TrimSpace(parameters["username"]),
		password:    strings.TrimSpace(parameters["password"]),
		headerName:  strings.TrimSpace(parameters["spec_header_name"]),
		headerValue: strings.TrimSpace(parameters["spec_header_value"]),
	}
}

// describe summarizes a parsed document. specURL is where it was fetched from, if
// anywhere; it only supplies the base URL guess for a document with no servers.
func describe(s *spec, specURL string) *Document {
	document := &Document{
		Title:          s.Info.Title,
		Version:        s.Info.Version,
		OpenAPIVersion: s.OpenAPI,
	}

	tags := map[string]bool{}
	// A scheme covers an operation when the operation accepts it on its own; a
	// requirement listing several schemes needs all of them at once, which one
	// credential per app can't satisfy.
	coverage := map[string]int{}
	seenAlone := map[string]bool{}
	seenWithOthers := map[string]bool{}
	for _, item := range s.Paths {
		for _, vo := range item.operations() {
			document.OperationCount++
			for _, tag := range vo.op.Tags {
				tags[tag] = true
			}
			requirements := s.Security
			if vo.op.Security != nil {
				document.PerOperationSecurity = true
				requirements = vo.op.Security
			}
			counted := map[string]bool{}
			for _, requirement := range requirements {
				for name := range requirement {
					if len(requirement) > 1 {
						seenWithOthers[name] = true
						continue
					}
					seenAlone[name] = true
					if !counted[name] {
						counted[name] = true
						coverage[name]++
					}
				}
			}
		}
	}
	document.TagCount = len(tags)

	var docURL *url.URL
	if specURL != "" {
		if parsed, err := url.Parse(specURL); err == nil && parsed.Host != "" {
			docURL = parsed
		}
	}
	for _, srv := range s.Servers {
		document.Servers = append(document.Servers, describeServer(srv, docURL))
	}
	if len(document.Servers) == 0 && docURL != nil {
		document.GuessedBaseURL = docURL.Scheme + "://" + docURL.Host
	}

	for _, name := range s.Components.SecuritySchemes.order() {
		scheme := s.Components.SecuritySchemes.get(name)
		if scheme == nil {
			continue
		}
		document.SecuritySchemes = append(document.SecuritySchemes, DocumentSecurityScheme{
			Key:              name,
			Type:             scheme.Type,
			Scheme:           scheme.Scheme,
			BearerFormat:     scheme.BearerFormat,
			In:               scheme.In,
			ParameterName:    scheme.Name,
			OpenIDConnectURL: scheme.OpenIDConnectURL,
			Description:      scheme.Description,
			OperationCount:   coverage[name],
			RequiresOthers:   seenWithOthers[name] && !seenAlone[name],
		})
	}
	// Most applicable first, so the form preselects the scheme the most
	// operations accept. Ties keep the document's own order.
	sort.SliceStable(document.SecuritySchemes, func(i, j int) bool {
		return document.SecuritySchemes[i].OperationCount > document.SecuritySchemes[j].OperationCount
	})

	return document
}

func describeServer(srv server, docURL *url.URL) DocumentServer {
	described := DocumentServer{URL: absoluteServerURL(docURL, strings.TrimSpace(srv.URL)), Description: srv.Description}
	// Report the variables the URL actually uses, in the order they appear in it,
	// so the form's fields read left to right like the URL does.
	for _, name := range placeholderNames(srv.URL) {
		variable, ok := srv.Variables[name]
		if !ok {
			described.Variables = append(described.Variables, DocumentServerVariable{Name: name})
			continue
		}
		described.Variables = append(described.Variables, DocumentServerVariable{
			Name:        name,
			Default:     variable.Default,
			Enum:        variable.Enum,
			Description: variable.Description,
		})
	}
	return described
}

// absoluteServerURL resolves a relative server URL - a very common way to write
// one - against the document it was declared in, so the form shows and stores an
// address requests can actually be sent to. It resolves textually because a
// server URL may hold {placeholders} that URL escaping would mangle.
func absoluteServerURL(docURL *url.URL, raw string) string {
	if docURL == nil || raw == "" || strings.Contains(raw, "://") {
		return raw
	}
	if strings.HasPrefix(raw, "//") {
		return docURL.Scheme + ":" + raw
	}
	origin := docURL.Scheme + "://" + docURL.Host
	if strings.HasPrefix(raw, "/") {
		return strings.TrimSuffix(origin, "/") + raw
	}
	return strings.TrimSuffix(origin+path.Dir(docURL.Path), "/") + "/" + raw
}

// applyServerDefaults fills a templated server URL with the defaults the
// document declares for its variables. The app form resolves the placeholders
// with the user's choices and passes the result as base_url; this is the
// fallback for a config that names no base URL of its own.
func applyServerDefaults(srv server) string {
	resolved := strings.TrimSpace(srv.URL)
	for name, variable := range srv.Variables {
		resolved = strings.ReplaceAll(resolved, "{"+name+"}", variable.Default)
	}
	return resolved
}

// placeholderNames returns the {name} placeholders in a server URL, in order and
// without repeats.
func placeholderNames(rawURL string) []string {
	var names []string
	seen := map[string]bool{}
	for {
		open := strings.Index(rawURL, "{")
		if open < 0 {
			return names
		}
		close := strings.Index(rawURL[open:], "}")
		if close < 0 {
			return names
		}
		name := rawURL[open+1 : open+close]
		if name != "" && !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
		rawURL = rawURL[open+close+1:]
	}
}

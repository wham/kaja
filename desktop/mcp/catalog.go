package mcp

import (
	"sort"
	"strings"
)

// The catalog is what a script can call, pushed from the UI after each
// compilation — and it is TypeScript, because that is what a script is.
//
// Every Kaja app compiles to generated TypeScript: a gRPC or Twirp service from
// its protos, an OpenAPI document by way of one. What an author writes against
// is the result — `Shows.ListShows({ pageSize: 25 })` against an interface named
// ListShowsRequest — and nothing they write is protobuf. So the answers here are
// declarations lifted out of that generated code, not a description of the wire
// format behind it. A declaration can't disagree with the code a script is
// checked against; a second model of it can, and did.
//
// This side decides what to show and how to frame it. What the TypeScript *is* —
// the declarations, the signatures, the generated call — is settled in the UI,
// where the TypeScript compiler already is.
type Catalog struct {
	Apps []CatalogApp `json:"apps"`
}

type CatalogApp struct {
	Name     string           `json:"name"`
	Type     string           `json:"type,omitempty"`
	Services []CatalogService `json:"services"`
	// Every type the app's services name, by its TypeScript name.
	Declarations map[string]Declaration `json:"declarations,omitempty"`
}

type CatalogService struct {
	Name string `json:"name"`
	// What a script imports the service from.
	ImportPath string          `json:"importPath"`
	Methods    []CatalogMethod `json:"methods"`
}

type CatalogMethod struct {
	Name string `json:"name"`
	// The TypeScript a script writes, e.g.
	// "ListShows(input: ListShowsRequest): Promise<ListShowsResponse>".
	Signature string `json:"signature"`
	Input     string `json:"input"`
	Output    string `json:"output"`
	Doc       string `json:"doc,omitempty"`
	// The HTTP request the method stands for, e.g. "GET /shows", when the app
	// said so. It is the only thing that states whether calling it reads or writes.
	HTTP      string `json:"http,omitempty"`
	Streaming string `json:"streaming,omitempty"`
	// The call Kaja writes for this method — the same code clicking it in the tree
	// puts in a scratch.
	Example string `json:"example"`
}

// Declaration is one generated type as a script reads it.
type Declaration struct {
	Name string `json:"name"`
	Text string `json:"text"`
	// The other declarations its members mention.
	References []string `json:"references,omitempty"`
}

// resolvedMethod is a method together with everything needed to talk about it:
// which app and service it belongs to, and how it is reached.
type resolvedMethod struct {
	app     CatalogApp
	service CatalogService
	method  CatalogMethod
}

// qualified is how a method is named everywhere the agent sees one.
func (r resolvedMethod) qualified() string {
	return r.service.Name + "." + r.method.Name
}

// readOnly reports whether calling the method only reads, and whether that is
// known or inferred. An HTTP verb settles it; without one the method name is the
// only signal there is, and the caller is told so rather than being handed a
// guess dressed as a fact.
func (r resolvedMethod) readOnly() (read bool, certain bool) {
	if verb, _, ok := strings.Cut(r.method.HTTP, " "); ok {
		switch strings.ToUpper(verb) {
		case "GET", "HEAD", "OPTIONS", "TRACE":
			return true, true
		default:
			return false, true
		}
	}
	return readingName(r.method.Name), false
}

// effect is the one-word label a listing shows. A trailing "?" marks a method
// whose effect was read off its name because nothing else said.
func (r resolvedMethod) effect() string {
	read, certain := r.readOnly()
	label := "write"
	if read {
		label = "read"
	}
	if !certain {
		label += "?"
	}
	return label
}

// declarationsFor closes over everything a set of type names reaches, in the
// order they are first met, so a request type arrives with the types it mentions
// underneath it. A name that isn't a declaration (a built-in, a type argument) is
// simply not there and is skipped.
func (a CatalogApp) declarationsFor(names ...string) []Declaration {
	var out []Declaration
	seen := map[string]bool{}
	queue := append([]string{}, names...)
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		if seen[name] {
			continue
		}
		seen[name] = true
		declaration, ok := a.Declarations[name]
		if !ok {
			continue
		}
		out = append(out, declaration)
		queue = append(queue, declaration.References...)
	}
	return out
}

// readingNamePrefixes are the verbs an API uses for a method that only reads. A
// prefix counts only when it ends the name or is followed by an upper-case
// letter, so "Get" matches "GetShow" and "Get", not "Generate".
var readingNamePrefixes = []string{
	"Get", "List", "Read", "Fetch", "Search", "Query", "Find", "Lookup",
	"Describe", "Count", "Check", "Watch", "Export", "Download", "Resolve",
	"Has", "Is", "Show", "View", "Peek", "Stream",
}

func readingName(name string) bool {
	for _, prefix := range readingNamePrefixes {
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		rest := name[len(prefix):]
		if rest == "" || (rest[0] >= 'A' && rest[0] <= 'Z') {
			return true
		}
	}
	return false
}

// methods walks every method in the catalog in listing order.
func (c Catalog) methods() []resolvedMethod {
	var out []resolvedMethod
	for _, app := range c.Apps {
		for _, service := range app.Services {
			for _, method := range service.Methods {
				out = append(out, resolvedMethod{app: app, service: service, method: method})
			}
		}
	}
	return out
}

// findMethod resolves the name an agent writes. "Shows.ListShows" is the usual
// form; "theatre/Shows.ListShows" disambiguates when two apps expose the same
// service, and a bare "ListShows" is accepted when only one method answers to it.
// An ambiguous name comes back as a list of the candidates rather than a pick.
func (c Catalog) findMethod(name string) (resolvedMethod, []string, bool) {
	name = strings.TrimSpace(name)
	appName := ""
	if app, rest, ok := strings.Cut(name, "/"); ok {
		appName, name = app, rest
	}
	serviceName, methodName := "", name
	if service, method, ok := strings.Cut(name, "."); ok {
		serviceName, methodName = service, method
	}

	var matches []resolvedMethod
	for _, candidate := range c.methods() {
		if appName != "" && !strings.EqualFold(candidate.app.Name, appName) {
			continue
		}
		if serviceName != "" && !strings.EqualFold(candidate.service.Name, serviceName) {
			continue
		}
		if !strings.EqualFold(candidate.method.Name, methodName) {
			continue
		}
		matches = append(matches, candidate)
	}

	switch len(matches) {
	case 0:
		return resolvedMethod{}, nil, false
	case 1:
		return matches[0], nil, true
	}
	names := make([]string, 0, len(matches))
	for _, match := range matches {
		names = append(names, match.app.Name+"/"+match.qualified())
	}
	sort.Strings(names)
	return resolvedMethod{}, names, false
}

// suggest returns the method names closest to what was asked for, so a miss
// names the next thing to try instead of only saying no.
func (c Catalog) suggest(name string) []string {
	needle := strings.ToLower(name)
	if index := strings.LastIndex(needle, "."); index >= 0 {
		needle = needle[index+1:]
	}
	var out []string
	for _, candidate := range c.methods() {
		if strings.Contains(strings.ToLower(candidate.qualified()), needle) {
			out = append(out, candidate.qualified())
		}
	}
	sort.Strings(out)
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

// suggestTypes returns the declared type names closest to what was asked for.
func (c Catalog) suggestTypes(name string) []string {
	needle := strings.ToLower(name)
	seen := map[string]bool{}
	var out []string
	for _, app := range c.Apps {
		for declared := range app.Declarations {
			if seen[declared] || !strings.Contains(strings.ToLower(declared), needle) {
				continue
			}
			seen[declared] = true
			out = append(out, declared)
		}
	}
	sort.Strings(out)
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

// counts totals the catalog for the one line that opens a listing.
func (c Catalog) counts() (apps, services, methods int) {
	apps = len(c.Apps)
	for _, app := range c.Apps {
		services += len(app.Services)
		for _, service := range app.Services {
			methods += len(service.Methods)
		}
	}
	return apps, services, methods
}

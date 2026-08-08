package mcp

import (
	"sort"
	"strings"
)

// The catalog is the live picture of what a script can call, pushed from the UI
// after each compilation. It carries facts only - what exists, what shape it has,
// and what the API said about it. Everything an answer needs beyond that (whether
// a method reads or writes, how much of a type to show, what an example call
// looks like) is decided here, so the UI never has to guess what the agent will
// be shown.
type Catalog struct {
	Apps []CatalogApp `json:"apps"`
	// Every message type reachable from a method, keyed by proto type name.
	Types map[string]CatalogType `json:"types,omitempty"`
	Enums map[string]CatalogEnum `json:"enums,omitempty"`
	// The generated TypeScript stubs, offered as resources. They are never part of
	// a tool result: one app's stubs are hundreds of kilobytes, and describe_method
	// answers from the types above without them.
	Sources []CatalogSource `json:"sources,omitempty"`
}

type CatalogApp struct {
	Name     string           `json:"name"`
	Type     string           `json:"type,omitempty"`
	Services []CatalogService `json:"services"`
}

type CatalogService struct {
	Name        string          `json:"name"`
	PackageName string          `json:"packageName,omitempty"`
	ImportPath  string          `json:"importPath"`
	Methods     []CatalogMethod `json:"methods"`
}

type CatalogMethod struct {
	Name   string `json:"name"`
	Input  string `json:"input"`
	Output string `json:"output"`
	// The HTTP request the method transcodes to, e.g. "GET /shows". Only apps that
	// speak HTTP set it; for the rest the effect is read off the name.
	HTTP            string `json:"http,omitempty"`
	ServerStreaming bool   `json:"serverStreaming,omitempty"`
	ClientStreaming bool   `json:"clientStreaming,omitempty"`
	Doc             string `json:"doc,omitempty"`
}

type CatalogType struct {
	Name string `json:"name"`
	// The TypeScript name a script writes for the message.
	TS string `json:"ts"`
	// The module the TypeScript name is exported from, when a script needs to
	// import it.
	ImportPath string         `json:"importPath,omitempty"`
	Doc        string         `json:"doc,omitempty"`
	Fields     []CatalogField `json:"fields,omitempty"`
}

type CatalogField struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
	Type string `json:"type"`
	// Repeated is a list; Required means the API insists on the field. Required
	// being false means "not stated": proto3 has no required, so only an app that
	// knows its API's contract can say.
	Repeated bool   `json:"repeated,omitempty"`
	Required bool   `json:"required,omitempty"`
	In       string `json:"in,omitempty"`
	Oneof    string `json:"oneof,omitempty"`
	Envelope bool   `json:"envelope,omitempty"`
	Doc      string `json:"doc,omitempty"`
}

type CatalogEnum struct {
	Name       string   `json:"name"`
	TS         string   `json:"ts"`
	ImportPath string   `json:"importPath,omitempty"`
	Values     []string `json:"values,omitempty"`
}

type CatalogSource struct {
	Path    string `json:"path"`
	Content string `json:"content"`
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

// readingNamePrefixes are the verbs an API uses for a method that only reads.
// Order matters only for readability; the check is longest-independent since a
// prefix must be followed by an upper-case letter or end the name ("Get" matches
// "GetShow" and "Get", not "Generate").
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

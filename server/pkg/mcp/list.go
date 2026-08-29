package mcp

import (
	"fmt"
	"strings"
)

// listServices is an index, not a dump. It says what exists, what each method is
// called with and returns, and whether calling it reads or writes - enough to
// choose a method without reading anything else. The shape of a request is one
// describe_method away, and the generated sources are resources, so nothing here
// grows with the size of the API's types.
func (c Catalog) listServices(appFilter, serviceFilter, search string) string {
	apps, services, methods := c.counts()
	if methods == 0 {
		return "No services yet. Kaja compiles an app's services when it opens; if an app is failing to compile, its methods are not callable and won't be listed here."
	}

	var b strings.Builder
	fmt.Fprintf(&b, "%d app(s), %d service(s), %d method(s).\n", apps, services, methods)
	b.WriteString("read/write says whether calling the method changes data; a trailing \"?\" means it was inferred from the method name rather than stated by the API.\n")
	b.WriteString("A request is an Input<T>: every field of it is optional, and one you leave out is sent as its zero value - so write the fields you mean and no others.\n")
	b.WriteString("Call describe_method \"<Service>.<Method>\" for the TypeScript declarations it takes and returns, and a call to start from.\n")
	if c.Runtime != "" {
		b.WriteString("A script writes its output with the kaja runtime, which is not one of these: describe_type \"kaja\" for its declaration (canvas output, variables, ask, JSON builders).\n")
	}

	shown := 0
	for _, app := range c.Apps {
		if appFilter != "" && !strings.EqualFold(app.Name, appFilter) {
			continue
		}
		var appBody strings.Builder
		for _, service := range app.Services {
			if serviceFilter != "" && !strings.EqualFold(service.Name, serviceFilter) {
				continue
			}
			var serviceBody strings.Builder
			for _, method := range service.Methods {
				resolved := resolvedMethod{app: app, service: service, method: method}
				if !matches(resolved, search) {
					continue
				}
				serviceBody.WriteString("    " + methodLine(resolved) + "\n")
				shown++
			}
			if serviceBody.Len() == 0 {
				continue
			}
			fmt.Fprintf(&appBody, "  %s  —  import { %s } from %q;\n", service.Name, service.Name, service.ImportPath)
			appBody.WriteString(serviceBody.String())
		}
		if appBody.Len() == 0 {
			continue
		}
		fmt.Fprintf(&b, "\n%s (%s)\n", app.Name, app.Type)
		b.WriteString(appBody.String())
	}

	if shown == 0 {
		return b.String() + "\nNothing matched that filter.\n"
	}
	return b.String()
}

func methodLine(resolved resolvedMethod) string {
	method := resolved.method
	line := fmt.Sprintf("%-6s %s", resolved.effect(), method.Signature)
	var marks []string
	if method.HTTP != "" {
		marks = append(marks, method.HTTP)
	}
	// Which way it streams is only worth a mark for what it costs the caller: one
	// direction is called like any other method, the other two not at all.
	switch method.Streaming {
	case "server":
		marks = append(marks, "server stream")
	case "client", "bidirectional":
		marks = append(marks, "not callable")
	}
	if len(marks) > 0 {
		line += "  [" + strings.Join(marks, ", ") + "]"
	}
	if method.Doc != "" {
		line += "  " + method.Doc
	}
	return line
}

// matches is the free-text filter: the app, service, method, HTTP request and
// doc are all searchable, so "ingest" finds a method however it is named.
func matches(resolved resolvedMethod, search string) bool {
	if search == "" {
		return true
	}
	needle := strings.ToLower(search)
	haystack := strings.ToLower(strings.Join([]string{
		resolved.app.Name, resolved.service.Name, resolved.method.Name,
		resolved.method.HTTP, resolved.method.Doc,
	}, " "))
	return strings.Contains(haystack, needle)
}

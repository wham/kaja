package mcp

import (
	"fmt"
	"sort"
	"strings"
)

// exampleCall writes a call that runs as it stands: the imports it needs, the
// request literal, and the console.log that makes the result visible. It is what
// the answer is for - the shape above says what is possible, the example says
// what to type.
func (c Catalog) exampleCall(resolved resolvedMethod) string {
	imports := newImportSet()
	imports.add(resolved.service.ImportPath, resolved.service.Name)

	body := c.exampleValue(resolved.method.Input, imports, map[string]bool{}, "", true)

	var b strings.Builder
	b.WriteString(imports.render())
	b.WriteString("\n")
	if resolved.method.ServerStreaming || resolved.method.ClientStreaming {
		fmt.Fprintf(&b, "// %s is a streaming method; run it from the editor to watch the stream.\n", resolved.method.Name)
	}
	fmt.Fprintf(&b, "const response = await %s.%s(%s);\n", resolved.service.Name, resolved.method.Name, body)
	b.WriteString("console.log(response);\n")
	return b.String()
}

// exampleValue renders a message as an object literal. Only the fields worth
// sending are filled: when the API declares required fields, the rest are left
// out with a line saying so, which is the difference between an example and a
// dump of every parameter the method has.
func (c Catalog) exampleValue(typeName string, imports *importSet, path map[string]bool, indent string, top bool) string {
	typ, ok := c.Types[typeName]
	if !ok {
		return "{}"
	}
	if typeName == "google.protobuf.Timestamp" {
		return `{ seconds: "0", nanos: 0 }`
	}

	path[typeName] = true
	defer delete(path, typeName)

	fields, omitted := selectFields(typ, top)
	if len(fields) == 0 && len(omitted) == 0 {
		return "{}"
	}

	var lines []string
	seenOneof := map[string]bool{}
	for _, field := range fields {
		if field.Oneof != "" {
			if seenOneof[field.Oneof] {
				continue
			}
			seenOneof[field.Oneof] = true
			lines = append(lines, fmt.Sprintf("%s%s: { oneofKind: undefined }, // set one of: %s", indent+"  ", field.Oneof, strings.Join(oneofMembers(typ, field.Oneof), ", ")))
			continue
		}
		value, ok := c.exampleField(field, imports, path, indent+"  ")
		if !ok {
			continue
		}
		line := fmt.Sprintf("%s%s: %s,", indent+"  ", field.Name, value)
		if field.Doc != "" {
			line += " // " + field.Doc
		}
		lines = append(lines, line)
	}
	if len(omitted) > 0 {
		lines = append(lines, fmt.Sprintf("%s// optional: %s", indent+"  ", strings.Join(omitted, ", ")))
	}
	if len(lines) == 0 {
		return "{}"
	}
	return "{\n" + strings.Join(lines, "\n") + "\n" + indent + "}"
}

// selectFields decides what an example fills in. A request whose API declares
// required fields shows those and names the rest; anything else - a nested
// message, or a proto3 request that states nothing - shows every field, since
// there is no signal to narrow by.
func selectFields(typ CatalogType, top bool) (fields []CatalogField, omitted []string) {
	if !top {
		return typ.Fields, nil
	}
	hasRequired := false
	for _, field := range typ.Fields {
		if field.Required {
			hasRequired = true
			break
		}
	}
	if !hasRequired {
		return typ.Fields, nil
	}
	for _, field := range typ.Fields {
		if field.Required || field.Oneof != "" {
			fields = append(fields, field)
			continue
		}
		omitted = append(omitted, field.Name)
	}
	return fields, omitted
}

// exampleField renders one field's value. It reports false for a field there is
// nothing sendable to write: a message already on the path would recurse forever,
// and a placeholder that can't be sent is worse than an absent optional field.
func (c Catalog) exampleField(field CatalogField, imports *importSet, path map[string]bool, indent string) (string, bool) {
	if field.Kind == "message" {
		if builder, ok := kajaBuilders[field.Type]; ok {
			imports.add("kaja", "kaja")
			return repeatWrap(field, builder.call), true
		}
		if path[field.Type] {
			if field.Repeated {
				return "[]", true
			}
			return "", false
		}
	}

	switch field.Kind {
	case "scalar":
		if field.Repeated {
			// A single placeholder element is sent verbatim as an invalid value.
			return "[]", true
		}
		return scalarZero(field.Type), true
	case "enum":
		enum, ok := c.Enums[field.Type]
		if !ok || len(enum.Values) == 0 {
			return repeatWrap(field, "0"), true
		}
		if enum.ImportPath != "" {
			imports.add(enum.ImportPath, enum.TS)
		}
		// The first value is the unspecified one an API usually rejects.
		value := enum.Values[0]
		if len(enum.Values) > 1 {
			value = enum.Values[1]
		}
		return repeatWrap(field, enum.TS+"."+value), true
	case "map":
		return "{}", true
	default:
		return repeatWrap(field, c.exampleValue(field.Type, imports, path, indent, false)), true
	}
}

func repeatWrap(field CatalogField, value string) string {
	if field.Repeated {
		return "[" + value + "]"
	}
	return value
}

func scalarZero(scalar string) string {
	switch scalar {
	case "int64", "uint64", "fixed64", "sfixed64", "sint64":
		// 64-bit integers are strings in the generated types.
		return `"0"`
	case "double", "float", "int32", "fixed32", "uint32", "sfixed32", "sint32":
		return "0"
	case "bool":
		return "false"
	case "bytes":
		return "new Uint8Array()"
	default:
		return `""`
	}
}

// importSet collects the import lines an example needs, one per module.
type importSet struct {
	names map[string]map[string]bool
}

func newImportSet() *importSet {
	return &importSet{names: map[string]map[string]bool{}}
}

func (s *importSet) add(path, name string) {
	if path == "" || name == "" {
		return
	}
	if s.names[path] == nil {
		s.names[path] = map[string]bool{}
	}
	s.names[path][name] = true
}

func (s *importSet) render() string {
	paths := make([]string, 0, len(s.names))
	for path := range s.names {
		paths = append(paths, path)
	}
	sort.Strings(paths)

	var b strings.Builder
	for _, path := range paths {
		names := make([]string, 0, len(s.names[path]))
		for name := range s.names[path] {
			names = append(names, name)
		}
		sort.Strings(names)
		fmt.Fprintf(&b, "import { %s } from %q;\n", strings.Join(names, ", "), path)
	}
	return b.String()
}

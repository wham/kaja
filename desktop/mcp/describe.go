package mcp

import (
	"fmt"
	"sort"
	"strings"
)

// The well-known types a script builds with a kaja helper rather than by hand.
// A generated request leaves them out - there is no default that would send -
// which is exactly why they have to be named here: otherwise the only place they
// appear is a type name in a stub, and a caller invents its own str()/bool()
// helpers for the `kind` oneof.
var kajaBuilders = map[string]struct {
	call string
	note string
}{
	"google.protobuf.Value":     {"kaja.value(null)", "any JSON - kaja.value(\"text\"), kaja.value(42), kaja.value(true), kaja.value({...})"},
	"google.protobuf.Struct":    {"kaja.struct({})", "a JSON object - kaja.struct({ rows: [\"F\"], accessible: true })"},
	"google.protobuf.ListValue": {"kaja.listValue([])", "a JSON array - kaja.listValue([1, \"two\", false])"},
}

// describeMethod is the whole answer to "how do I call this": what the method
// does, the request type with everything it reaches inlined, the response type,
// and a call ready to paste into a script.
func (c Catalog) describeMethod(resolved resolvedMethod) string {
	var b strings.Builder

	read, certain := resolved.readOnly()
	effect := "writes - calling it changes data"
	if read {
		effect = "read-only"
	}
	if certain {
		effect += fmt.Sprintf(" (%s)", resolved.method.HTTP)
	} else {
		effect += " (inferred from the method name; nothing in the API states it)"
	}

	fmt.Fprintf(&b, "%s · %s\n", resolved.app.Name, resolved.qualified())
	fmt.Fprintf(&b, "%s\n", effect)
	if resolved.method.Doc != "" {
		fmt.Fprintf(&b, "%s\n", resolved.method.Doc)
	}
	if resolved.method.ServerStreaming || resolved.method.ClientStreaming {
		fmt.Fprintf(&b, "streaming: %s\n", streamingNote(resolved.method))
	}

	b.WriteString("\nRequest  " + c.typeLabel(resolved.method.Input) + "\n")
	b.WriteString(c.renderType(resolved.method.Input))
	b.WriteString("\nResponse " + c.typeLabel(resolved.method.Output) + "\n")
	if resolved.method.Output == resolved.method.Input {
		b.WriteString("  (the same type as the request)\n")
	} else {
		b.WriteString(c.renderType(resolved.method.Output))
	}

	if note := c.optionalityNote(resolved.method.Input); note != "" {
		b.WriteString("\n" + note + "\n")
	}

	b.WriteString("\nExample\n")
	b.WriteString(indent(c.exampleCall(resolved), "  "))

	if notes := c.builderNotes(resolved.method.Input); len(notes) > 0 {
		b.WriteString("\nBuilding the well-known types in this request:\n")
		for _, note := range notes {
			b.WriteString("  " + note + "\n")
		}
	}
	return b.String()
}

func streamingNote(method CatalogMethod) string {
	switch {
	case method.ServerStreaming && method.ClientStreaming:
		return "bidirectional; both sides send a stream of messages"
	case method.ServerStreaming:
		return "the server streams many responses"
	default:
		return "the client streams many requests"
	}
}

// typeLabel names a type the way a script writes it, keeping the proto name
// beside it when the two differ.
func (c Catalog) typeLabel(typeName string) string {
	typ, ok := c.Types[typeName]
	if !ok {
		return typeName
	}
	if typ.TS != "" && typ.TS != typeName {
		return fmt.Sprintf("%s (%s)", typ.TS, typeName)
	}
	return typeName
}

// renderType prints a message's fields with every message type it reaches
// inlined underneath, which is the whole point: one call, no follow-up reads.
// A type already on the path is named rather than expanded again, so a recursive
// message ends.
func (c Catalog) renderType(typeName string) string {
	var b strings.Builder
	budget := maxTypeLines
	c.renderFields(&b, typeName, "  ", map[string]bool{}, &budget)
	if b.Len() == 0 {
		return "  (no fields)\n"
	}
	if budget <= 0 {
		b.WriteString("  … the rest is cut off here. Read the generated stub resource for the whole type.\n")
	}
	return b.String()
}

// maxTypeLines bounds one inlined type. An API can declare a response with
// hundreds of properties nested several deep, and a listing of all of it would
// cost more than the tool saves.
const maxTypeLines = 250

func (c Catalog) renderFields(b *strings.Builder, typeName, prefix string, path map[string]bool, budget *int) {
	typ, ok := c.Types[typeName]
	if !ok {
		return
	}
	path[typeName] = true
	defer delete(path, typeName)

	// A oneof's members are written under one property, so they are printed as one
	// group rather than as sibling fields that all look settable at once.
	seenOneof := map[string]bool{}
	for _, field := range typ.Fields {
		if *budget <= 0 {
			return
		}
		if field.Oneof != "" {
			if seenOneof[field.Oneof] {
				continue
			}
			seenOneof[field.Oneof] = true
			*budget--
			fmt.Fprintf(b, "%s%s: { oneofKind, ... }  one of: %s\n", prefix, field.Oneof, strings.Join(oneofMembers(typ, field.Oneof), ", "))
			for _, member := range typ.Fields {
				if member.Oneof == field.Oneof {
					c.renderField(b, member, prefix+"  ", path, budget)
				}
			}
			continue
		}
		c.renderField(b, field, prefix, path, budget)
	}
}

func (c Catalog) renderField(b *strings.Builder, field CatalogField, prefix string, path map[string]bool, budget *int) {
	*budget--
	fmt.Fprintf(b, "%s%s\n", prefix, strings.TrimRight(fieldLine(c, field), " "))
	if field.Kind != "message" {
		return
	}
	if builder, ok := kajaBuilders[field.Type]; ok {
		fmt.Fprintf(b, "%s  = %s\n", prefix, builder.note)
		return
	}
	if path[field.Type] {
		fmt.Fprintf(b, "%s  (recursive - see %s above)\n", prefix, c.shortType(field.Type))
		return
	}
	c.renderFields(b, field.Type, prefix+"  ", path, budget)
}

// fieldLine is one field on one line: what to write, what type it is, and every
// thing the API said about it.
func fieldLine(c Catalog, field CatalogField) string {
	typeName := c.shortType(field.Type)
	if field.Repeated {
		typeName += "[]"
	}
	line := fmt.Sprintf("%-22s %s", field.Name, typeName)

	var marks []string
	if field.Required {
		marks = append(marks, "required")
	}
	if field.In != "" {
		marks = append(marks, field.In)
	}
	if field.Envelope {
		marks = append(marks, "http payload")
	}
	if enum, ok := c.Enums[field.Type]; ok && len(enum.Values) > 0 {
		marks = append(marks, enumChoices(enum))
	}
	if len(marks) > 0 {
		line += "  [" + strings.Join(marks, ", ") + "]"
	}
	if field.Doc != "" {
		line += "  " + field.Doc
	}
	return line
}

// shortType is how a type is named inside a field listing: the TypeScript name a
// script writes, falling back to the proto name.
func (c Catalog) shortType(typeName string) string {
	if typ, ok := c.Types[typeName]; ok && typ.TS != "" {
		return typ.TS
	}
	if enum, ok := c.Enums[typeName]; ok && enum.TS != "" {
		return enum.TS
	}
	return typeName
}

// maxEnumValues bounds what an enum contributes to a field line. A long enum
// would otherwise be the longest thing on the page, and its values are in the
// generated stub in full.
const maxEnumValues = 8

func enumChoices(enum CatalogEnum) string {
	values := enum.Values
	suffix := ""
	if len(values) > maxEnumValues {
		suffix = fmt.Sprintf(", … %d more", len(values)-maxEnumValues)
		values = values[:maxEnumValues]
	}
	return enum.TS + "." + strings.Join(values, " | "+enum.TS+".") + suffix
}

func oneofMembers(typ CatalogType, group string) []string {
	var out []string
	for _, field := range typ.Fields {
		if field.Oneof == group {
			out = append(out, field.Name)
		}
	}
	return out
}

// optionalityNote answers the question a request shape can't: which of these
// fields do I actually have to send. An API that declares its required fields
// gets the exact answer; proto3 on its own has no required, and saying so is
// better than letting a caller fill every field defensively.
func (c Catalog) optionalityNote(typeName string) string {
	typ, ok := c.Types[typeName]
	if !ok || len(typ.Fields) == 0 {
		return ""
	}
	var required []string
	for _, field := range typ.Fields {
		if field.Required {
			required = append(required, field.Name)
		}
	}
	if len(required) == 0 {
		return "Every field is optional on the wire: this is proto3, which has no required, and the API declares none. Send what you mean and leave the rest out - an omitted field is its zero value, not an error."
	}
	return "Required: " + strings.Join(required, ", ") + ". Everything else may be left out."
}

// builderNotes lists the kaja helpers a request needs, so the one thing a
// generated example can't spell out in place is stated once beneath it.
func (c Catalog) builderNotes(typeName string) []string {
	found := map[string]bool{}
	c.walkTypes(typeName, map[string]bool{}, func(field CatalogField) {
		if _, ok := kajaBuilders[field.Type]; ok {
			found[field.Type] = true
		}
	})
	names := make([]string, 0, len(found))
	for name := range found {
		names = append(names, name)
	}
	sort.Strings(names)

	notes := make([]string, 0, len(names))
	for _, name := range names {
		notes = append(notes, fmt.Sprintf("%s - %s", name, kajaBuilders[name].note))
	}
	if len(notes) > 0 {
		notes = append(notes, "import { kaja } from \"kaja\"; never hand-write the `kind` oneof.")
	}
	return notes
}

func (c Catalog) walkTypes(typeName string, path map[string]bool, visit func(CatalogField)) {
	typ, ok := c.Types[typeName]
	if !ok || path[typeName] {
		return
	}
	path[typeName] = true
	defer delete(path, typeName)
	for _, field := range typ.Fields {
		visit(field)
		if field.Kind == "message" {
			c.walkTypes(field.Type, path, visit)
		}
	}
}

func indent(text, prefix string) string {
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	for i, line := range lines {
		if line != "" {
			lines[i] = prefix + line
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

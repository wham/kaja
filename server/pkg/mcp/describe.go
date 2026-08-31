package mcp

import (
	"fmt"
	"strings"
)

// The well-known JSON types a script builds with a kaja helper. A field of one of
// these is a `kind` oneof on the wire and unwritable by hand, so the generated
// call fills it with the builder — and this names the builder beside it, because
// a caller who only sees `extras?: Value` will otherwise write its own
// str()/bool() helpers for the encoding.
var kajaBuilders = map[string]string{
	"Value":     `kaja.value(json) — any JSON: kaja.value("text"), kaja.value(42), kaja.value(true), kaja.value({...})`,
	"Struct":    `kaja.struct(json) — a JSON object: kaja.struct({ rows: ["F"], accessible: true })`,
	"ListValue": `kaja.listValue(json) — a JSON array: kaja.listValue([1, "two", false])`,
}

// maxDeclarationLines bounds what one answer prints. An API can declare a
// response with hundreds of properties nested several deep, and a listing of all
// of it would cost more than the tool saves.
const maxDeclarationLines = 250

// describeMethod is the whole answer to "how do I call this": what the method
// does, its signature, the TypeScript declarations that signature names, and the
// call Kaja writes for it.
func (c Catalog) describeMethod(resolved resolvedMethod) string {
	var b strings.Builder
	method := resolved.method

	read, certain := resolved.readOnly()
	effect := "writes - calling it changes data"
	if read {
		effect = "read-only"
	}
	if certain {
		effect += fmt.Sprintf(" (%s)", method.HTTP)
	} else {
		effect += " (inferred from the method name; nothing in the API states it)"
	}

	fmt.Fprintf(&b, "%s · %s\n", resolved.app.Name, resolved.qualified())
	fmt.Fprintf(&b, "%s\n", effect)
	if method.Doc != "" {
		fmt.Fprintf(&b, "%s\n", method.Doc)
	}
	if note := streamingNote(method.Streaming); note != "" {
		fmt.Fprintf(&b, "streaming: %s\n", note)
	}
	if method.Deprecated {
		b.WriteString("deprecated: the API asks callers to move off this method - Kaja still calls it, so it is worth checking what the API replaced it with before writing a script against it\n")
	}

	fmt.Fprintf(&b, "\nimport { %s } from %q;\n", resolved.service.Name, resolved.service.ImportPath)
	fmt.Fprintf(&b, "%s.%s\n", resolved.service.Name, method.Signature)

	b.WriteString("\n" + strings.TrimRight(resolved.app.renderDeclarations(method.Input, method.Output), "\n") + "\n")

	if example := strings.TrimSpace(method.Example); example != "" {
		b.WriteString("\nA call to start from - the fields the API requires and no others, since the rest are declared above and an omitted field is sent as its zero value:\n\n")
		b.WriteString(example + "\n")
	}

	if notes := builderNotes(resolved); len(notes) > 0 {
		b.WriteString("\nSome fields here hold arbitrary JSON and are built rather than written:\n")
		for _, note := range notes {
			b.WriteString("  " + note + "\n")
		}
		b.WriteString("  They come from `import { kaja } from \"kaja\";`. Never write the `kind` oneof by hand.\n")
	}
	return b.String()
}

// What the streaming kind means for a caller. Two of the three Kaja does not support
// yet, so the note is why the method is listed rather than a description of the wire:
// a script that calls one is refused, and no request fixes that. The UI says the same
// sentence in the tree and over the generated call.
func streamingNote(streaming string) string {
	switch streaming {
	case "client":
		return "client streaming is not supported by Kaja yet - calling this method is refused, whatever the request"
	case "bidirectional":
		return "bidirectional streaming is not supported by Kaja yet - calling this method is refused, whatever the request"
	case "server":
		return "server streaming; the call hands back the last message, and all of them are in the run's log"
	}
	return ""
}

// renderDeclarations prints the types a signature names and everything they
// reach, so one call answers the whole question. What is printed is the generated
// declaration itself, which is what the script is checked against.
//
// The budget is spent line by line rather than declaration by declaration: one
// API's response type can be four hundred properties on its own, and stopping
// only between declarations would print all of it.
func (a CatalogApp) renderDeclarations(names ...string) string {
	declarations := a.declarationsFor(names...)
	if len(declarations) == 0 {
		return "(this method names no declared types)\n"
	}

	var b strings.Builder
	budget := maxDeclarationLines
	for i, declaration := range declarations {
		// A well-known JSON type has no members to show - it is a `kind` oneof
		// nobody writes - and the builder note below says what to do with it.
		if _, wellKnown := kajaBuilders[declaration.Name]; wellKnown {
			continue
		}
		lines := strings.Split(declaration.Text, "\n")
		if len(lines) > budget {
			if budget > 1 {
				b.WriteString(strings.Join(lines[:budget-1], "\n") + "\n")
			}
			fmt.Fprintf(&b, "    // … cut off here. describe_type %q for the whole declaration.\n", declaration.Name)
			remaining := len(declarations) - i - 1
			if remaining > 0 {
				fmt.Fprintf(&b, "\n// … and %d more type(s) it references, one describe_type away.\n", remaining)
			}
			return b.String()
		}
		budget -= len(lines) + 1
		b.WriteString(declaration.Text + "\n\n")
	}
	return b.String()
}

// builderNotes names the kaja builders the types in this method need, once,
// beneath the declarations that mention them.
func builderNotes(resolved resolvedMethod) []string {
	text := strings.Join([]string{resolved.method.Example}, "\n")
	for _, declaration := range resolved.app.declarationsFor(resolved.method.Input, resolved.method.Output) {
		text += "\n" + declaration.Text
	}

	var notes []string
	for _, name := range []string{"Value", "Struct", "ListValue"} {
		if mentionsType(text, name) {
			notes = append(notes, kajaBuilders[name])
		}
	}
	return notes
}

// mentionsType reports whether a type name appears as a type rather than as part
// of a longer identifier ("Value" in `extras?: Value;`, not in `ListValue`).
func mentionsType(text, name string) bool {
	for index := 0; ; {
		found := strings.Index(text[index:], name)
		if found < 0 {
			return false
		}
		found += index
		index = found + len(name)
		if found > 0 && isIdentifierChar(text[found-1]) {
			continue
		}
		if index < len(text) && isIdentifierChar(text[index]) {
			continue
		}
		return true
	}
}

func isIdentifierChar(c byte) bool {
	return c == '_' || c == '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
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

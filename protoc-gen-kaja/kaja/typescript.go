package kaja

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf16"
)

// The marks an app writes onto a field where protobuf has no shape for what it needs
// to say. Declared in server/pkg/apps/openapi/http.proto.
const (
	httpInOption       = "kaja.http_in"
	httpRequiredOption = "kaja.http_required"
	httpPayloadOption  = "kaja.http_payload"
	enumValuesOption   = "kaja.enum_values"
)

// A declaration is written two ways. The full one is what the editor checks a script
// against and what Kaja's own Api module is: every value, every word of every doc. The
// brief one is what an agent is handed, where a hundred-value enum is a page on its own
// and a doc is one line.
type detail int

const (
	full detail = iota
	brief
)

const (
	maxEnumMembers = 24
	// maxDoc counts the UTF-16 units a script's string counts.
	maxDoc = 200
)

// fieldMarks reads what the app said about a field off its options.
func fieldMarks(fieldOptions []customOption) []string {
	options := map[string]interface{}{}
	for _, option := range fieldOptions {
		options[option.key] = option.value
	}
	var marks []string
	if options[httpRequiredOption] == true {
		marks = append(marks, "required")
	}
	if in, ok := options[httpInOption].(string); ok && in != "" {
		marks = append(marks, in+" parameter")
	}
	if truthy(options[httpPayloadOption]) {
		marks = append(marks, "carries the HTTP payload")
	}
	if values, ok := options[enumValuesOption].([]interface{}); ok {
		var strs []string
		for _, value := range values {
			if s, ok := value.(string); ok {
				strs = append(strs, s)
			}
		}
		if len(strs) > 0 {
			marks = append(marks, "one of: "+strings.Join(strs, ", "))
		}
	}
	return marks
}

func truthy(value interface{}) bool {
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case string:
		return v != ""
	case int:
		return v != 0
	case float64:
		return v != 0
	default:
		return true
	}
}

// writeDoc writes the JSDoc a declaration carries, or nothing where it has nothing to say.
func writeDoc(b *strings.Builder, indent string, d detail, doc string, deprecated bool, marks []string) {
	var paragraphs []string
	if doc != "" {
		paragraphs = append(paragraphs, doc)
	}
	if len(marks) > 0 {
		bracketed := make([]string, len(marks))
		for i, mark := range marks {
			bracketed[i] = "[" + mark + "]"
		}
		paragraphs = append(paragraphs, strings.Join(bracketed, " "))
	}

	if d == brief {
		if text := briefText(doc, marks); text != "" {
			fmt.Fprintf(b, "%s/** %s */\n", indent, escapeComment(text))
		}
		return
	}

	var lines []string
	for i, paragraph := range paragraphs {
		if i > 0 {
			lines = append(lines, "")
		}
		lines = append(lines, strings.Split(paragraph, "\n")...)
	}
	if deprecated {
		if len(lines) > 0 {
			lines = append(lines, "")
		}
		lines = append(lines, "@deprecated")
	}
	if len(lines) == 0 {
		return
	}
	b.WriteString(indent + "/**\n")
	for _, line := range lines {
		if line == "" {
			b.WriteString(indent + " *\n")
		} else {
			b.WriteString(indent + " * " + escapeComment(line) + "\n")
		}
	}
	b.WriteString(indent + " */\n")
}

// briefText is a doc and its marks as one line, which is what the tree and an agent show.
func briefText(doc string, marks []string) string {
	words := strings.Fields(doc)
	for _, mark := range marks {
		words = append(words, "["+mark+"]")
	}
	text := strings.Join(words, " ")
	if units := utf16.Encode([]rune(text)); len(units) > maxDoc {
		text = strings.TrimRight(string(utf16.Decode(units[:maxDoc])), " ") + "…"
	}
	return text
}

func escapeComment(s string) string {
	return strings.ReplaceAll(s, "*/", "*\\/")
}

func (msg *message) declaration(d detail) string {
	var b strings.Builder
	writeDoc(&b, "", d, msg.doc, msg.deprecated, nil)
	if len(msg.members) == 0 {
		fmt.Fprintf(&b, "export interface %s {}", msg.name)
		return b.String()
	}
	fmt.Fprintf(&b, "export interface %s {\n", msg.name)
	for _, mem := range msg.members {
		writeDoc(&b, "    ", d, mem.doc, mem.deprecated, mem.marks)
		optional := ""
		if mem.optional {
			optional = "?"
		}
		fmt.Fprintf(&b, "    %s%s: %s;\n", mem.name, optional, mem.typeText(d))
	}
	b.WriteString("}")
	return b.String()
}

func (mem *member) typeText(d detail) string {
	if mem.alternatives == nil {
		return mem.typ
	}
	var b strings.Builder
	b.WriteString("{\n")
	for _, alt := range mem.alternatives {
		fmt.Fprintf(&b, "        oneofKind: %q;\n", alt.name)
		if d == full {
			writeDoc(&b, "        ", d, alt.doc, alt.deprecated, alt.marks)
		}
		fmt.Fprintf(&b, "        %s: %s;\n", alt.name, alt.typ)
		b.WriteString("    } | {\n")
	}
	b.WriteString("        oneofKind: undefined;\n    }")
	return b.String()
}

func (e *enum) declaration(d detail) string {
	var b strings.Builder
	writeDoc(&b, "", d, e.doc, e.deprecated, nil)
	fmt.Fprintf(&b, "export enum %s {\n", e.name)
	for i, v := range e.values {
		if d == brief && i == maxEnumMembers {
			fmt.Fprintf(&b, "    // … %d more\n", len(e.values)-maxEnumMembers)
			break
		}
		if d == full {
			writeDoc(&b, "    ", d, v.doc, v.deprecated, nil)
		}
		fmt.Fprintf(&b, "    %s = %d,\n", v.name, v.number)
	}
	b.WriteString("}")
	return b.String()
}

// scope picks a name for something the module needs that the proto didn't declare,
// numbering it where the proto took the name first.
func (m *module) scope(names ...string) map[string]string {
	out := map[string]string{}
	for _, name := range names {
		alias := name
		for n := 1; m.taken[alias]; n++ {
			alias = name + "$"
			if n > 1 {
				alias += strconv.Itoa(n)
			}
		}
		m.taken[alias] = true
		out[name] = alias
	}
	return out
}

func importClause(names []importName) string {
	parts := make([]string, len(names))
	for i, n := range names {
		if n.alias == n.name {
			parts[i] = n.name
		} else {
			parts[i] = n.name + " as " + n.alias
		}
	}
	return "{ " + strings.Join(parts, ", ") + " }"
}

// typescriptModule is a proto file as a module of its own: the declarations, the
// MessageType and ServiceType the runtime reads them by, and a client per service.
// Kaja's own Api is generated this way; an app is not.
func typescriptModule(m *module) string {
	var b strings.Builder
	fmt.Fprintf(&b, "// Generated by protoc-gen-kaja from %s. Do not edit.\n", m.file.GetName())

	var runtimeNames []string
	if len(m.messages) > 0 {
		runtimeNames = append(runtimeNames, "MessageType")
	}
	var rpcNames []string
	var rpcTypes []string
	if len(m.services) > 0 {
		rpcNames = []string{"ServiceType", "stackIntercept"}
		rpcTypes = []string{"RpcOptions", "RpcTransport"}
		for _, kind := range []string{"UnaryCall", "ServerStreamingCall", "ClientStreamingCall", "DuplexStreamingCall"} {
			for _, svc := range m.services {
				if containsCallType(svc, kind) {
					rpcTypes = append(rpcTypes, kind)
					break
				}
			}
		}
	}
	runtime := m.scope(append(append(append([]string{}, runtimeNames...), rpcNames...), rpcTypes...)...)
	clause := func(names []string) string {
		parts := make([]importName, len(names))
		for i, name := range names {
			parts[i] = importName{name: name, alias: runtime[name]}
		}
		return importClause(parts)
	}
	if len(runtimeNames) > 0 {
		fmt.Fprintf(&b, "import %s from \"@protobuf-ts/runtime\";\n", clause(runtimeNames))
	}
	if len(rpcNames) > 0 {
		fmt.Fprintf(&b, "import %s from \"@protobuf-ts/runtime-rpc\";\n", clause(rpcNames))
		fmt.Fprintf(&b, "import type %s from \"@protobuf-ts/runtime-rpc\";\n", clause(rpcTypes))
	}
	for _, from := range m.sortedImports() {
		fmt.Fprintf(&b, "import %s from %q;\n", importClause(m.imports[from]), from)
	}

	for _, msg := range m.messages {
		b.WriteString("\n" + msg.declaration(full) + "\n")
	}
	for _, e := range m.enums {
		b.WriteString("\n" + e.declaration(full) + "\n")
	}
	for _, msg := range m.messages {
		fmt.Fprintf(&b, "\nexport const %s: %s<%s> = new %s<%s>(%s, [", msg.name, runtime["MessageType"], msg.name, runtime["MessageType"], msg.name, jsString(msg.typeName))
		for i, f := range msg.fields {
			if i > 0 {
				b.WriteString(",")
			}
			b.WriteString("\n    " + m.fieldLiteral(f))
		}
		if len(msg.fields) > 0 {
			b.WriteString("\n")
		}
		b.WriteString("]")
		if len(msg.options) > 0 {
			b.WriteString(", " + optionsJSON(msg.options))
		}
		b.WriteString(");\n")
	}
	for _, svc := range m.services {
		writeServiceType(&b, svc, runtime["ServiceType"])
	}
	for _, svc := range m.services {
		writeClient(&b, m, svc, runtime)
	}
	return b.String()
}

func containsCallType(svc *service, kind string) bool {
	for _, meth := range svc.methods {
		if callKind(meth).call == kind {
			return true
		}
	}
	return false
}

type kind struct {
	name, call string
}

func callKind(meth *method) kind {
	switch {
	case meth.clientStreaming && meth.serverStreaming:
		return kind{"duplex", "DuplexStreamingCall"}
	case meth.clientStreaming:
		return kind{"clientStreaming", "ClientStreamingCall"}
	case meth.serverStreaming:
		return kind{"serverStreaming", "ServerStreamingCall"}
	}
	return kind{"unary", "UnaryCall"}
}

func jsString(s string) string {
	encoded, _ := json.Marshal(s)
	return string(encoded)
}

func (m *module) fieldLiteral(f *field) string {
	parts := []string{
		"no: " + strconv.Itoa(int(f.no)),
		"name: " + jsString(f.name),
		"kind: " + jsString(f.kind),
	}
	if f.localName != "" {
		parts = append(parts, "localName: "+jsString(f.localName))
	}
	if f.jsonName != "" {
		parts = append(parts, "jsonName: "+jsString(f.jsonName))
	}
	if f.oneof != "" {
		parts = append(parts, "oneof: "+jsString(f.oneof))
	}
	if f.opt {
		parts = append(parts, "opt: true")
	}
	if f.repeat != 0 {
		parts = append(parts, "repeat: "+strconv.Itoa(f.repeat))
	}
	switch f.kind {
	case "scalar":
		parts = append(parts, "T: "+strconv.Itoa(f.scalar))
	case "message", "enum":
		parts = append(parts, "T: "+m.typeThunk(f.kind, f.ref))
	case "map":
		parts = append(parts, "K: "+strconv.Itoa(f.key))
		v := f.value
		value := "{ kind: " + jsString(v.kind) + ", T: "
		if v.kind == "scalar" {
			value += strconv.Itoa(v.scalar)
			if v.long != nil {
				value += ", L: " + strconv.Itoa(*v.long)
			}
		} else {
			value += m.typeThunk(v.kind, v.ref)
		}
		parts = append(parts, "V: "+value+" }")
	}
	if f.long != nil {
		parts = append(parts, "L: "+strconv.Itoa(*f.long))
	}
	if len(f.options) > 0 {
		parts = append(parts, "options: "+optionsJSON(f.options))
	}
	return "{ " + strings.Join(parts, ", ") + " }"
}

func (m *module) typeThunk(kind string, ref *typeInfo) string {
	name := m.ref(ref.typeName)
	if kind == "message" {
		return "() => " + name
	}
	info := []string{jsString(ref.typeName), name}
	if prefix := enumPrefix(ref.enum); prefix != "" {
		info = append(info, jsString(prefix))
	}
	return "() => [" + strings.Join(info, ", ") + "]"
}

func writeServiceType(b *strings.Builder, svc *service, serviceType string) {
	fmt.Fprintf(b, "\nexport const %s = new %s(%s, [", svc.name, serviceType, jsString(svc.typeName))
	for i, meth := range svc.methods {
		if i > 0 {
			b.WriteString(",")
		}
		parts := []string{"name: " + jsString(meth.name)}
		if meth.localName != "" {
			parts = append(parts, "localName: "+jsString(meth.localName))
		}
		if meth.idempotency != "" {
			parts = append(parts, "idempotency: "+jsString(meth.idempotency))
		}
		if meth.serverStreaming {
			parts = append(parts, "serverStreaming: true")
		}
		if meth.clientStreaming {
			parts = append(parts, "clientStreaming: true")
		}
		parts = append(parts, "options: "+optionsJSON(meth.options), "I: "+meth.input, "O: "+meth.output)
		b.WriteString("\n    { " + strings.Join(parts, ", ") + " }")
	}
	if len(svc.methods) > 0 {
		b.WriteString("\n")
	}
	b.WriteString("]")
	if len(svc.options) > 0 {
		b.WriteString(", " + optionsJSON(svc.options))
	}
	b.WriteString(");\n")
}

func writeClient(b *strings.Builder, m *module, svc *service, runtime map[string]string) {
	names := m.scope(svc.name + "Client")
	fmt.Fprintf(b, "\n")
	writeDoc(b, "", full, svc.doc, svc.deprecated, nil)
	fmt.Fprintf(b, "export class %s {\n", names[svc.name+"Client"])
	fmt.Fprintf(b, "    readonly #transport: %s;\n\n", runtime["RpcTransport"])
	fmt.Fprintf(b, "    constructor(transport: %s) {\n        this.#transport = transport;\n    }\n", runtime["RpcTransport"])
	for i, meth := range svc.methods {
		k := callKind(meth)
		b.WriteString("\n")
		writeDoc(b, "    ", full, meth.doc, meth.deprecated, nil)
		name := escapeMethodName(toCamelCase(meth.name))
		input := ""
		argument := ""
		if !meth.clientStreaming {
			input = "input: " + meth.input + ", "
			argument = ", input"
		}
		fmt.Fprintf(b, "    %s(%soptions?: %s): %s<%s, %s> {\n", name, input, runtime["RpcOptions"], runtime[k.call], meth.input, meth.output)
		fmt.Fprintf(b, "        return %s<%s, %s>(%q, this.#transport, %s.methods[%d], this.#transport.mergeOptions(options)%s);\n",
			runtime["stackIntercept"], meth.input, meth.output, k.name, svc.name, i, argument)
		b.WriteString("    }\n")
	}
	b.WriteString("}\n")
}

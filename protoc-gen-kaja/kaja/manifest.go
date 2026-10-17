package kaja

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf16"

	"google.golang.org/protobuf/types/descriptorpb"
)

// ManifestName is the file the kaja_manifest parameter adds beside the sources.
const ManifestName = "kaja.manifest.json"

// The manifest is what the plugin knows about the TypeScript it wrote, said once so
// the UI never has to parse it back. Every text in it is cut from the generated file
// at offsets recorded while that file was written, so it can't disagree with it.
type manifest struct {
	Version int               `json:"version"`
	Modules []*moduleManifest `json:"modules"`
}

type moduleManifest struct {
	Path string `json:"path"`
	// EditorText is the module Monaco is given in place of the generated one.
	EditorText   string             `json:"editorText"`
	Services     []*serviceManifest `json:"services"`
	Interfaces   []string           `json:"interfaces"`
	Enums        []string           `json:"enums"`
	Declarations []*declaration     `json:"declarations"`
}

type serviceManifest struct {
	Name         string            `json:"name"`
	TypeName     string            `json:"typeName"`
	ClientModule string            `json:"clientModule"`
	Methods      []*methodManifest `json:"methods"`
}

// A method is listed where the client interface writes it with an input, which is
// what leaves the two kinds that stream from the client out.
type methodManifest struct {
	Name       string `json:"name"`
	Input      string `json:"input"`
	Output     string `json:"output"`
	Doc        string `json:"doc,omitempty"`
	Deprecated bool   `json:"deprecated,omitempty"`
}

type declaration struct {
	Name       string   `json:"name"`
	Text       string   `json:"text"`
	References []string `json:"references"`
}

// module is what a generator records about the file it is writing.
type module struct {
	decls    []*declRecord
	services []*serviceRecord
	clients  []*clientRecord
}

type declRecord struct {
	enum bool
	name string
	// start is where `export` is, end is past the closing brace.
	start, end int
	members    []*memberRecord
}

type memberRecord struct {
	name     string
	optional bool
	// options are the custom options of the field the member is, which the marks are
	// read from; a oneof has none.
	options []customOption
	// start is where the name is, typeEnd is past the type.
	start, typeEnd int
	// value is an enum member's initializer.
	value string
}

type serviceRecord struct {
	name, typeName string
	methods        []serviceMethodRecord
}

type serviceMethodRecord struct {
	name, input, output string
}

type clientRecord struct {
	service string
	methods []clientMethodRecord
}

type clientMethodRecord struct {
	name     string
	start    int
	hasInput bool
}

func (g *generator) record() *module {
	if g.rec == nil {
		g.rec = &module{}
	}
	return g.rec
}

func (g *generator) beginDecl(enum bool, name string) *declRecord {
	d := &declRecord{enum: enum, name: name, start: g.b.Len()}
	g.record().decls = append(g.record().decls, d)
	return d
}

// endDecl is called before the closing brace is written.
func (g *generator) endDecl(d *declRecord) {
	d.end = g.b.Len() + 1
}

// beginMember is called before the line the member's name opens is written.
func (g *generator) beginMember(d *declRecord, name string, optional bool, field *descriptorpb.FieldDescriptorProto) *memberRecord {
	m := &memberRecord{name: name, optional: optional, start: g.b.Len() + len(g.indent)}
	if field != nil {
		m.options = g.getCustomFieldOptions(field.Options)
	}
	d.members = append(d.members, m)
	return m
}

func (m *memberRecord) typeStart() int {
	n := len(m.name) + len(": ")
	if m.optional {
		n++
	}
	return m.start + n
}

type generatedFile struct {
	name    string
	content string
	rec     *module
}

func buildManifest(files []generatedFile) (string, error) {
	clients := map[string]generatedFile{}
	for _, f := range files {
		if strings.HasSuffix(f.name, ".client.ts") {
			clients[strings.TrimSuffix(f.name, ".client.ts")+".ts"] = f
		}
	}

	out := &manifest{Version: 1, Modules: []*moduleManifest{}}
	for _, f := range files {
		rec := f.rec
		if rec == nil {
			rec = &module{}
		}
		m := &moduleManifest{Path: f.name, Services: []*serviceManifest{}, Interfaces: []string{}, Enums: []string{}, Declarations: []*declaration{}}
		for _, d := range rec.decls {
			if d.enum {
				m.Enums = append(m.Enums, d.name)
				m.Declarations = append(m.Declarations, declareEnum(f.content, d))
			} else {
				m.Interfaces = append(m.Interfaces, d.name)
				m.Declarations = append(m.Declarations, declareInterface(f.content, d))
			}
		}

		var consts []string
		client, hasClient := clients[f.name]
		for _, s := range rec.services {
			service := &serviceManifest{Name: s.name, TypeName: s.typeName, Methods: []*methodManifest{}}
			if c := client.clientFor(s.name); hasClient && c != nil {
				service.ClientModule = client.name
				for _, cm := range c.methods {
					if !cm.hasInput {
						continue
					}
					sm := s.method(cm.name)
					trivia := leadingTrivia(client.content, cm.start)
					service.Methods = append(service.Methods, &methodManifest{
						Name:       cm.name,
						Input:      sm.input,
						Output:     sm.output,
						Doc:        docText(trivia),
						Deprecated: isDeprecated(trivia),
					})
				}
				consts = append(consts, serviceConst(s.name, service.Methods, client.content, c))
			}
			m.Services = append(m.Services, service)
		}
		m.EditorText = editorText(f.content, rec, consts)
		out.Modules = append(out.Modules, m)
	}

	body, err := json.Marshal(out)
	if err != nil {
		return "", fmt.Errorf("encoding the manifest: %w", err)
	}
	return string(body), nil
}

func (f generatedFile) clientFor(service string) *clientRecord {
	if f.rec == nil {
		return nil
	}
	for _, c := range f.rec.clients {
		if c.service == service {
			return c
		}
	}
	return nil
}

func (s *serviceRecord) method(name string) serviceMethodRecord {
	for _, m := range s.methods {
		if m.name == name {
			return m
		}
	}
	return serviceMethodRecord{name: name, input: "unknown", output: "unknown"}
}

// editorText is the module Monaco checks a script against: the module's sibling
// imports, interfaces and enums without their comments, then a const per service whose
// methods hand back a Call and take an Input — the same module a script imports `kaja`
// from says where those types come from.
func editorText(content string, rec *module, consts []string) string {
	var statements []string
	if len(consts) > 0 {
		statements = append(statements, `import type { Call, CallOptions, Input } from "kaja";`)
	}
	statements = append(statements, siblingImports(content)...)
	for _, d := range rec.decls {
		statements = append(statements, stripComments(content[d.start:d.end]))
	}
	statements = append(statements, consts...)
	if len(statements) == 0 {
		return ""
	}
	return strings.Join(statements, "\n") + "\n"
}

// siblingImports are the module's imports of another generated module.
func siblingImports(content string) []string {
	var imports []string
	for _, line := range strings.Split(content, "\n") {
		if !strings.HasPrefix(line, "import ") {
			continue
		}
		if strings.Contains(line, ` from "./`) || strings.Contains(line, ` from "../`) {
			imports = append(imports, line)
		}
	}
	return imports
}

// serviceConst is `export const <Service> = { … }`, a method per line carrying the
// doc comment the client interface gives it, so Monaco shows it on hover.
func serviceConst(name string, methods []*methodManifest, clientContent string, c *clientRecord) string {
	if len(methods) == 0 {
		return fmt.Sprintf("export const %s = {};", name)
	}
	starts := map[string]int{}
	for _, cm := range c.methods {
		starts[cm.name] = cm.start
	}
	var properties []string
	for _, m := range methods {
		var lines []string
		for _, line := range strings.Split(leadingTrivia(clientContent, starts[m.Name]), "\n") {
			if line = strings.TrimRight(line, " \t"); strings.TrimSpace(line) != "" {
				lines = append(lines, line)
			}
		}
		lines = append(lines, fmt.Sprintf("    %s: (input: Input<%s>, options?: CallOptions): Call<%s> => { }", m.Name, m.Input, m.Output))
		properties = append(properties, strings.Join(lines, "\n"))
	}
	return fmt.Sprintf("export const %s = {\n%s\n};", name, strings.Join(properties, ",\n"))
}

// The marks an app writes onto a field where protobuf has no shape for what it needs
// to say. Declared in server/pkg/apps/openapi/http.proto.
const (
	httpInOption       = "kaja.http_in"
	httpRequiredOption = "kaja.http_required"
	httpPayloadOption  = "kaja.http_payload"
	enumValuesOption   = "kaja.enum_values"
)

// maxEnumMembers bounds an enum. A hundred-value enum is a page on its own, and its
// full list is in the generated source.
const maxEnumMembers = 24

// maxDoc bounds one description, in the UTF-16 units a script's string counts. These
// are the API's own words and can run long.
const maxDoc = 200

// declareInterface re-emits a generated interface as a script reads it: the
// `@generated from protobuf` bookkeeping dropped, and what the app knows but
// TypeScript can't say — that a field is required, or travels in the query string —
// folded into each member's doc.
func declareInterface(content string, d *declRecord) *declaration {
	references := newOrderedSet()
	lines := []string{fmt.Sprintf("export interface %s {", d.name)}
	for _, m := range d.members {
		typeText := content[m.typeStart():m.typeEnd]
		collectReferences(typeText, references)
		if doc := joinDoc(docText(leadingTrivia(content, m.start)), fieldMarks(m.options)); doc != "" {
			lines = append(lines, fmt.Sprintf("    /** %s */", doc))
		}
		optional := ""
		if m.optional {
			optional = "?"
		}
		lines = append(lines, fmt.Sprintf("    %s%s: %s;", m.name, optional, typeText))
	}
	lines = append(lines, "}")
	return &declaration{Name: d.name, Text: withDoc(content, d, strings.Join(lines, "\n")), References: references.items}
}

// declareEnum re-emits a generated enum. The values are the point — an enum field is
// unwritable without them.
func declareEnum(content string, d *declRecord) *declaration {
	lines := []string{fmt.Sprintf("export enum %s {", d.name)}
	for i, m := range d.members {
		if i == maxEnumMembers {
			lines = append(lines, fmt.Sprintf("    // … %d more", len(d.members)-maxEnumMembers))
			break
		}
		lines = append(lines, fmt.Sprintf("    %s = %s,", m.name, m.value))
	}
	lines = append(lines, "}")
	return &declaration{Name: d.name, Text: withDoc(content, d, strings.Join(lines, "\n")), References: []string{}}
}

func withDoc(content string, d *declRecord, body string) string {
	if doc := docText(leadingTrivia(content, d.start)); doc != "" {
		return "/** " + doc + " */\n" + body
	}
	return body
}

func joinDoc(description string, marks []string) string {
	var parts []string
	if description != "" {
		parts = append(parts, description)
	}
	for _, mark := range marks {
		parts = append(parts, "["+mark+"]")
	}
	return strings.Join(parts, " ")
}

// fieldMarks reads what the app said about a field off the options the field
// descriptor carries into the stub.
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
	// A single value is not an array to the stub, so it is no declared set either.
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

// leadingTrivia is the comments and blank lines a declaration starting at pos is
// preceded by, up to the line ending the code before it: what TypeScript reads as the
// declaration's leading comments. A trailing comment on that line belongs to the code
// it ends.
func leadingTrivia(content string, pos int) string {
	lineStart := strings.LastIndexByte(content[:pos], '\n') + 1
	start := lineStart
	for start > 0 {
		prev := strings.LastIndexByte(content[:start-1], '\n') + 1
		line := strings.TrimSpace(content[prev : start-1])
		if line != "" && !strings.HasPrefix(line, "//") && !strings.HasPrefix(line, "/*") && !strings.HasPrefix(line, "*") {
			break
		}
		start = prev
	}
	return content[start:lineStart]
}

type commentRange struct {
	multiLine bool
	text      string
}

// commentRanges splits trivia into its comments.
func commentRanges(trivia string) []commentRange {
	var ranges []commentRange
	for i := 0; i < len(trivia); {
		switch {
		case strings.HasPrefix(trivia[i:], "//"):
			end := strings.IndexByte(trivia[i:], '\n')
			if end < 0 {
				end = len(trivia) - i
			}
			ranges = append(ranges, commentRange{text: trivia[i : i+end]})
			i += end
		case strings.HasPrefix(trivia[i:], "/*"):
			end := strings.Index(trivia[i+2:], "*/")
			if end < 0 {
				return ranges
			}
			ranges = append(ranges, commentRange{multiLine: true, text: trivia[i : i+2+end+2]})
			i += 2 + end + 2
		default:
			i++
		}
	}
	return ranges
}

var commentLinePrefix = regexp.MustCompile(`^\s*\*+/?`)

// docText reads a declaration's doc off its leading comments, dropping the
// `@generated from protobuf …` bookkeeping: it names the wire encoding, which nothing
// written in TypeScript depends on, and it is the only place a reader would meet
// protobuf at all.
func docText(trivia string) string {
	var lines []string
	for _, r := range commentRanges(trivia) {
		body := r.text[2:]
		if r.multiLine {
			body = r.text[2 : len(r.text)-2]
		}
		for _, line := range strings.Split(body, "\n") {
			text := strings.TrimSpace(commentLinePrefix.ReplaceAllString(line, ""))
			if text != "" && !strings.HasPrefix(text, "@") {
				lines = append(lines, text)
			}
		}
	}
	text := strings.TrimSpace(strings.Join(lines, " "))
	units := utf16.Encode([]rune(text))
	if len(units) > maxDoc {
		return strings.TrimRight(string(utf16.Decode(units[:maxDoc])), " \t\n\r") + "…"
	}
	return text
}

// The tag on a line of its own, past whatever comment decoration opens the line, so
// the word written inside a sentence is prose rather than a mark.
var deprecatedTag = regexp.MustCompile(`(?m)^[\s*/]*@deprecated\b`)

func isDeprecated(trivia string) bool {
	for _, r := range commentRanges(trivia) {
		if deprecatedTag.MatchString(r.text) {
			return true
		}
	}
	return false
}

// stripComments drops the comments from a generated statement, which is all that
// tells it apart from the statement the TypeScript printer would write again.
func stripComments(statement string) string {
	var lines []string
	for _, line := range strings.Split(statement, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "/*") || strings.HasPrefix(trimmed, "*") {
			continue
		}
		lines = append(lines, strings.TrimRight(cutTrailingComment(line), " \t"))
	}
	return strings.Join(lines, "\n")
}

func cutTrailingComment(line string) string {
	quote := byte(0)
	for i := 0; i < len(line); i++ {
		c := line[i]
		switch {
		case quote != 0:
			if c == '\\' {
				i++
			} else if c == quote {
				quote = 0
			}
		case c == '"' || c == '\'':
			quote = c
		case c == '/' && i+1 < len(line) && line[i+1] == '/':
			return line[:i]
		}
	}
	return line
}

// typeKeywords are the words of a type that TypeScript does not read as identifiers.
var typeKeywords = map[string]bool{
	"string": true, "number": true, "boolean": true, "bigint": true, "undefined": true, "null": true,
	"any": true, "unknown": true, "never": true, "object": true, "symbol": true, "void": true,
	"true": true, "false": true,
}

// collectReferences gathers the identifiers a type mentions, so an answer can close
// over everything a type reaches. Which of them name a declaration is settled by
// whoever holds the set.
func collectReferences(typeText string, into *orderedSet) {
	for i := 0; i < len(typeText); {
		c := typeText[i]
		switch {
		case strings.HasPrefix(typeText[i:], "//"):
			end := strings.IndexByte(typeText[i:], '\n')
			if end < 0 {
				return
			}
			i += end
		case strings.HasPrefix(typeText[i:], "/*"):
			end := strings.Index(typeText[i+2:], "*/")
			if end < 0 {
				return
			}
			i += end + 4
		case c == '"' || c == '\'':
			end := strings.IndexByte(typeText[i+1:], c)
			if end < 0 {
				return
			}
			i += end + 2
		case isIdentifierStart(c):
			j := i + 1
			for j < len(typeText) && (isIdentifierStart(typeText[j]) || (typeText[j] >= '0' && typeText[j] <= '9')) {
				j++
			}
			if word := typeText[i:j]; !typeKeywords[word] {
				into.add(word)
			}
			i = j
		default:
			i++
		}
	}
}

func isIdentifierStart(c byte) bool {
	return c == '_' || c == '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

type orderedSet struct {
	seen  map[string]bool
	items []string
}

func newOrderedSet() *orderedSet { return &orderedSet{seen: map[string]bool{}, items: []string{}} }

func (s *orderedSet) add(item string) {
	if !s.seen[item] {
		s.seen[item] = true
		s.items = append(s.items, item)
	}
}

package kaja

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ManifestName is the one file the kaja_manifest parameter generates.
const ManifestName = "kaja.manifest.json"

// The manifest is the whole of what an app compiles to. Nothing in it is code to run:
// the runtime builds its message and service types off the field descriptors, the
// editor checks a script against editorText, and an agent reads the declarations.
type manifest struct {
	Version int               `json:"version"`
	Modules []*moduleManifest `json:"modules"`
}

type moduleManifest struct {
	Path string `json:"path"`
	// EditorText is the module Monaco is given: the types, and a const per service
	// whose methods take an Input and hand back a Call.
	EditorText   string             `json:"editorText"`
	Messages     []*messageManifest `json:"messages"`
	Enums        []*enumManifest    `json:"enums"`
	Services     []*serviceManifest `json:"services"`
	Declarations []*declaration     `json:"declarations"`
}

type messageManifest struct {
	Name     string           `json:"name"`
	TypeName string           `json:"typeName"`
	Fields   []*fieldManifest `json:"fields"`
	Options  json.RawMessage  `json:"options,omitempty"`
}

// fieldManifest is a protobuf-ts PartialFieldInfo, with a message or an enum named by
// its type name where the runtime takes a function handing the type back.
type fieldManifest struct {
	No        int32             `json:"no"`
	Name      string            `json:"name"`
	Kind      string            `json:"kind"`
	LocalName string            `json:"localName,omitempty"`
	JsonName  string            `json:"jsonName,omitempty"`
	Oneof     string            `json:"oneof,omitempty"`
	Opt       bool              `json:"opt,omitempty"`
	Repeat    int               `json:"repeat,omitempty"`
	T         interface{}       `json:"T,omitempty"`
	L         *int              `json:"L,omitempty"`
	K         int               `json:"K,omitempty"`
	V         *mapValueManifest `json:"V,omitempty"`
	Options   json.RawMessage   `json:"options,omitempty"`
}

type mapValueManifest struct {
	Kind string      `json:"kind"`
	T    interface{} `json:"T"`
	L    *int        `json:"L,omitempty"`
}

type enumManifest struct {
	Name     string `json:"name"`
	TypeName string `json:"typeName"`
	// Values are [name, number] in declaration order, the prefix already taken off.
	Values [][2]interface{} `json:"values"`
	Prefix string           `json:"prefix,omitempty"`
}

type serviceManifest struct {
	Name     string            `json:"name"`
	TypeName string            `json:"typeName"`
	Methods  []*methodManifest `json:"methods"`
	Options  json.RawMessage   `json:"options,omitempty"`
}

type methodManifest struct {
	Name      string `json:"name"`
	LocalName string `json:"localName,omitempty"`
	// Input and Output are the types as the module names them; I and O are the type
	// names the runtime looks them up by.
	Input           string          `json:"input"`
	Output          string          `json:"output"`
	I               string          `json:"I"`
	O               string          `json:"O"`
	ServerStreaming bool            `json:"serverStreaming,omitempty"`
	ClientStreaming bool            `json:"clientStreaming,omitempty"`
	Idempotency     string          `json:"idempotency,omitempty"`
	Options         json.RawMessage `json:"options,omitempty"`
	Doc             string          `json:"doc,omitempty"`
	Deprecated      bool            `json:"deprecated,omitempty"`
}

type declaration struct {
	Name       string   `json:"name"`
	Text       string   `json:"text"`
	References []string `json:"references"`
}

func buildManifest(modules []*module) (string, error) {
	out := &manifest{Version: 2, Modules: []*moduleManifest{}}
	for _, m := range modules {
		out.Modules = append(out.Modules, m.manifest())
	}
	body, err := json.Marshal(out)
	if err != nil {
		return "", fmt.Errorf("encoding the manifest: %w", err)
	}
	return string(body), nil
}

func (m *module) manifest() *moduleManifest {
	out := &moduleManifest{
		Path:         m.path,
		EditorText:   m.editorText(),
		Messages:     []*messageManifest{},
		Enums:        []*enumManifest{},
		Services:     []*serviceManifest{},
		Declarations: []*declaration{},
	}
	for _, msg := range m.messages {
		manifest := &messageManifest{Name: msg.name, TypeName: msg.typeName, Fields: []*fieldManifest{}, Options: rawOptions(msg.options)}
		for _, f := range msg.fields {
			manifest.Fields = append(manifest.Fields, fieldManifestOf(f))
		}
		out.Messages = append(out.Messages, manifest)

		references := newOrderedSet()
		for _, mem := range msg.members {
			for _, ref := range mem.refs {
				references.add(ref)
			}
		}
		out.Declarations = append(out.Declarations, &declaration{Name: msg.name, Text: msg.declaration(brief), References: references.items})
	}
	for _, e := range m.enums {
		manifest := &enumManifest{Name: e.name, TypeName: e.typeName, Values: [][2]interface{}{}, Prefix: e.prefix}
		for _, v := range e.values {
			manifest.Values = append(manifest.Values, [2]interface{}{v.name, v.number})
		}
		out.Enums = append(out.Enums, manifest)
		out.Declarations = append(out.Declarations, &declaration{Name: e.name, Text: e.declaration(brief), References: []string{}})
	}
	for _, svc := range m.services {
		manifest := &serviceManifest{Name: svc.name, TypeName: svc.typeName, Methods: []*methodManifest{}, Options: rawOptions(svc.options)}
		for _, meth := range svc.methods {
			manifest.Methods = append(manifest.Methods, &methodManifest{
				Name:            meth.name,
				LocalName:       meth.localName,
				Input:           meth.input,
				Output:          meth.output,
				I:               typeNameOf(meth.inputType),
				O:               typeNameOf(meth.outputType),
				ServerStreaming: meth.serverStreaming,
				ClientStreaming: meth.clientStreaming,
				Idempotency:     meth.idempotency,
				Options:         rawOptions(meth.options),
				Doc:             briefText(meth.doc, nil),
				Deprecated:      meth.deprecated,
			})
		}
		out.Services = append(out.Services, manifest)
	}
	return out
}

func typeNameOf(info *typeInfo) string {
	if info == nil {
		return ""
	}
	return info.typeName
}

func rawOptions(options []customOption) json.RawMessage {
	if len(options) == 0 {
		return nil
	}
	return json.RawMessage(optionsJSON(options))
}

func fieldManifestOf(f *field) *fieldManifest {
	out := &fieldManifest{
		No:        f.no,
		Name:      f.name,
		Kind:      f.kind,
		LocalName: f.localName,
		JsonName:  f.jsonName,
		Oneof:     f.oneof,
		Opt:       f.opt,
		Repeat:    f.repeat,
		L:         f.long,
		Options:   rawOptions(f.options),
	}
	switch f.kind {
	case "scalar":
		out.T = f.scalar
	case "message", "enum":
		out.T = typeNameOf(f.ref)
	case "map":
		out.K = f.key
		out.V = &mapValueManifest{Kind: f.value.kind, L: f.value.long}
		if f.value.kind == "scalar" {
			out.V.T = f.value.scalar
		} else {
			out.V.T = typeNameOf(f.value.ref)
		}
	}
	return out
}

// editorText is the module Monaco checks a script against. A method that streams from
// the client is left off its service, since it takes no input a script could write.
func (m *module) editorText() string {
	var imports, statements []string
	var kaja map[string]string
	if len(m.services) > 0 {
		kaja = m.scope("Call", "CallOptions", "Input")
		imports = append(imports, "import type "+importClause([]importName{
			{name: "Call", alias: kaja["Call"]},
			{name: "CallOptions", alias: kaja["CallOptions"]},
			{name: "Input", alias: kaja["Input"]},
		})+` from "kaja";`)
	}
	for _, from := range m.sortedImports() {
		imports = append(imports, fmt.Sprintf("import type %s from %q;", importClause(m.imports[from]), from))
	}
	if len(imports) > 0 {
		statements = append(statements, strings.Join(imports, "\n"))
	}
	for _, msg := range m.messages {
		statements = append(statements, msg.declaration(full))
	}
	for _, e := range m.enums {
		statements = append(statements, e.declaration(full))
	}
	for _, svc := range m.services {
		statements = append(statements, serviceConst(svc, kaja))
	}
	if len(statements) == 0 {
		return ""
	}
	return strings.Join(statements, "\n\n") + "\n"
}

func serviceConst(svc *service, kaja map[string]string) string {
	var b strings.Builder
	writeDoc(&b, "", full, svc.doc, svc.deprecated, nil)
	fmt.Fprintf(&b, "export declare const %s: {\n", svc.name)
	for _, meth := range svc.methods {
		if meth.clientStreaming {
			continue
		}
		writeDoc(&b, "    ", full, meth.doc, meth.deprecated, nil)
		fmt.Fprintf(&b, "    %s(input: %s<%s>, options?: %s): %s<%s>;\n", meth.name, kaja["Input"], meth.input, kaja["CallOptions"], kaja["Call"], meth.output)
	}
	b.WriteString("};")
	return b.String()
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

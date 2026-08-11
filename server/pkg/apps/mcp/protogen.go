package mcp

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// binding records what one generated method does on the wire: the MCP method it
// sends, and - for a tool or a prompt - the name it names.
type binding struct {
	// kind decides how the request message becomes params and how the result is
	// read back: "tool" (the message is the tool's arguments), "prompt" (the
	// message is the prompt's arguments, all strings) or "passthrough" (the
	// message is the params, and the result is the response).
	kind   string
	method string
	name   string
}

// generated is the output of converting a server's surface: the proto file text,
// the package-qualified names of the services in it, and the binding for each
// generated method, keyed by its gRPC method path.
type generated struct {
	proto            string
	serviceTypeNames []string
	bindings         map[string]*binding
	toolCount        int
}

const protoPackage = "mcp"

type fieldDef struct {
	typ      string
	name     string
	number   int
	jsonName string
	repeated bool
	// mapKey renders the field as map<mapKey, typ>. Only ever "string".
	mapKey string
	doc    string
}

type messageDef struct {
	name   string
	doc    string
	fields []fieldDef
}

type rpcDef struct {
	name   string
	input  string
	output string
	doc    string
}

type serviceDef struct {
	name string
	doc  string
	rpcs []*rpcDef
}

type generator struct {
	messages  []*messageDef
	usedNames map[string]bool
	// refNames maps a resolved $ref pointer to the message already allocated for
	// it, which is also what keeps a self-referential schema from recursing.
	refNames  map[string]string
	usesValue bool

	services []*serviceDef
	bindings map[string]*binding
}

// generateProto converts a server's surface into the proto file kaja compiles
// and renders: one method per tool, one per prompt, and the fixed resource
// methods, each under the service for its kind. Only the kinds the server
// actually exposes are emitted - an empty service is a row in the tree that
// leads nowhere.
func generateProto(surface *Surface) (*generated, error) {
	g := &generator{
		usedNames: map[string]bool{},
		refNames:  map[string]string{},
		bindings:  map[string]*binding{},
	}
	// The shapes every server shares are written out verbatim, so their names are
	// spoken for before anything the server named can claim them.
	for _, name := range []string{"Content", "ResourceContents"} {
		g.usedNames[name] = true
	}

	if len(surface.Tools) > 0 {
		g.addTools(surface.Tools)
	}
	if len(surface.Resources) > 0 || len(surface.ResourceTemplates) > 0 || surface.Capabilities.Resources != nil {
		g.addResources()
	}
	if len(surface.Prompts) > 0 {
		g.addPrompts(surface.Prompts)
	}

	if len(g.services) == 0 {
		return nil, fmt.Errorf("the server exposes no tools, resources or prompts")
	}

	serviceTypeNames := make([]string, 0, len(g.services))
	for _, service := range g.services {
		serviceTypeNames = append(serviceTypeNames, protoPackage+"."+service.name)
	}

	return &generated{
		proto:            g.render(surface),
		serviceTypeNames: serviceTypeNames,
		bindings:         g.bindings,
		toolCount:        len(surface.Tools),
	}, nil
}

// ---------------------------------------------------------------- tools

func (g *generator) addTools(tools []Tool) {
	service := g.service("Tools", "The tools the server exposes. Each method is one tool: its request is the\ntool's arguments and its response the result the tool returned.")

	for _, tool := range tools {
		method := g.reserve(protoIdentifier(tool.Name, "Tool"))
		requestName := g.message(method+"Request", "", nil)
		g.fillFromSchema(requestName, tool.InputSchema)

		response := &messageDef{name: g.reserve(method + "Response")}
		response.fields = append(response.fields,
			fieldDef{typ: "Content", name: "content", number: 1, jsonName: "content", repeated: true,
				doc: "What the tool returned, as the blocks it chose to return it in."},
			fieldDef{typ: "bool", name: "is_error", number: 2, jsonName: "isError",
				doc: "The tool itself failed. The reason is in content; the call did not."})
		typ, repeated := g.structuredType(method, tool.OutputSchema)
		response.fields = append(response.fields, fieldDef{
			typ: typ, name: "structured_content", number: 3, jsonName: "structuredContent", repeated: repeated,
			doc: "The result as data, for a tool that declares an output schema.",
		})
		g.messages = append(g.messages, response)

		service.rpcs = append(service.rpcs, &rpcDef{
			name: method, input: requestName, output: response.name, doc: toolDoc(tool),
		})
		g.bindings[protoPackage+"."+service.name+"/"+method] = &binding{kind: "tool", method: "tools/call", name: tool.Name}
	}
}

// structuredType is the shape a tool's structuredContent takes. An output schema
// describing an object becomes a message of its own, an array of objects a
// repeated one, and anything else - or no schema at all - the JSON value it is.
func (g *generator) structuredType(method string, raw json.RawMessage) (string, bool) {
	root := parseSchema(raw)
	if root == nil {
		g.usesValue = true
		return "google.protobuf.Value", false
	}
	w := &walker{g: g, root: root}
	resolved := w.resolve(root)
	if resolved != nil && resolved.Type == "array" && resolved.Items != nil {
		typ, repeated, mapKey := w.typeOf(resolved.Items, method+"Result")
		if repeated || mapKey != "" {
			g.usesValue = true
			return "google.protobuf.Value", true
		}
		return typ, true
	}
	typ, repeated, mapKey := w.typeOf(root, method+"Result")
	if mapKey != "" {
		// A map can't sit under a repeated field and reads no better than the
		// value it wraps.
		g.usesValue = true
		return "google.protobuf.Value", false
	}
	return typ, repeated
}

func toolDoc(tool Tool) string {
	parts := []string{}
	if title := strings.TrimSpace(tool.Title); title != "" && title != tool.Name {
		parts = append(parts, title)
	}
	if description := strings.TrimSpace(tool.Description); description != "" {
		parts = append(parts, description)
	}
	if hint := annotationHint(tool.Annotations); hint != "" {
		parts = append(parts, hint)
	}
	parts = append(parts, "MCP tool: "+tool.Name)
	return strings.Join(parts, "\n\n")
}

// annotationHint renders the server's own hints about a tool. They are the
// server's word and nothing more, so they are shown as a note rather than acted
// on.
func annotationHint(annotations *ToolAnnotation) string {
	if annotations == nil {
		return ""
	}
	hints := []string{}
	if annotations.ReadOnlyHint != nil && *annotations.ReadOnlyHint {
		hints = append(hints, "read-only")
	}
	if annotations.DestructiveHint != nil && *annotations.DestructiveHint {
		hints = append(hints, "destructive")
	}
	if annotations.IdempotentHint != nil && *annotations.IdempotentHint {
		hints = append(hints, "idempotent")
	}
	if annotations.OpenWorldHint != nil && *annotations.OpenWorldHint {
		hints = append(hints, "open-world")
	}
	if len(hints) == 0 {
		return ""
	}
	return "The server describes this tool as " + strings.Join(hints, ", ") + "."
}

// ---------------------------------------------------------------- resources

func (g *generator) addResources() {
	g.messages = append(g.messages,
		&messageDef{name: g.reserve("ResourceInfo"), doc: "One resource the server lists.", fields: []fieldDef{
			{typ: "string", name: "uri", number: 1, jsonName: "uri"},
			{typ: "string", name: "name", number: 2, jsonName: "name"},
			{typ: "string", name: "title", number: 3, jsonName: "title"},
			{typ: "string", name: "description", number: 4, jsonName: "description"},
			{typ: "string", name: "mime_type", number: 5, jsonName: "mimeType"},
			{typ: "int64", name: "size", number: 6, jsonName: "size", doc: "Size in bytes, when the server knows it."},
		}},
		&messageDef{name: g.reserve("ListResourcesRequest"), fields: []fieldDef{
			{typ: "string", name: "cursor", number: 1, jsonName: "cursor", doc: "Page to continue from, taken from a previous response's next_cursor."},
		}},
		&messageDef{name: g.reserve("ListResourcesResponse"), fields: []fieldDef{
			{typ: "ResourceInfo", name: "resources", number: 1, jsonName: "resources", repeated: true},
			{typ: "string", name: "next_cursor", number: 2, jsonName: "nextCursor", doc: "Set while there are more resources to list."},
		}},
		&messageDef{name: g.reserve("ReadResourceRequest"), fields: []fieldDef{
			{typ: "string", name: "uri", number: 1, jsonName: "uri", doc: "URI of the resource to read."},
		}},
		&messageDef{name: g.reserve("ReadResourceResponse"), fields: []fieldDef{
			{typ: "ResourceContents", name: "contents", number: 1, jsonName: "contents", repeated: true},
		}},
	)

	service := g.service("Resources", "The resources the server exposes: what it holds, and how to read one.")
	service.rpcs = append(service.rpcs,
		&rpcDef{name: "ListResources", input: "ListResourcesRequest", output: "ListResourcesResponse", doc: "List the resources the server holds."},
		&rpcDef{name: "ReadResource", input: "ReadResourceRequest", output: "ReadResourceResponse", doc: "Read one resource by its URI."},
	)
	g.bindings[protoPackage+".Resources/ListResources"] = &binding{kind: "passthrough", method: "resources/list"}
	g.bindings[protoPackage+".Resources/ReadResource"] = &binding{kind: "passthrough", method: "resources/read"}

	g.messages = append(g.messages,
		&messageDef{name: g.reserve("ResourceTemplateInfo"), doc: "A parameterized resource URI: fill the {placeholders} in to read one.", fields: []fieldDef{
			{typ: "string", name: "uri_template", number: 1, jsonName: "uriTemplate"},
			{typ: "string", name: "name", number: 2, jsonName: "name"},
			{typ: "string", name: "title", number: 3, jsonName: "title"},
			{typ: "string", name: "description", number: 4, jsonName: "description"},
			{typ: "string", name: "mime_type", number: 5, jsonName: "mimeType"},
		}},
		&messageDef{name: g.reserve("ListResourceTemplatesRequest"), fields: []fieldDef{
			{typ: "string", name: "cursor", number: 1, jsonName: "cursor"},
		}},
		&messageDef{name: g.reserve("ListResourceTemplatesResponse"), fields: []fieldDef{
			{typ: "ResourceTemplateInfo", name: "resource_templates", number: 1, jsonName: "resourceTemplates", repeated: true},
			{typ: "string", name: "next_cursor", number: 2, jsonName: "nextCursor"},
		}},
	)
	service.rpcs = append(service.rpcs, &rpcDef{
		name: "ListResourceTemplates", input: "ListResourceTemplatesRequest", output: "ListResourceTemplatesResponse",
		doc: "List the resource URI templates the server declares.",
	})
	g.bindings[protoPackage+".Resources/ListResourceTemplates"] = &binding{kind: "passthrough", method: "resources/templates/list"}
}

// ---------------------------------------------------------------- prompts

func (g *generator) addPrompts(prompts []Prompt) {
	g.messages = append(g.messages,
		&messageDef{name: g.reserve("PromptArgumentInfo"), fields: []fieldDef{
			{typ: "string", name: "name", number: 1, jsonName: "name"},
			{typ: "string", name: "description", number: 2, jsonName: "description"},
			{typ: "bool", name: "required", number: 3, jsonName: "required"},
		}},
		&messageDef{name: g.reserve("PromptInfo"), doc: "One prompt template the server exposes.", fields: []fieldDef{
			{typ: "string", name: "name", number: 1, jsonName: "name"},
			{typ: "string", name: "title", number: 2, jsonName: "title"},
			{typ: "string", name: "description", number: 3, jsonName: "description"},
			{typ: "PromptArgumentInfo", name: "arguments", number: 4, jsonName: "arguments", repeated: true},
		}},
		&messageDef{name: g.reserve("ListPromptsRequest"), fields: []fieldDef{
			{typ: "string", name: "cursor", number: 1, jsonName: "cursor"},
		}},
		&messageDef{name: g.reserve("ListPromptsResponse"), fields: []fieldDef{
			{typ: "PromptInfo", name: "prompts", number: 1, jsonName: "prompts", repeated: true},
			{typ: "string", name: "next_cursor", number: 2, jsonName: "nextCursor"},
		}},
		&messageDef{name: g.reserve("PromptMessage"), doc: "One message of a rendered prompt.", fields: []fieldDef{
			{typ: "string", name: "role", number: 1, jsonName: "role", doc: "user or assistant."},
			{typ: "Content", name: "content", number: 2, jsonName: "content"},
		}},
		&messageDef{name: g.reserve("GetPromptResponse"), doc: "A prompt as the server rendered it.", fields: []fieldDef{
			{typ: "string", name: "description", number: 1, jsonName: "description"},
			{typ: "PromptMessage", name: "messages", number: 2, jsonName: "messages", repeated: true},
		}},
	)

	service := g.service("Prompts", "The prompt templates the server exposes. Each method renders one prompt from\nthe arguments it declares.")
	service.rpcs = append(service.rpcs, &rpcDef{
		name: "ListPrompts", input: "ListPromptsRequest", output: "ListPromptsResponse",
		doc: "List the prompts the server exposes.",
	})
	g.bindings[protoPackage+".Prompts/ListPrompts"] = &binding{kind: "passthrough", method: "prompts/list"}

	for _, prompt := range prompts {
		method := g.reserve(protoIdentifier(prompt.Name, "Prompt"))
		request := &messageDef{name: g.reserve(method + "Request")}
		for i, argument := range prompt.Arguments {
			doc := strings.TrimSpace(argument.Description)
			if argument.Required {
				doc = strings.TrimSpace(doc + "\n\n[required]")
			}
			request.fields = append(request.fields, fieldDef{
				typ: "string", name: protoFieldName(argument.Name), number: i + 1, jsonName: argument.Name, doc: doc,
			})
		}
		g.messages = append(g.messages, request)

		doc := strings.TrimSpace(prompt.Title + "\n\n" + prompt.Description)
		service.rpcs = append(service.rpcs, &rpcDef{
			name: method, input: request.name, output: "GetPromptResponse",
			doc: strings.TrimSpace(doc + "\n\nMCP prompt: " + prompt.Name),
		})
		g.bindings[protoPackage+"."+service.name+"/"+method] = &binding{kind: "prompt", method: "prompts/get", name: prompt.Name}
	}
}

// ---------------------------------------------------------------- schema walk

// walker converts one tool schema into proto messages. It carries the root so a
// local $ref can be resolved against the $defs the root declares.
type walker struct {
	g    *generator
	root *schema
	// depth bounds the walk. A $ref cycle is broken by the name allocated for the
	// ref, but a schema that nests inline has no name to break on.
	depth int
}

const maxSchemaDepth = 12

// fillFromSchema fills an already-reserved message from a tool's inputSchema.
// The message is the tool's arguments object, so its properties are its fields.
func (g *generator) fillFromSchema(messageName string, raw json.RawMessage) {
	message := g.find(messageName)
	root := parseSchema(raw)
	if root == nil || message == nil {
		return
	}
	w := &walker{g: g, root: root}
	resolved := w.merge(w.resolve(root))
	if resolved == nil {
		return
	}
	message.fields = w.fieldsOf(resolved, messageName)
}

// fieldsOf turns a schema's properties into the fields of a message, numbered in
// the order the document declares them.
func (w *walker) fieldsOf(s *schema, owner string) []fieldDef {
	required := map[string]bool{}
	for _, name := range s.Required {
		required[name] = true
	}
	fields := make([]fieldDef, 0, len(s.Properties))
	taken := map[string]bool{}
	for _, entry := range s.Properties {
		typ, repeated, mapKey := w.typeOf(entry.Schema, owner+pascal(entry.Name))
		// Two properties can render to one field name (fooBar and foo_bar); the
		// json_name keeps them apart on the wire either way.
		name := protoFieldName(entry.Name)
		for suffix := 2; taken[name]; suffix++ {
			name = protoFieldName(entry.Name) + "_" + strconv.Itoa(suffix)
		}
		taken[name] = true
		fields = append(fields, fieldDef{
			typ:      typ,
			name:     name,
			number:   len(fields) + 1,
			jsonName: entry.Name,
			repeated: repeated,
			mapKey:   mapKey,
			doc:      fieldDoc(entry.Schema, required[entry.Name]),
		})
	}
	return fields
}

// typeOf is the proto type one schema becomes: a scalar, a generated message, a
// repeated one, a map, or google.protobuf.Value for anything JSON Schema leaves
// open. nameHint names a message that has to be generated for it.
func (w *walker) typeOf(s *schema, nameHint string) (typ string, repeated bool, mapKey string) {
	if w.depth > maxSchemaDepth {
		return w.value(), false, ""
	}
	w.depth++
	defer func() { w.depth-- }()

	resolved := w.resolve(s)
	if resolved == nil {
		return w.value(), false, ""
	}
	if ref := s.Ref; ref != "" {
		if name, ok := w.g.refNames[ref]; ok {
			return name, false, ""
		}
		if isObject(w.merge(resolved)) {
			name := w.g.reserve(protoIdentifier(refName(ref), "Type"))
			w.g.refNames[ref] = name
			message := &messageDef{name: name, doc: strings.TrimSpace(resolved.Description)}
			w.g.messages = append(w.g.messages, message)
			message.fields = w.fieldsOf(w.merge(resolved), name)
			return name, false, ""
		}
	}
	merged := w.merge(resolved)

	switch merged.Type {
	case "string":
		return "string", false, ""
	case "integer":
		switch merged.Format {
		case "int64", "uint64", "uint32":
			return "int64", false, ""
		}
		return "int32", false, ""
	case "number":
		return "double", false, ""
	case "boolean":
		return "bool", false, ""
	case "array":
		if merged.Items == nil {
			return w.value(), true, ""
		}
		itemType, itemRepeated, itemMap := w.typeOf(merged.Items, nameHint+"Item")
		if itemRepeated || itemMap != "" {
			// proto has no repeated-of-repeated and no repeated map.
			return w.value(), true, ""
		}
		return itemType, true, ""
	}

	if isObject(merged) {
		if len(merged.Properties) > 0 {
			name := w.g.reserve(nameHint)
			message := &messageDef{name: name, doc: strings.TrimSpace(merged.Description)}
			w.g.messages = append(w.g.messages, message)
			message.fields = w.fieldsOf(merged, name)
			return name, false, ""
		}
		if additional := merged.AdditionalProperties; additional != nil && additional.Schema != nil {
			valueType, valueRepeated, valueMap := w.typeOf(additional.Schema, nameHint+"Value")
			if valueRepeated || valueMap != "" {
				return w.value(), false, ""
			}
			return valueType, false, "string"
		}
	}
	return w.value(), false, ""
}

func (w *walker) value() string {
	w.g.usesValue = true
	return "google.protobuf.Value"
}

// resolve follows a local $ref to the schema it names. A $ref kaja can't resolve
// locally - a network URI, an unknown pointer - resolves to nothing, and the
// field it was on becomes a JSON value.
func (w *walker) resolve(s *schema) *schema {
	seen := 0
	for s != nil && s.Ref != "" && seen < 8 {
		seen++
		target := lookupRef(w.root, s.Ref)
		if target == nil {
			return nil
		}
		s = target
	}
	return s
}

// merge folds an allOf - and a union whose variants are all objects - into one
// object schema, which is the only shape a proto message has. A union of mixed
// shapes has no such shape and is left as it is, so it becomes a JSON value.
func (w *walker) merge(s *schema) *schema {
	if s == nil || w.depth > maxSchemaDepth {
		return s
	}
	w.depth++
	defer func() { w.depth-- }()
	parts := append([]*schema{}, s.AllOf...)
	union := s.OneOf
	if len(union) == 0 {
		union = s.AnyOf
	}
	if len(union) > 0 && allObjects(w, union) {
		parts = append(parts, union...)
	}
	if len(parts) == 0 {
		return s
	}

	merged := &schema{Type: "object", Description: s.Description, Title: s.Title, Required: append([]string{}, s.Required...)}
	merged.Properties = append(orderedProperties{}, s.Properties...)
	add := func(part *schema) {
		part = w.merge(w.resolve(part))
		if part == nil {
			return
		}
		for _, entry := range part.Properties {
			if merged.Properties.get(entry.Name) == nil {
				merged.Properties = append(merged.Properties, entry)
			}
		}
		merged.Required = append(merged.Required, part.Required...)
	}
	for _, part := range parts {
		add(part)
	}
	return merged
}

func allObjects(w *walker, variants []*schema) bool {
	for _, variant := range variants {
		resolved := w.resolve(variant)
		if resolved == nil || !isObject(resolved) {
			return false
		}
	}
	return len(variants) > 0
}

func isObject(s *schema) bool {
	if s == nil {
		return false
	}
	return s.Type == "object" || len(s.Properties) > 0
}

func lookupRef(root *schema, ref string) *schema {
	if root == nil || !strings.HasPrefix(ref, "#/") {
		return nil
	}
	segments := strings.Split(strings.TrimPrefix(ref, "#/"), "/")
	if len(segments) != 2 {
		return nil
	}
	switch segments[0] {
	case "$defs":
		return root.Defs[unescapePointer(segments[1])]
	case "definitions":
		return root.Definitions[unescapePointer(segments[1])]
	}
	return nil
}

func unescapePointer(segment string) string {
	return strings.ReplaceAll(strings.ReplaceAll(segment, "~1", "/"), "~0", "~")
}

func refName(ref string) string {
	if index := strings.LastIndex(ref, "/"); index >= 0 {
		return unescapePointer(ref[index+1:])
	}
	return ref
}

func parseSchema(raw json.RawMessage) *schema {
	if len(raw) == 0 {
		return nil
	}
	parsed := &schema{}
	if json.Unmarshal(raw, parsed) != nil {
		return nil
	}
	return parsed
}

// fieldDoc is what a field says about itself: the schema's own description, the
// values it allows, and whether the server insists on it. proto3 has no
// `required`, so saying so in the comment is the only way a caller learns it.
func fieldDoc(s *schema, required bool) string {
	parts := []string{}
	if description := strings.TrimSpace(s.Description); description != "" {
		parts = append(parts, description)
	} else if title := strings.TrimSpace(s.Title); title != "" {
		parts = append(parts, title)
	}
	if values := enumValues(s); values != "" {
		parts = append(parts, "One of: "+values)
	}
	if required {
		parts = append(parts, "[required]")
	}
	return strings.Join(parts, "\n\n")
}

func enumValues(s *schema) string {
	source := s.Enum
	if len(source) == 0 && s.Items != nil {
		source = s.Items.Enum
	}
	if len(source) == 0 || len(source) > 24 {
		return ""
	}
	values := make([]string, 0, len(source))
	for _, entry := range source {
		values = append(values, strings.TrimSpace(string(entry)))
	}
	return strings.Join(values, ", ")
}

// ---------------------------------------------------------------- naming

func (g *generator) service(name, doc string) *serviceDef {
	service := &serviceDef{name: g.reserve(name), doc: doc}
	g.services = append(g.services, service)
	return service
}

func (g *generator) message(name, doc string, fields []fieldDef) string {
	message := &messageDef{name: g.reserve(name), doc: doc, fields: fields}
	g.messages = append(g.messages, message)
	return message.name
}

func (g *generator) find(name string) *messageDef {
	for _, message := range g.messages {
		if message.name == name {
			return message
		}
	}
	return nil
}

// reserve claims a name. Messages and services genuinely share one namespace;
// method names are claimed out of the same pool though proto scopes them to
// their service, so that a method is unique across the whole app and a call can
// be routed by its name alone.
func (g *generator) reserve(name string) string {
	unique := g.uniqueName(name)
	g.usedNames[unique] = true
	return unique
}

func (g *generator) uniqueName(name string) string {
	if !g.usedNames[name] {
		return name
	}
	for i := 2; ; i++ {
		candidate := name + strconv.Itoa(i)
		if !g.usedNames[candidate] {
			return candidate
		}
	}
}

// protoIdentifier turns a name the server chose - a tool called `get_weather`,
// `search.web` or `Créer` - into a PascalCase proto identifier. A name with
// nothing usable in it falls back to the given noun so the surface still
// compiles.
func protoIdentifier(name, fallback string) string {
	identifier := pascal(name)
	if identifier == "" {
		return fallback
	}
	if r := rune(identifier[0]); r >= '0' && r <= '9' {
		return fallback + identifier
	}
	return identifier
}

// pascal splits a name on anything that isn't a letter or a digit, and on the
// case boundaries inside each word, then joins the parts capitalized.
func pascal(name string) string {
	var out strings.Builder
	for _, word := range splitWords(name) {
		runes := []rune(word)
		out.WriteRune(unicode.ToUpper(runes[0]))
		out.WriteString(string(runes[1:]))
	}
	return out.String()
}

// protoFieldName is the snake_case field name for a JSON property. The property
// travels under its own name regardless, through the field's json_name.
func protoFieldName(name string) string {
	words := splitWords(name)
	if len(words) == 0 {
		return "value"
	}
	lowered := make([]string, 0, len(words))
	for _, word := range words {
		lowered = append(lowered, strings.ToLower(word))
	}
	joined := strings.Join(lowered, "_")
	if r := rune(joined[0]); r >= '0' && r <= '9' {
		return "f_" + joined
	}
	return joined
}

func splitWords(name string) []string {
	var words []string
	var current []rune
	flush := func() {
		if len(current) > 0 {
			words = append(words, string(current))
			current = nil
		}
	}
	runes := []rune(name)
	upper := func(i int) bool { return i >= 0 && i < len(runes) && runes[i] >= 'A' && runes[i] <= 'Z' }
	lower := func(i int) bool { return i >= 0 && i < len(runes) && runes[i] >= 'a' && runes[i] <= 'z' }
	for i, r := range runes {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			current = append(current, r)
		case r >= 'A' && r <= 'Z':
			// A capital starts a word, except inside a run of them - and the last
			// capital of a run belongs to the word that follows it, which is what
			// splits "HTTPUrl" into HTTP and Url.
			if !upper(i-1) || lower(i+1) {
				flush()
			}
			current = append(current, r)
		default:
			flush()
		}
	}
	flush()
	return words
}

// ---------------------------------------------------------------- rendering

func (g *generator) render(surface *Surface) string {
	var out strings.Builder
	out.WriteString("syntax = \"proto3\";\n\npackage " + protoPackage + ";\n")
	if g.usesValue {
		out.WriteString("\nimport \"google/protobuf/struct.proto\";\n")
	}
	out.WriteString("\n")
	writeComment(&out, surfaceDoc(surface), "")
	out.WriteString(staticMessages)

	for _, message := range g.messages {
		out.WriteString("\n")
		writeComment(&out, message.doc, "")
		out.WriteString("message " + message.name + " {\n")
		for _, field := range message.fields {
			writeComment(&out, field.doc, "  ")
			out.WriteString("  " + fieldTypeText(field) + " " + field.name + " = " + strconv.Itoa(field.number) +
				" [json_name = " + strconv.Quote(field.jsonName) + "];\n")
		}
		out.WriteString("}\n")
	}

	for _, service := range g.services {
		out.WriteString("\n")
		writeComment(&out, service.doc, "")
		out.WriteString("service " + service.name + " {\n")
		for i, rpc := range service.rpcs {
			if i > 0 {
				out.WriteString("\n")
			}
			writeComment(&out, rpc.doc, "  ")
			out.WriteString("  rpc " + rpc.name + "(" + rpc.input + ") returns (" + rpc.output + ");\n")
		}
		out.WriteString("}\n")
	}
	return out.String()
}

func fieldTypeText(field fieldDef) string {
	switch {
	case field.mapKey != "":
		return "map<" + field.mapKey + ", " + field.typ + ">"
	case field.repeated:
		return "repeated " + field.typ
	}
	return field.typ
}

func surfaceDoc(surface *Surface) string {
	name := surface.ServerInfo.Name
	if name == "" {
		name = "an MCP server"
	}
	line := "Generated from " + name
	if surface.ServerInfo.Version != "" {
		line += " " + surface.ServerInfo.Version
	}
	if surface.ProtocolVersion != "" {
		line += ", over MCP " + surface.ProtocolVersion
	}
	line += "."
	if instructions := strings.TrimSpace(surface.Instructions); instructions != "" {
		line += "\n\n" + instructions
	}
	return line
}

// writeComment renders a doc block as proto line comments. Blank lines are kept,
// so a description that has paragraphs still has them in the editor.
func writeComment(out *strings.Builder, doc string, indent string) {
	doc = strings.TrimSpace(doc)
	if doc == "" {
		return
	}
	for _, line := range strings.Split(doc, "\n") {
		line = strings.TrimRight(line, " \t\r")
		if line == "" {
			out.WriteString(indent + "//\n")
			continue
		}
		out.WriteString(indent + "// " + line + "\n")
	}
}

// staticMessages are the shapes every MCP server shares, which no schema
// describes: the content blocks a tool result and a prompt message are made of.
const staticMessages = `
// One block of a tool result or a prompt message. Which fields are set follows
// from type.
message Content {
  // text, image, audio, resource_link or resource.
  string type = 1 [json_name = "type"];
  // The text, for a text block.
  string text = 2 [json_name = "text"];
  // Base64-encoded bytes, for an image or audio block.
  string data = 3 [json_name = "data"];
  string mime_type = 4 [json_name = "mimeType"];
  // The resource pointed at, for a resource_link block.
  string uri = 5 [json_name = "uri"];
  string name = 6 [json_name = "name"];
  string description = 7 [json_name = "description"];
  // The resource itself, for a resource block.
  ResourceContents resource = 8 [json_name = "resource"];
}

// The contents of one resource: text or bytes, never both.
message ResourceContents {
  string uri = 1 [json_name = "uri"];
  string mime_type = 2 [json_name = "mimeType"];
  string text = 3 [json_name = "text"];
  // Base64-encoded, when the resource is binary.
  string blob = 4 [json_name = "blob"];
}
`

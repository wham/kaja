package openapi

import (
	"fmt"
	"reflect"
	"sort"
	"strings"
	"unicode"
)

// methodBinding records how a generated proto method maps onto an HTTP request,
// and how the HTTP response is shaped back into the method's proto response.
type methodBinding struct {
	verb            string       // GET, POST, ...
	pathTemplate    string       // e.g. "/pets/{petId}"
	pathParams      []string     // OpenAPI parameter names located in the path
	queryParams     []queryParam // OpenAPI parameters located in the query string
	bodyKey         string       // request-JSON key carrying the HTTP body, or "" if none
	bodyContentType string       // Content-Type header to send with the body
	responseWrap    string       // object | array | scalar | text | empty
}

// queryParam is one query-string parameter together with its serialization
// style: "" (form, exploded — repeated values), "csv" (form, explode false —
// comma-joined), or "deepObject" (name[key]=value pairs).
type queryParam struct {
	name  string
	style string
}

func queryStyle(p *parameter) string {
	if p.Style == "deepObject" {
		return "deepObject"
	}
	if p.Explode != nil && !*p.Explode {
		return "csv"
	}
	return ""
}

// generated is the output of converting a spec: the proto file text, the
// package-qualified type names of every generated service, and the per-method
// HTTP bindings keyed by the gRPC method path "<serviceTypeName>/<MethodName>".
type generated struct {
	proto            string
	serviceTypeNames []string
	bindings         map[string]*methodBinding
}

type fieldDef struct {
	typ      string
	name     string
	number   int
	jsonName string
	repeated bool
	doc      []string
}

type messageDef struct {
	name   string
	fields []fieldDef
	doc    []string
}

type rpcDef struct {
	name   string
	input  string
	output string
	doc    []string
}

// docLines turns a spec description into sanitized proto comment lines: CRLF is
// normalized, trailing whitespace stripped, and an all-blank description drops
// to nothing. Each line is later emitted as a "// ..." comment, so the origin of
// a generated type is visible in "Go to Definition".
func docLines(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	text = strings.TrimRight(text, " \t\n")
	if strings.TrimSpace(text) == "" {
		return nil
	}
	lines := strings.Split(text, "\n")
	for i := range lines {
		lines[i] = strings.TrimRight(lines[i], " \t")
	}
	return lines
}

// serviceDef is a single generated proto service. Operations are grouped into
// services by their first OpenAPI tag (untagged operations fall into a default
// service named after the spec title), so the catalog mirrors how the upstream
// API documents its resources instead of one crowded flat service.
type serviceDef struct {
	name string
	rpcs []*rpcDef
}

type generator struct {
	spec               *spec
	pkg                string
	defaultServiceName string

	messages     []*messageDef
	seenMsg      map[string]bool
	refMsgName   map[string]string // component schema name -> allocated proto message name
	resolvingRef map[string]bool

	services     []*serviceDef
	serviceIndex map[string]*serviceDef
	seenRPC      map[string]bool

	bindingByMethod map[string]*methodBinding
}

// generateProto converts an OpenAPI spec into a single proto file plus bindings.
func generateProto(s *spec) (*generated, error) {
	title := s.Info.Title
	if strings.TrimSpace(title) == "" {
		title = "Api"
	}
	g := &generator{
		spec:               s,
		pkg:                "openapi." + lowerSnake(title),
		defaultServiceName: ensureName(pascal(title), "Api"),
		seenMsg:            map[string]bool{},
		refMsgName:         map[string]string{},
		resolvingRef:       map[string]bool{},
		seenRPC:            map[string]bool{},
		serviceIndex:       map[string]*serviceDef{},
		bindingByMethod:    map[string]*methodBinding{},
	}

	paths := make([]string, 0, len(s.Paths))
	for p := range s.Paths {
		paths = append(paths, p)
	}
	sort.Strings(paths)

	for _, p := range paths {
		item := s.Paths[p]
		for _, vo := range item.operations() {
			g.addOperation(p, item, vo)
		}
	}

	if len(g.services) == 0 {
		return nil, fmt.Errorf("spec has no operations to expose")
	}

	g.resolveServiceNameCollisions()

	// Key bindings by full gRPC method path now that service names are settled.
	bindings := map[string]*methodBinding{}
	serviceTypeNames := make([]string, 0, len(g.services))
	for _, svc := range g.services {
		serviceTypeName := g.pkg + "." + svc.name
		serviceTypeNames = append(serviceTypeNames, serviceTypeName)
		for _, r := range svc.rpcs {
			bindings[serviceTypeName+"/"+r.name] = g.bindingByMethod[r.name]
		}
	}

	return &generated{
		proto:            g.render(),
		serviceTypeNames: serviceTypeNames,
		bindings:         bindings,
	}, nil
}

// serviceFor returns the service an operation belongs to, creating it on first
// use. Grouping is by the operation's first tag; untagged operations land in the
// default (title-named) service.
func (g *generator) serviceFor(op *operation) *serviceDef {
	name := g.defaultServiceName
	if len(op.Tags) > 0 {
		if n := pascal(op.Tags[0]); n != "" {
			name = n
		}
	}
	if svc, ok := g.serviceIndex[name]; ok {
		return svc
	}
	svc := &serviceDef{name: name}
	g.serviceIndex[name] = svc
	g.services = append(g.services, svc)
	return svc
}

// resolveServiceNameCollisions renames any service whose name clashes with a
// generated message, since proto services and messages share one namespace.
func (g *generator) resolveServiceNameCollisions() {
	for _, svc := range g.services {
		if !g.seenMsg[svc.name] {
			continue
		}
		base := svc.name + "Service"
		candidate := base
		for i := 2; g.seenMsg[candidate] || g.serviceIndex[candidate] != nil; i++ {
			candidate = fmt.Sprintf("%s%d", base, i)
		}
		delete(g.serviceIndex, svc.name)
		g.serviceIndex[candidate] = svc
		svc.name = candidate
	}
}

func (g *generator) addOperation(path string, item *pathItem, vo verbOp) {
	op := vo.op

	methodName := g.uniqueRPCName(operationName(vo.verb, path, op))
	reqName := g.uniqueMessageName(methodName + "Request")

	binding := &methodBinding{verb: vo.verb, pathTemplate: path}

	// Request message: path + query params, then an optional body field. Added
	// up front so a component schema sharing its name (e.g. a body schema also
	// called "<Method>Request") is renamed instead of swallowing the request.
	req := &messageDef{name: reqName}
	g.addMessage(req)
	num := 1
	for _, param := range g.mergedParameters(item, op) {
		switch param.In {
		case "path":
			req.fields = append(req.fields, g.paramField(param, num))
			binding.pathParams = append(binding.pathParams, param.Name)
			num++
		case "query":
			req.fields = append(req.fields, g.paramField(param, num))
			binding.queryParams = append(binding.queryParams, queryParam{name: param.Name, style: queryStyle(param)})
			num++
		}
	}
	if op.RequestBody != nil {
		if ct, mt, ok := jsonContent(op.RequestBody.Content); ok && mt.Schema != nil {
			typ, repeated := g.protoType(reqName, "Body", mt.Schema)
			req.fields = append(req.fields, fieldDef{typ: typ, name: "body", number: num, jsonName: "body", repeated: repeated})
			binding.bodyKey = "body"
			binding.bodyContentType = ct
			num++
		}
	}

	// Response type + wrap kind.
	output, wrap := g.responseType(methodName, op)
	binding.responseWrap = wrap

	doc := []string{vo.verb + " " + path}
	doc = append(doc, docLines(op.Summary)...)
	doc = append(doc, docLines(op.Description)...)

	svc := g.serviceFor(op)
	svc.rpcs = append(svc.rpcs, &rpcDef{name: methodName, input: reqName, output: output, doc: doc})
	g.bindingByMethod[methodName] = binding
}

// responseType resolves a method's output message name and how the HTTP response
// JSON should be wrapped to match it. The schema is mapped through protoType so
// refs, unions, and allOf compositions resolve to their effective JSON shape
// (a $ref can point at an array or scalar, not just an object).
func (g *generator) responseType(methodName string, op *operation) (string, string) {
	resp := successResponse(op)
	var mt mediaType
	ok := false
	if resp != nil {
		_, mt, ok = jsonContent(resp.Content)
	}
	if !ok || mt.Schema == nil {
		respName := g.uniqueMessageName(methodName + "Response")
		if resp != nil && !ok && textContent(resp.Content) {
			g.addMessage(&messageDef{name: respName, fields: []fieldDef{
				{typ: "string", name: "value", number: 1, jsonName: "value"},
			}})
			return respName, "text"
		}
		g.addMessage(&messageDef{name: respName})
		return respName, "empty"
	}

	typ, repeated := g.protoType(methodName, "Response", mt.Schema)
	switch {
	case repeated:
		respName := g.uniqueMessageName(methodName + "Response")
		g.addMessage(&messageDef{name: respName, fields: []fieldDef{
			{typ: typ, name: "items", number: 1, jsonName: "items", repeated: true},
		}})
		return respName, "array"
	case g.seenMsg[typ]:
		return typ, "object"
	default:
		respName := g.uniqueMessageName(methodName + "Response")
		g.addMessage(&messageDef{name: respName, fields: []fieldDef{
			{typ: typ, name: "value", number: 1, jsonName: "value"},
		}})
		return respName, "scalar"
	}
}

func (g *generator) paramField(param *parameter, number int) fieldDef {
	s := param.Schema
	if s == nil {
		// A parameter can declare a media type instead of a schema (a JSON value
		// serialized into the query string); use its schema for the field type.
		if _, mt, ok := jsonContent(param.Content); ok {
			s = mt.Schema
		}
	}
	typ, repeated := g.protoType("Param", pascal(param.Name), s)
	desc := param.Description
	if desc == "" && s != nil {
		desc = s.Description
	}
	return fieldDef{typ: typ, name: ensureName(lowerSnake(param.Name), fmt.Sprintf("field%d", number)), number: number, jsonName: param.Name, repeated: repeated, doc: docLines(desc)}
}

// refMessage ensures a message exists for a "#/components/schemas/X" reference
// and returns its proto name. Names are tracked per component so a schema whose
// name clashes with an already-generated message (e.g. an operation's
// "<Method>Request" wrapper) gets a distinct name instead of silently reusing
// the other message.
func (g *generator) refMessage(ref string) string {
	if name, ok := g.refMsgName[refName(ref)]; ok {
		return name
	}
	name := g.uniqueMessageName(pascal(refName(ref)))
	// Reserve the name before recursing to break self-referential cycles.
	g.refMsgName[refName(ref)] = name
	g.seenMsg[name] = true
	placeholder := &messageDef{name: name, doc: []string{"from #/components/schemas/" + refName(ref)}}
	g.messages = append(g.messages, placeholder)

	if s := g.lookupRef(ref); s != nil {
		placeholder.fields = g.fieldsFromSchema(name, s)
		placeholder.doc = append(placeholder.doc, docLines(s.Description)...)
	}
	return name
}

func (g *generator) lookupRef(ref string) *schema {
	if g.spec.Components.Schemas == nil {
		return nil
	}
	return g.spec.Components.Schemas[refName(ref)]
}

// unionOf returns a schema's oneOf/anyOf variants, if any.
func unionOf(s *schema) []*schema {
	if len(s.OneOf) > 0 {
		return s.OneOf
	}
	return s.AnyOf
}

// objectLike reports whether a schema's JSON shape is an object, following
// refs, allOf composition, and nested unions.
func (g *generator) objectLike(s *schema, depth int) bool {
	if s == nil || depth > 16 {
		return false
	}
	if s.Ref != "" {
		return g.objectLike(g.lookupRef(s.Ref), depth+1)
	}
	if len(s.Properties) > 0 || s.Type == "object" {
		return true
	}
	for _, e := range s.AllOf {
		if g.objectLike(e, depth+1) {
			return true
		}
	}
	if vs := unionOf(s); len(vs) > 0 {
		for _, v := range vs {
			if !g.objectLike(v, depth+1) {
				return false
			}
		}
		return true
	}
	return false
}

func (g *generator) allObjectLike(vs []*schema) bool {
	for _, v := range vs {
		if !g.objectLike(v, 0) {
			return false
		}
	}
	return true
}

// fieldsFromSchema flattens a schema's effective object properties into proto
// fields: its own properties, those of every allOf entry, and — when every
// oneOf/anyOf variant is an object — the superset of the variants' properties,
// so any variant of a discriminated union can be expressed. When variants
// declare the same property with different schemas, the schemas are unioned.
func (g *generator) fieldsFromSchema(parent string, s *schema) []fieldDef {
	props := map[string][]*schema{}
	g.collectProperties(s, props, map[string]bool{})

	names := make([]string, 0, len(props))
	for n := range props {
		names = append(names, n)
	}
	sort.Strings(names)

	used := map[string]bool{}
	fields := make([]fieldDef, 0, len(names))
	num := 1
	for _, propName := range names {
		ps := props[propName][0]
		if len(props[propName]) > 1 {
			ps = &schema{AnyOf: props[propName]}
		}
		typ, repeated := g.protoType(parent, pascal(propName), ps)
		name := ensureName(lowerSnake(propName), fmt.Sprintf("field%d", num))
		if used[name] {
			// Two property names can map to the same snake_case identifier.
			name = fmt.Sprintf("%s%d", name, num)
		}
		used[name] = true
		fields = append(fields, fieldDef{
			typ:      typ,
			name:     name,
			number:   num,
			jsonName: propName,
			repeated: repeated,
			doc:      docLines(propertyDescription(props[propName])),
		})
		num++
	}
	return fields
}

// propertyDescription returns the first non-empty description among the schemas
// declared for a property (a property merged from several union variants can
// carry the description on any of them).
func propertyDescription(schemas []*schema) string {
	for _, s := range schemas {
		if s != nil && strings.TrimSpace(s.Description) != "" {
			return s.Description
		}
	}
	return ""
}

// collectProperties gathers the flattened property set of a schema, keeping
// every distinct schema declared for a property (declaration order: own
// properties, then allOf entries, then union variants).
func (g *generator) collectProperties(s *schema, out map[string][]*schema, visiting map[string]bool) {
	if s == nil {
		return
	}
	if s.Ref != "" {
		name := refName(s.Ref)
		if visiting[name] {
			return
		}
		visiting[name] = true
		defer delete(visiting, name)
		g.collectProperties(g.lookupRef(s.Ref), out, visiting)
		return
	}
	for n, p := range s.Properties {
		addProperty(out, n, p)
	}
	for _, e := range s.AllOf {
		g.collectProperties(e, out, visiting)
	}
	if vs := unionOf(s); len(vs) > 0 && g.allObjectLike(vs) {
		for _, v := range vs {
			g.collectProperties(v, out, visiting)
		}
	}
}

// addProperty records a schema for a property, dropping duplicates so that a
// property shared by several union variants doesn't degrade into a union of
// identical schemas.
func addProperty(out map[string][]*schema, name string, p *schema) {
	p = unwrapAllOf(p)
	for _, existing := range out[name] {
		if existing == p || (p != nil && existing != nil && p.Ref != "" && p.Ref == existing.Ref) || reflect.DeepEqual(existing, p) {
			return
		}
	}
	out[name] = append(out[name], p)
}

// unwrapAllOf strips "allOf: [X]"-only wrappers (a common way to attach
// annotations like nullable to a reference) down to the wrapped schema.
func unwrapAllOf(s *schema) *schema {
	for s != nil && s.Ref == "" && len(s.AllOf) == 1 && len(s.Properties) == 0 &&
		s.AdditionalProperties == nil && len(s.OneOf) == 0 && len(s.AnyOf) == 0 {
		s = s.AllOf[0]
	}
	return s
}

// protoType maps an OpenAPI schema to a proto type, generating nested messages
// as needed. The bool return is true when the field should be "repeated".
func (g *generator) protoType(parent, hint string, s *schema) (string, bool) {
	if s == nil {
		return "string", false
	}
	if s.Ref != "" {
		return g.refType(parent, hint, s.Ref)
	}
	if vs := unionOf(s); len(vs) > 0 {
		if g.allObjectLike(vs) {
			// All variants are objects (a discriminated union): merge their
			// properties into one message so any variant can be expressed.
			name := g.uniqueMessageName(parent + hint)
			g.addMessage(&messageDef{name: name, fields: g.fieldsFromSchema(name, s), doc: docLines(s.Description)})
			return name, false
		}
		// Variants disagree on JSON shape (e.g. a single object vs an array of
		// them); model the first variant as the happy path.
		return g.protoType(parent, hint, vs[0])
	}
	if len(s.AllOf) > 0 {
		// "allOf: [$ref]" plus sibling annotations is a common way to reference a
		// schema; delegate when the schema declares nothing structural itself.
		if len(s.AllOf) == 1 && len(s.Properties) == 0 && s.AdditionalProperties == nil {
			return g.protoType(parent, hint, s.AllOf[0])
		}
		// Composition: merge every entry's properties with the schema's own.
		name := g.uniqueMessageName(parent + hint)
		g.addMessage(&messageDef{name: name, fields: g.fieldsFromSchema(name, s), doc: docLines(s.Description)})
		return name, false
	}
	switch s.Type {
	case "array":
		elem, _ := g.protoType(parent, hint+"Item", s.Items)
		if strings.HasPrefix(elem, "map<") {
			// proto has no repeated maps; fall back to string elements.
			return "string", true
		}
		return elem, true
	case "object", "":
		if len(s.Properties) > 0 {
			name := g.uniqueMessageName(parent + hint)
			g.addMessage(&messageDef{name: name, fields: g.fieldsFromSchema(name, s), doc: docLines(s.Description)})
			return name, false
		}
		if ap := s.AdditionalProperties; ap != nil && ap.Allowed {
			value := "string"
			if ap.Schema != nil {
				value, _ = g.protoType(parent, hint+"Value", ap.Schema)
				if strings.HasPrefix(value, "map<") {
					// proto map values cannot be maps themselves.
					value = "string"
				}
			}
			return "map<string, " + value + ">", false
		}
		// Free-form object (or untyped schema): fall back to string for the
		// minimal happy path.
		return "string", false
	case "integer":
		switch s.Format {
		case "int64":
			return "int64", false
		case "uint64":
			return "uint64", false
		case "uint32":
			return "uint32", false
		default:
			return "int32", false
		}
	case "number":
		if s.Format == "float" {
			return "float", false
		}
		return "double", false
	case "boolean":
		return "bool", false
	case "string":
		return "string", false
	default:
		return "string", false
	}
}

// refType maps a "#/components/schemas/X" reference to a proto type. Schemas
// with properties (including object unions and allOf compositions) become named
// messages; string/enum, number, map, array, allOf-wrapper, and mixed-shape
// union targets are expanded in place so their fields keep the scalar, map, or
// array shape the REST JSON uses (an empty message would reject those values).
func (g *generator) refType(parent, hint, ref string) (string, bool) {
	name := refName(ref)
	target := g.lookupRef(ref)
	mixedUnion := false
	if target != nil {
		if vs := unionOf(target); len(vs) > 0 && !g.allObjectLike(vs) {
			mixedUnion = true
		}
	}
	expandable := target != nil && len(target.Properties) == 0 &&
		(target.Ref != "" || mixedUnion ||
			(len(target.AllOf) == 1 && unionOf(target) == nil) ||
			(target.AdditionalProperties != nil && target.AdditionalProperties.Allowed) ||
			(target.Type != "" && target.Type != "object"))
	if !expandable || g.resolvingRef[name] {
		return g.refMessage(ref), false
	}
	g.resolvingRef[name] = true
	defer delete(g.resolvingRef, name)
	return g.protoType(parent, hint, target)
}

func (g *generator) addMessage(m *messageDef) {
	if g.seenMsg[m.name] {
		return
	}
	g.seenMsg[m.name] = true
	g.messages = append(g.messages, m)
}

func (g *generator) uniqueMessageName(base string) string {
	name := pascal(base)
	candidate := name
	for i := 2; g.seenMsg[candidate]; i++ {
		candidate = fmt.Sprintf("%s%d", name, i)
	}
	return candidate
}

func (g *generator) uniqueRPCName(base string) string {
	name := pascal(base)
	candidate := name
	for i := 2; g.seenRPC[candidate]; i++ {
		candidate = fmt.Sprintf("%s%d", name, i)
	}
	g.seenRPC[candidate] = true
	return candidate
}

func (g *generator) render() string {
	var b strings.Builder
	b.WriteString("syntax = \"proto3\";\n\n")
	fmt.Fprintf(&b, "package %s;\n\n", g.pkg)

	for _, m := range g.messages {
		for _, line := range m.doc {
			fmt.Fprintf(&b, "// %s\n", line)
		}
		fmt.Fprintf(&b, "message %s {\n", m.name)
		for _, f := range m.fields {
			for _, line := range f.doc {
				fmt.Fprintf(&b, "  // %s\n", line)
			}
			prefix := ""
			if f.repeated {
				prefix = "repeated "
			}
			fmt.Fprintf(&b, "  %s%s %s = %d [json_name = %q];\n", prefix, f.typ, f.name, f.number, f.jsonName)
		}
		b.WriteString("}\n\n")
	}

	for i, svc := range g.services {
		if i > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "service %s {\n", svc.name)
		for _, r := range svc.rpcs {
			for _, line := range r.doc {
				fmt.Fprintf(&b, "  // %s\n", line)
			}
			fmt.Fprintf(&b, "  rpc %s(%s) returns (%s);\n", r.name, r.input, r.output)
		}
		b.WriteString("}\n")
	}
	return b.String()
}

// mergedParameters combines path-item-level and operation-level parameters,
// with operation-level taking precedence on (name, in) collisions. Parameters
// declared as "#/components/parameters/<name>" references are resolved first.
func (g *generator) mergedParameters(item *pathItem, op *operation) []*parameter {
	seen := map[string]bool{}
	var out []*parameter
	for _, p := range op.Parameters {
		if p = g.resolveParameter(p); p == nil {
			continue
		}
		key := p.In + ":" + p.Name
		seen[key] = true
		out = append(out, p)
	}
	for _, p := range item.Parameters {
		if p = g.resolveParameter(p); p == nil {
			continue
		}
		key := p.In + ":" + p.Name
		if !seen[key] {
			out = append(out, p)
		}
	}
	return out
}

func (g *generator) resolveParameter(p *parameter) *parameter {
	if p == nil || p.Ref == "" {
		return p
	}
	if resolved, ok := g.spec.Components.Parameters[refName(p.Ref)]; ok && resolved != nil && resolved.Ref == "" {
		return resolved
	}
	return nil
}

func successResponse(op *operation) *response {
	for _, code := range []string{"200", "201", "202", "204", "2XX", "default"} {
		if r, ok := op.Responses[code]; ok {
			return r
		}
	}
	// Fall back to the first 2xx.
	for code, r := range op.Responses {
		if strings.HasPrefix(code, "2") {
			return r
		}
	}
	return nil
}

func refName(ref string) string {
	i := strings.LastIndex(ref, "/")
	if i < 0 {
		return ref
	}
	return ref[i+1:]
}

// operationName derives a proto method name from operationId, or from verb+path.
func operationName(verb, path string, op *operation) string {
	if op.OperationID != "" {
		return op.OperationID
	}
	parts := []string{strings.ToLower(verb)}
	for _, seg := range strings.Split(path, "/") {
		seg = strings.Trim(seg, "{}")
		if seg != "" {
			parts = append(parts, seg)
		}
	}
	return strings.Join(parts, "_")
}

// pascal converts an arbitrary string to a PascalCase proto identifier.
func pascal(s string) string {
	var b strings.Builder
	upNext := true
	for _, r := range s {
		switch {
		case r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			if upNext {
				b.WriteRune(unicode.ToUpper(r))
				upNext = false
			} else {
				b.WriteRune(r)
			}
		default:
			upNext = true
		}
	}
	out := b.String()
	if out == "" {
		return ""
	}
	if out[0] >= '0' && out[0] <= '9' {
		out = "X" + out
	}
	return out
}

// lowerSnake converts an arbitrary string to a snake_case proto identifier.
func lowerSnake(s string) string {
	var b strings.Builder
	var prev rune
	for i, r := range s {
		switch {
		case r >= 'A' && r <= 'Z':
			if i > 0 && (prev >= 'a' && prev <= 'z' || prev >= '0' && prev <= '9') {
				b.WriteByte('_')
			}
			b.WriteRune(unicode.ToLower(r))
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			if b.Len() > 0 && b.String()[b.Len()-1] != '_' {
				b.WriteByte('_')
			}
		}
		prev = r
	}
	out := strings.Trim(b.String(), "_")
	if out == "" {
		return ""
	}
	if out[0] >= '0' && out[0] <= '9' {
		out = "_" + out
	}
	return out
}

func ensureName(name, fallback string) string {
	if name == "" {
		return fallback
	}
	return name
}

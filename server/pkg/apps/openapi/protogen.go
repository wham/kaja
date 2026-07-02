package openapi

import (
	"fmt"
	"sort"
	"strings"
	"unicode"
)

// methodBinding records how a generated proto method maps onto an HTTP request,
// and how the HTTP response is shaped back into the method's proto response.
type methodBinding struct {
	verb         string   // GET, POST, ...
	pathTemplate string   // e.g. "/pets/{petId}"
	pathParams   []string // OpenAPI parameter names located in the path
	queryParams  []string // OpenAPI parameter names located in the query string
	bodyKey      string   // request-JSON key carrying the HTTP body, or "" if none
	responseWrap string   // object | array | scalar | empty
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
}

type messageDef struct {
	name   string
	fields []fieldDef
}

type rpcDef struct {
	name    string
	input   string
	output  string
	summary string
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
	reqName := methodName + "Request"

	binding := &methodBinding{verb: vo.verb, pathTemplate: path}

	// Request message: path + query params, then an optional body field.
	req := &messageDef{name: reqName}
	num := 1
	for _, param := range g.mergedParameters(item, op) {
		switch param.In {
		case "path":
			req.fields = append(req.fields, g.paramField(param, num))
			binding.pathParams = append(binding.pathParams, param.Name)
			num++
		case "query":
			req.fields = append(req.fields, g.paramField(param, num))
			binding.queryParams = append(binding.queryParams, param.Name)
			num++
		}
	}
	if op.RequestBody != nil {
		if mt, ok := jsonContent(op.RequestBody.Content); ok && mt.Schema != nil {
			typ, repeated := g.protoType(reqName, "Body", mt.Schema)
			req.fields = append(req.fields, fieldDef{typ: typ, name: "body", number: num, jsonName: "body", repeated: repeated})
			binding.bodyKey = "body"
			num++
		}
	}
	g.addMessage(req)

	// Response type + wrap kind.
	output, wrap := g.responseType(methodName, op)
	binding.responseWrap = wrap

	svc := g.serviceFor(op)
	svc.rpcs = append(svc.rpcs, &rpcDef{name: methodName, input: reqName, output: output, summary: op.Summary})
	g.bindingByMethod[methodName] = binding
}

// responseType resolves a method's output message name and how the HTTP response
// JSON should be wrapped to match it.
func (g *generator) responseType(methodName string, op *operation) (string, string) {
	resp := successResponse(op)
	if resp == nil {
		g.addMessage(&messageDef{name: methodName + "Response"})
		return methodName + "Response", "empty"
	}
	mt, ok := jsonContent(resp.Content)
	if !ok || mt.Schema == nil {
		g.addMessage(&messageDef{name: methodName + "Response"})
		return methodName + "Response", "empty"
	}

	s := mt.Schema
	switch {
	case s.Ref != "":
		return g.refMessage(s.Ref), "object"
	case s.Type == "array":
		elem, _ := g.protoType(methodName+"Response", "Items", s.Items)
		g.addMessage(&messageDef{name: methodName + "Response", fields: []fieldDef{
			{typ: elem, name: "items", number: 1, jsonName: "items", repeated: true},
		}})
		return methodName + "Response", "array"
	case s.Type == "object" || len(s.Properties) > 0:
		msg := &messageDef{name: methodName + "Response", fields: g.fieldsFromProperties(methodName+"Response", s)}
		g.addMessage(msg)
		return methodName + "Response", "object"
	default:
		typ, repeated := g.protoType(methodName+"Response", "Value", s)
		g.addMessage(&messageDef{name: methodName + "Response", fields: []fieldDef{
			{typ: typ, name: "value", number: 1, jsonName: "value", repeated: repeated},
		}})
		return methodName + "Response", "scalar"
	}
}

func (g *generator) paramField(param *parameter, number int) fieldDef {
	typ, repeated := g.protoType("Param", pascal(param.Name), param.Schema)
	return fieldDef{typ: typ, name: ensureName(lowerSnake(param.Name), fmt.Sprintf("field%d", number)), number: number, jsonName: param.Name, repeated: repeated}
}

// refMessage ensures a message exists for a "#/components/schemas/X" reference
// and returns its proto name.
func (g *generator) refMessage(ref string) string {
	name := pascal(refName(ref))
	if g.seenMsg[name] {
		return name
	}
	// Reserve the name before recursing to break self-referential cycles.
	g.seenMsg[name] = true
	placeholder := &messageDef{name: name}
	g.messages = append(g.messages, placeholder)

	if g.spec.Components.Schemas != nil {
		if s, ok := g.spec.Components.Schemas[refName(ref)]; ok && s != nil {
			placeholder.fields = g.fieldsFromProperties(name, s)
		}
	}
	return name
}

func (g *generator) fieldsFromProperties(parent string, s *schema) []fieldDef {
	names := make([]string, 0, len(s.Properties))
	for n := range s.Properties {
		names = append(names, n)
	}
	sort.Strings(names)

	fields := make([]fieldDef, 0, len(names))
	num := 1
	for _, propName := range names {
		typ, repeated := g.protoType(parent, pascal(propName), s.Properties[propName])
		fields = append(fields, fieldDef{
			typ:      typ,
			name:     ensureName(lowerSnake(propName), fmt.Sprintf("field%d", num)),
			number:   num,
			jsonName: propName,
			repeated: repeated,
		})
		num++
	}
	return fields
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
	// "allOf: [$ref]" plus sibling annotations is a common way to reference a
	// schema; delegate when the schema declares nothing structural itself.
	if len(s.Properties) == 0 && s.AdditionalProperties == nil && len(s.AllOf) > 0 {
		return g.protoType(parent, hint, s.AllOf[0])
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
			g.addMessage(&messageDef{name: name, fields: g.fieldsFromProperties(name, s)})
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
		if s.Format == "int64" {
			return "int64", false
		}
		return "int32", false
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
// with properties become named messages; string/enum, number, map, array, and
// allOf targets are expanded in place so their fields keep the scalar or map
// shape the REST JSON uses (an empty message would reject those values).
func (g *generator) refType(parent, hint, ref string) (string, bool) {
	name := refName(ref)
	var target *schema
	if g.spec.Components.Schemas != nil {
		target = g.spec.Components.Schemas[name]
	}
	expandable := target != nil && len(target.Properties) == 0 &&
		(target.Ref != "" || len(target.AllOf) > 0 ||
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
		fmt.Fprintf(&b, "message %s {\n", m.name)
		for _, f := range m.fields {
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
			if r.summary != "" {
				fmt.Fprintf(&b, "  // %s\n", strings.ReplaceAll(r.summary, "\n", " "))
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

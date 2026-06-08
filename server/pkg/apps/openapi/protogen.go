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

// generated is the output of converting a spec: the proto file text, the service
// type name (package-qualified), and the per-method HTTP bindings keyed by the
// Twirp method path "<serviceTypeName>/<MethodName>".
type generated struct {
	proto           string
	serviceTypeName string
	bindings        map[string]*methodBinding
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

type generator struct {
	spec        *spec
	pkg         string
	serviceName string

	messages []*messageDef
	seenMsg  map[string]bool
	rpcs     []*rpcDef
	seenRPC  map[string]bool
	bindings map[string]*methodBinding
}

// generateProto converts an OpenAPI spec into a single proto file plus bindings.
func generateProto(s *spec) (*generated, error) {
	title := s.Info.Title
	if strings.TrimSpace(title) == "" {
		title = "Api"
	}
	g := &generator{
		spec:        s,
		pkg:         "openapi." + lowerSnake(title),
		serviceName: ensureName(pascal(title), "Api"),
		seenMsg:     map[string]bool{},
		seenRPC:     map[string]bool{},
		bindings:    map[string]*methodBinding{},
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

	if len(g.rpcs) == 0 {
		return nil, fmt.Errorf("spec has no operations to expose")
	}

	serviceTypeName := g.pkg + "." + g.serviceName
	// Re-key bindings by full Twirp method path now that the service name is known.
	bindings := map[string]*methodBinding{}
	for methodName, b := range g.bindings {
		bindings[serviceTypeName+"/"+methodName] = b
	}

	return &generated{
		proto:           g.render(),
		serviceTypeName: serviceTypeName,
		bindings:        bindings,
	}, nil
}

func (g *generator) addOperation(path string, item *pathItem, vo verbOp) {
	op := vo.op

	methodName := g.uniqueRPCName(operationName(vo.verb, path, op))
	reqName := methodName + "Request"

	binding := &methodBinding{verb: vo.verb, pathTemplate: path}

	// Request message: path + query params, then an optional body field.
	req := &messageDef{name: reqName}
	num := 1
	for _, param := range mergedParameters(item, op) {
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

	g.rpcs = append(g.rpcs, &rpcDef{name: methodName, input: reqName, output: output, summary: op.Summary})
	g.bindings[methodName] = binding
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
		return g.refMessage(s.Ref), false
	}
	switch s.Type {
	case "array":
		elem, _ := g.protoType(parent, hint+"Item", s.Items)
		return elem, true
	case "object":
		if len(s.Properties) == 0 {
			// Free-form object: fall back to string for the minimal happy path.
			return "string", false
		}
		name := g.uniqueMessageName(parent + hint)
		g.addMessage(&messageDef{name: name, fields: g.fieldsFromProperties(name, s)})
		return name, false
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
	case "string", "":
		return "string", false
	default:
		return "string", false
	}
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

	fmt.Fprintf(&b, "service %s {\n", g.serviceName)
	for _, r := range g.rpcs {
		if r.summary != "" {
			fmt.Fprintf(&b, "  // %s\n", strings.ReplaceAll(r.summary, "\n", " "))
		}
		fmt.Fprintf(&b, "  rpc %s(%s) returns (%s);\n", r.name, r.input, r.output)
	}
	b.WriteString("}\n")
	return b.String()
}

// mergedParameters combines path-item-level and operation-level parameters,
// with operation-level taking precedence on (name, in) collisions.
func mergedParameters(item *pathItem, op *operation) []*parameter {
	seen := map[string]bool{}
	var out []*parameter
	for _, p := range op.Parameters {
		if p == nil {
			continue
		}
		key := p.In + ":" + p.Name
		seen[key] = true
		out = append(out, p)
	}
	for _, p := range item.Parameters {
		if p == nil {
			continue
		}
		key := p.In + ":" + p.Name
		if !seen[key] {
			out = append(out, p)
		}
	}
	return out
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

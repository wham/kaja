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
	headerParams    []string     // OpenAPI parameter names sent as HTTP request headers
	bodyKey         string       // request-JSON key carrying the HTTP body, or "" if none
	bodyWhole       bool         // the request message is the body: no envelope field
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

// The (kaja.http_payload) values a generated envelope field carries. See
// http.proto for what the option means.
const (
	payloadBody  = "HTTP_PAYLOAD_BODY"
	payloadItems = "HTTP_PAYLOAD_ITEMS"
	payloadValue = "HTTP_PAYLOAD_VALUE"
)

type fieldDef struct {
	typ      string
	name     string
	number   int
	jsonName string
	repeated bool
	// payload marks the field as an HTTP payload envelope, carrying the
	// (kaja.http_payload) value to emit. Empty for a field the API declares.
	payload string
	// in is where the API carries the field ("path", "query", "header"), emitted
	// as (kaja.http_in). Empty for a body property.
	in string
	// required is emitted as (kaja.http_required) when the API insists on the
	// field.
	required bool
	// doc is the API's description of the field, emitted as a leading comment so
	// it survives into the generated TypeScript as JSDoc.
	doc string
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
	// httpRequest is the "<VERB> <path>" the method transcodes to, emitted as
	// (kaja.http_request).
	httpRequest string
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

	usesValue bool // a field maps to google.protobuf.Value, so struct.proto is imported
}

// anyValueType is the proto type for a schema that admits arbitrary JSON.
// google.protobuf.Value round-trips any JSON through protojson, so the upstream
// response decodes whether the value is an object, string, number, bool or array,
// where a plain "string" field would reject everything else.
const anyValueType = "google.protobuf.Value"

func (g *generator) anyValue() string {
	g.usesValue = true
	return anyValueType
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

// envelope marks a field as an HTTP payload envelope.
func (g *generator) envelope(f fieldDef, payload string) fieldDef {
	f.payload = payload
	return f
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
	binding := &methodBinding{verb: vo.verb, pathTemplate: path}

	// Parameters located somewhere other than the body. Whether there are any
	// decides the shape of the request message, so they are collected before
	// anything is generated.
	var located []*parameter
	for _, param := range g.mergedParameters(item, op) {
		switch param.In {
		case "path", "query", "header":
			located = append(located, param)
		}
	}

	var bodySchema *schema
	bodyContentType := ""
	if op.RequestBody != nil {
		if ct, mt, ok := jsonContent(op.RequestBody.Content); ok && mt.Schema != nil {
			bodySchema, bodyContentType = mt.Schema, ct
		}
	}

	input := g.requestType(methodName, located, bodySchema, bodyContentType, binding)

	// Response type + wrap kind.
	output, wrap := g.responseType(methodName, op)
	binding.responseWrap = wrap

	svc := g.serviceFor(op)
	svc.rpcs = append(svc.rpcs, &rpcDef{
		name:        methodName,
		input:       input,
		output:      output,
		summary:     op.Summary,
		httpRequest: strings.ToUpper(vo.verb) + " " + path,
	})
	g.bindingByMethod[methodName] = binding
}

// requestType resolves a method's input message and fills in the binding's
// parameter and body wiring.
//
// An operation whose only input is an object body *is* that body: a "body" field
// would be an envelope around the whole message, separating it from nothing. The
// envelope appears only where it carries its weight - beside path, query or
// header parameters, or around a body protobuf has no shape for (an array, a
// scalar, a free-form value) - and is marked as such when it does.
func (g *generator) requestType(methodName string, located []*parameter, bodySchema *schema, bodyContentType string, binding *methodBinding) string {
	bodyType, bodyRepeated := "", false
	if bodySchema != nil {
		// The hint decides the generated name of an inline body schema, so it
		// depends on whether the body ends up being the request or sitting in it.
		hint := "Request"
		if len(located) > 0 {
			hint = "RequestBody"
		}
		bodyType, bodyRepeated = g.protoType(methodName, hint, bodySchema)
	}

	if len(located) == 0 && bodySchema != nil && !bodyRepeated && g.seenMsg[bodyType] {
		binding.bodyWhole = true
		binding.bodyContentType = bodyContentType
		return bodyType
	}

	reqName := g.uniqueMessageName(methodName + "Request")
	req := &messageDef{name: reqName}
	g.addMessage(req)

	num := 1
	for _, param := range located {
		req.fields = append(req.fields, g.paramField(param, num))
		switch param.In {
		case "path":
			binding.pathParams = append(binding.pathParams, param.Name)
		case "query":
			binding.queryParams = append(binding.queryParams, queryParam{name: param.Name, style: queryStyle(param)})
		case "header":
			binding.headerParams = append(binding.headerParams, param.Name)
		}
		num++
	}
	if bodySchema != nil {
		req.fields = append(req.fields, g.envelope(fieldDef{
			typ: bodyType, name: "body", number: num, jsonName: "body", repeated: bodyRepeated,
		}, payloadBody))
		binding.bodyKey = "body"
		binding.bodyContentType = bodyContentType
	}

	return reqName
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
				g.envelope(fieldDef{typ: "string", name: "value", number: 1, jsonName: "value"}, payloadValue),
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
			g.envelope(fieldDef{typ: typ, name: "items", number: 1, jsonName: "items", repeated: true}, payloadItems),
		}})
		return respName, "array"
	case g.seenMsg[typ]:
		return typ, "object"
	default:
		respName := g.uniqueMessageName(methodName + "Response")
		g.addMessage(&messageDef{name: respName, fields: []fieldDef{
			g.envelope(fieldDef{typ: typ, name: "value", number: 1, jsonName: "value"}, payloadValue),
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
	doc := param.Description
	if doc == "" && s != nil {
		doc = s.Description
	}
	return fieldDef{
		typ:      typ,
		name:     ensureName(lowerSnake(param.Name), fmt.Sprintf("field%d", number)),
		number:   number,
		jsonName: param.Name,
		repeated: repeated,
		in:       param.In,
		// A path parameter is part of the URL, so it is required whatever the
		// document says.
		required: param.Required || param.In == "path",
		doc:      docComment(doc),
	}
}

// docComment folds an API description into a single proto comment line. Only the
// first sentence is kept: the comment travels into the generated TypeScript as JSDoc
// and from there into every listing.
func docComment(text string) string {
	text = strings.TrimSpace(strings.Join(strings.Fields(text), " "))
	if text == "" {
		return ""
	}
	if i := strings.Index(text, ". "); i > 0 {
		text = text[:i+1]
	}
	const max = 160
	if len([]rune(text)) > max {
		text = strings.TrimSpace(string([]rune(text)[:max])) + "\u2026"
	}
	return text
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
	placeholder := &messageDef{name: name}
	g.messages = append(g.messages, placeholder)

	if s := g.lookupRef(ref); s != nil {
		placeholder.fields = g.fieldsFromSchema(name, s)
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

// unionMapsToValue reports whether a mixed-shape union must be modeled as
// google.protobuf.Value: it mixes categories (so no single variant fits) and at
// least one variant is a primitive scalar (so a proto message can't hold it).
// A union of one category — all strings (string|enum), or all structured
// (object vs array of it) — is still modeled by its first variant.
func (g *generator) unionMapsToValue(vs []*schema) bool {
	categories := map[string]bool{}
	hasScalar := false
	for _, v := range vs {
		c := g.jsonCategory(v, 0)
		categories[c] = true
		if c != "complex" {
			hasScalar = true
		}
	}
	return hasScalar && len(categories) > 1
}

// jsonCategory classifies a schema's JSON shape into "string", "number",
// "boolean", or "complex" (object, array, free-form, or unknown), following
// refs and single-entry allOf wrappers.
func (g *generator) jsonCategory(s *schema, depth int) string {
	if s == nil || depth > 16 {
		return "complex"
	}
	s = unwrapAllOf(s)
	if s == nil {
		return "complex"
	}
	if s.Ref != "" {
		return g.jsonCategory(g.lookupRef(s.Ref), depth+1)
	}
	switch s.Type {
	case "string":
		return "string"
	case "number", "integer":
		return "number"
	case "boolean":
		return "boolean"
	}
	return "complex"
}

// fieldsFromSchema flattens a schema's effective object properties into proto
// fields: its own properties, those of every allOf entry, and — when every
// oneOf/anyOf variant is an object — the superset of the variants' properties,
// so any variant of a discriminated union can be expressed. When variants
// declare the same property with different schemas, the schemas are unioned.
func (g *generator) fieldsFromSchema(parent string, s *schema) []fieldDef {
	props := map[string][]*schema{}
	g.collectProperties(s, props, map[string]bool{})
	required := map[string]bool{}
	g.collectRequired(s, required, map[string]bool{})

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
			required: required[propName],
			doc:      docComment(g.description(ps)),
		})
		num++
	}
	return fields
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

// collectRequired gathers the property names a schema insists on: its own
// `required` list and those of every allOf entry. A union's variants are skipped
// on purpose - a property required in one variant and absent from another is not
// required of the merged message, and there is nowhere to say "required if".
func (g *generator) collectRequired(s *schema, out map[string]bool, visiting map[string]bool) {
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
		g.collectRequired(g.lookupRef(s.Ref), out, visiting)
		return
	}
	for _, name := range s.Required {
		out[name] = true
	}
	for _, e := range s.AllOf {
		g.collectRequired(e, out, visiting)
	}
}

// description reads a schema's description, following a $ref to the component
// that carries it.
func (g *generator) description(s *schema) string {
	if s == nil {
		return ""
	}
	if s.Description != "" {
		return s.Description
	}
	if s.Ref != "" {
		if target := g.lookupRef(s.Ref); target != nil && target != s {
			return target.Description
		}
	}
	return ""
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
			g.addMessage(&messageDef{name: name, fields: g.fieldsFromSchema(name, s)})
			return name, false
		}
		if g.unionMapsToValue(vs) {
			// Variants mix categories including a primitive (e.g. string|bool or
			// string|object): no single proto type accepts them all, so any JSON
			// value is decoded through Value.
			return g.anyValue(), false
		}
		// Variants are all structured but disagree on shape (e.g. a single object
		// vs an array of them); model the first variant as the happy path.
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
		g.addMessage(&messageDef{name: name, fields: g.fieldsFromSchema(name, s)})
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
			g.addMessage(&messageDef{name: name, fields: g.fieldsFromSchema(name, s)})
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
			} else {
				// additionalProperties: true — values hold any JSON.
				value = g.anyValue()
			}
			return "map<string, " + value + ">", false
		}
		// Free-form object (or untyped schema): any JSON value round-trips through
		// google.protobuf.Value instead of being forced into a string.
		return g.anyValue(), false
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
	// Every method carries (kaja.http_request), so the option file is always part
	// of the generated surface.
	b.WriteString("import \"kaja/http.proto\";\n")
	if g.usesValue {
		b.WriteString("import \"google/protobuf/struct.proto\";\n")
	}
	b.WriteString("\n")

	for _, m := range g.messages {
		fmt.Fprintf(&b, "message %s {\n", m.name)
		for _, f := range m.fields {
			if f.doc != "" {
				fmt.Fprintf(&b, "  // %s\n", f.doc)
			}
			prefix := ""
			if f.repeated {
				prefix = "repeated "
			}
			options := fmt.Sprintf("json_name = %q", f.jsonName)
			if f.payload != "" {
				options += fmt.Sprintf(", (kaja.http_payload) = %s", f.payload)
			}
			if f.in != "" {
				options += fmt.Sprintf(", (kaja.http_in) = %q", f.in)
			}
			if f.required {
				options += ", (kaja.http_required) = true"
			}
			fmt.Fprintf(&b, "  %s%s %s = %d [%s];\n", prefix, f.typ, f.name, f.number, options)
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
			fmt.Fprintf(&b, "  rpc %s(%s) returns (%s) {\n", r.name, r.input, r.output)
			fmt.Fprintf(&b, "    option (kaja.http_request) = %q;\n", r.httpRequest)
			b.WriteString("  }\n")
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

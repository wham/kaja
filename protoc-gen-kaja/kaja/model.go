package kaja

import (
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

// module is what one proto file becomes: the types and services it declares, named
// as the module says them, and the field descriptors the runtime reads them by.
type module struct {
	path     string
	file     *descriptorpb.FileDescriptorProto
	schema   *schema
	g        *generator
	comments comments
	// taken are the names the module's scope holds, its own and the ones it imports.
	taken   map[string]bool
	names   map[string]string
	imports map[string][]importName

	messages []*message
	enums    []*enum
	services []*service
}

type importName struct {
	name, alias string
}

type message struct {
	name, typeName string
	doc            string
	deprecated     bool
	members        []*member
	fields         []*field
	options        []customOption
}

// member is a property of a message's interface: a field, or a oneof standing for
// several, whose type is then one alternative per field.
type member struct {
	name     string
	optional bool
	typ      string
	refs     []string
	doc      string
	// deprecated and marks are left off an alternative, whose field says them.
	deprecated   bool
	marks        []string
	alternatives []*member
}

// field is a protobuf-ts FieldInfo.
type field struct {
	no                              int32
	name, kind, localName, jsonName string
	oneof                           string
	opt                             bool
	repeat                          int
	scalar                          int
	ref                             *typeInfo
	long                            *int
	key                             int
	value                           *mapValue
	options                         []customOption
}

type mapValue struct {
	kind   string
	scalar int
	ref    *typeInfo
	long   *int
}

type enum struct {
	name, typeName, prefix string
	doc                    string
	deprecated             bool
	values                 []*enumValue
}

type enumValue struct {
	name       string
	number     int32
	doc        string
	deprecated bool
}

type service struct {
	name, typeName string
	doc            string
	deprecated     bool
	methods        []*method
	options        []customOption
}

type method struct {
	name, localName                  string
	input, output                    string
	inputType, outputType            *typeInfo
	serverStreaming, clientStreaming bool
	idempotency                      string
	options                          []customOption
	doc                              string
	deprecated                       bool
}

// generator is what the custom options are read with.
type generator struct {
	schema   *schema
	file     *descriptorpb.FileDescriptorProto
	allFiles []*descriptorpb.FileDescriptorProto
}

func (g *generator) findMessageType(typeName string) *descriptorpb.DescriptorProto {
	if info := g.schema.lookup(typeName); info != nil {
		return info.msg
	}
	return nil
}

func (g *generator) findFileSyntaxForMessageType(typeName string) string {
	if info := g.schema.lookup(typeName); info != nil {
		return info.file.GetSyntax()
	}
	return "proto3"
}

func modulePath(protoFile string) string {
	return strings.TrimSuffix(protoFile, ".proto") + ".ts"
}

func newModule(s *schema, file *descriptorpb.FileDescriptorProto) *module {
	m := &module{
		path:     modulePath(file.GetName()),
		file:     file,
		schema:   s,
		g:        &generator{schema: s, file: file, allFiles: s.files},
		comments: fileComments(file),
		taken:    map[string]bool{},
		names:    map[string]string{},
		imports:  map[string][]importName{},
	}
	for _, info := range s.types {
		if info.file == file && !info.isMapEntry() {
			m.taken[info.name] = true
		}
	}
	for _, svc := range file.Service {
		m.taken[escapeTypescriptKeyword(svc.GetName())] = true
	}

	// Services first: which of two imported types sharing a name keeps it is settled
	// in the order protobuf-ts registered them.
	for i, svc := range file.Service {
		m.services = append(m.services, m.service(svc, []int32{6, int32(i)}))
	}
	pkg := ""
	if file.GetPackage() != "" {
		pkg = file.GetPackage() + "."
	}
	for i, msg := range file.MessageType {
		m.message(msg, pkg+msg.GetName(), []int32{4, int32(i)})
	}
	for i, e := range file.EnumType {
		m.enums = append(m.enums, m.enum(e, pkg+e.GetName(), []int32{5, int32(i)}))
	}
	return m
}

func (m *module) fileDeprecated() bool {
	return m.file.GetOptions().GetDeprecated()
}

// ref is the name a type goes by in this module, importing it on first use and
// numbering it where the name is taken already.
func (m *module) ref(typeName string) string {
	info := m.schema.lookup(typeName)
	if info == nil {
		return "unknown"
	}
	if info.file == m.file {
		return info.name
	}
	if name, ok := m.names[info.typeName]; ok {
		return name
	}
	alias := info.name
	for n := 1; m.taken[alias]; n++ {
		alias = info.name + "$"
		if n > 1 {
			alias += strconv.Itoa(n)
		}
	}
	m.taken[alias] = true
	m.names[info.typeName] = alias
	from := relativeImport(m.path, modulePath(info.file.GetName()))
	m.imports[from] = append(m.imports[from], importName{name: info.name, alias: alias})
	return alias
}

func relativeImport(from, to string) string {
	target := strings.TrimSuffix(to, ".ts")
	rel, err := filepath.Rel(filepath.FromSlash(path.Dir(from)), filepath.FromSlash(target))
	if err != nil {
		rel = target
	}
	rel = filepath.ToSlash(rel)
	if !strings.HasPrefix(rel, "../") {
		rel = "./" + rel
	}
	return rel
}

// sortedImports are the module's imports by the module they come from.
func (m *module) sortedImports() []string {
	var froms []string
	for from := range m.imports {
		froms = append(froms, from)
	}
	sort.Strings(froms)
	return froms
}

func (m *module) message(msg *descriptorpb.DescriptorProto, typeName string, msgPath []int32) {
	info := m.schema.lookup(typeName)
	out := &message{
		name:       info.name,
		typeName:   info.typeName,
		doc:        m.comments.doc(msgPath),
		deprecated: msg.GetOptions().GetDeprecated() || m.fileDeprecated(),
		options:    m.g.getCustomMessageOptions(msg.Options),
	}
	m.messages = append(m.messages, out)

	oneofs := map[int32]bool{}
	for i, f := range msg.Field {
		// A group is a nested message protobuf-ts never gave a field.
		if f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_GROUP {
			continue
		}
		fieldPath := appendPath(msgPath, 2, i)
		out.fields = append(out.fields, m.field(msg, f))
		if f.OneofIndex != nil && !f.GetProto3Optional() {
			index := f.GetOneofIndex()
			if !oneofs[index] {
				oneofs[index] = true
				out.members = append(out.members, m.oneof(msg, msgPath, index))
			}
			continue
		}
		out.members = append(out.members, m.member(f, fieldPath))
	}

	for i, nested := range msg.NestedType {
		if !nested.GetOptions().GetMapEntry() {
			m.message(nested, typeName+"."+nested.GetName(), appendPath(msgPath, 3, i))
		}
	}
	for i, e := range msg.EnumType {
		m.enums = append(m.enums, m.enum(e, typeName+"."+e.GetName(), appendPath(msgPath, 4, i)))
	}
}

func (m *module) isProto2() bool {
	syntax := m.file.GetSyntax()
	return syntax == "proto2" || syntax == ""
}

func (m *module) member(f *descriptorpb.FieldDescriptorProto, fieldPath []int32) *member {
	typ, refs := m.fieldType(f)
	optional := false
	switch {
	case f.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED:
	case f.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REQUIRED:
		optional = f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE
	case m.isProto2() && f.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL:
		optional = true
	case f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE, f.GetProto3Optional():
		optional = true
	}
	return &member{
		name:       propertyName(f),
		optional:   optional,
		typ:        typ,
		refs:       refs,
		doc:        m.comments.doc(fieldPath),
		deprecated: f.GetOptions().GetDeprecated(),
		marks:      fieldMarks(m.g.getCustomFieldOptions(f.Options)),
	}
}

func (m *module) oneof(msg *descriptorpb.DescriptorProto, msgPath []int32, index int32) *member {
	out := &member{
		name: escapeProperty(toCamelCase(msg.OneofDecl[index].GetName())),
		doc:  m.comments.doc(appendPath(msgPath, 8, int(index))),
	}
	for i, f := range msg.Field {
		if f.OneofIndex == nil || f.GetOneofIndex() != index || f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_GROUP {
			continue
		}
		alternative := m.member(f, appendPath(msgPath, 2, i))
		alternative.optional = false
		out.alternatives = append(out.alternatives, alternative)
		out.refs = append(out.refs, alternative.refs...)
	}
	return out
}

// fieldType is the TypeScript type of a field, and the names it mentions.
func (m *module) fieldType(f *descriptorpb.FieldDescriptorProto) (string, []string) {
	if entry := m.mapEntry(f); entry != nil {
		key := "string"
		if scalarType(entry.Field[0]) != 0 && isNumberKey(entry.Field[0]) {
			key = "number"
		}
		value, refs := m.baseType(mapValueWithJstype(f, entry.Field[1]))
		return "{ [key: " + key + "]: " + value + " }", refs
	}
	typ, refs := m.baseType(f)
	if f.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		typ += "[]"
	}
	return typ, refs
}

func isNumberKey(f *descriptorpb.FieldDescriptorProto) bool {
	switch f.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return true
	}
	return false
}

func (m *module) baseType(f *descriptorpb.FieldDescriptorProto) (string, []string) {
	switch f.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE, descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		name := m.ref(f.GetTypeName())
		return name, []string{name}
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "boolean", nil
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "string", nil
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "Uint8Array", nil
	}
	if is64BitIntType(f) {
		switch f.GetOptions().GetJstype() {
		case descriptorpb.FieldOptions_JS_NUMBER:
			return "number", nil
		case descriptorpb.FieldOptions_JS_NORMAL:
			if hasJstype(f) {
				return "bigint", nil
			}
		}
		return "string", nil
	}
	return "number", nil
}

func (m *module) mapEntry(f *descriptorpb.FieldDescriptorProto) *descriptorpb.DescriptorProto {
	if f.GetLabel() != descriptorpb.FieldDescriptorProto_LABEL_REPEATED || f.GetType() != descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		return nil
	}
	if info := m.schema.lookup(f.GetTypeName()); info != nil && info.isMapEntry() && len(info.msg.Field) == 2 {
		return info.msg
	}
	return nil
}

func is64BitIntType(f *descriptorpb.FieldDescriptorProto) bool {
	switch f.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return true
	}
	return false
}

// mapValueWithJstype gives a map's value field the jstype written on the map field,
// since the synthetic entry message doesn't carry it.
func mapValueWithJstype(outer, value *descriptorpb.FieldDescriptorProto) *descriptorpb.FieldDescriptorProto {
	if !hasJstype(outer) || !is64BitIntType(value) {
		return value
	}
	copied := proto.Clone(value).(*descriptorpb.FieldDescriptorProto)
	if copied.Options == nil {
		copied.Options = &descriptorpb.FieldOptions{}
	}
	copied.Options.Jstype = outer.GetOptions().Jstype
	return copied
}

func hasJstype(f *descriptorpb.FieldDescriptorProto) bool {
	return f.GetOptions() != nil && f.GetOptions().Jstype != nil
}

// longType is the runtime's L for a jstype, or nil where the default (a string) holds.
func longType(f *descriptorpb.FieldDescriptorProto) *int {
	if !hasJstype(f) || !is64BitIntType(f) {
		return nil
	}
	var l int
	switch f.GetOptions().GetJstype() {
	case descriptorpb.FieldOptions_JS_NUMBER:
		l = 2
	case descriptorpb.FieldOptions_JS_NORMAL:
		l = 0
	default:
		return nil
	}
	return &l
}

// scalarType is the runtime's ScalarType, or 0 for a message or an enum.
func scalarType(f *descriptorpb.FieldDescriptorProto) int {
	switch f.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return 1
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return 2
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return 3
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		return 4
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return 5
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return 6
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return 7
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return 8
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return 9
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return 12
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return 13
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return 15
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return 16
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return 17
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return 18
	}
	return 0
}

func (m *module) isPacked(f *descriptorpb.FieldDescriptorProto) bool {
	if f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_STRING ||
		f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_BYTES ||
		f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE ||
		f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_GROUP {
		return false
	}
	if f.GetOptions() != nil && f.GetOptions().Packed != nil {
		return f.GetOptions().GetPacked()
	}
	return m.file.GetSyntax() == "proto3"
}

func (m *module) field(msg *descriptorpb.DescriptorProto, f *descriptorpb.FieldDescriptorProto) *field {
	out := &field{
		no:      f.GetNumber(),
		name:    f.GetName(),
		kind:    "scalar",
		scalar:  scalarType(f),
		long:    longType(f),
		options: m.g.getCustomFieldOptions(f.Options),
	}
	camel := toCamelCase(f.GetName())
	if escaped := escapeProperty(camel); escaped != camel {
		out.localName = escaped
	}
	if f.JsonName != nil && f.GetJsonName() != camel {
		out.jsonName = f.GetJsonName()
	}
	if f.OneofIndex != nil && !f.GetProto3Optional() {
		out.oneof = escapeProperty(toCamelCase(msg.OneofDecl[f.GetOneofIndex()].GetName()))
	}

	switch {
	case m.mapEntry(f) != nil:
		entry := m.mapEntry(f)
		out.kind = "map"
		out.scalar = 0
		out.long = nil
		out.key = scalarType(entry.Field[0])
		value := entry.Field[1]
		switch value.GetType() {
		case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
			out.value = &mapValue{kind: "message", ref: m.schema.lookup(value.GetTypeName())}
		case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
			out.value = &mapValue{kind: "enum", ref: m.schema.lookup(value.GetTypeName())}
		default:
			out.value = &mapValue{kind: "scalar", scalar: scalarType(value), long: longType(mapValueWithJstype(f, value))}
		}
	case f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		out.kind = "message"
		out.ref = m.schema.lookup(f.GetTypeName())
	case f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		out.kind = "enum"
		out.ref = m.schema.lookup(f.GetTypeName())
	}

	if f.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED && out.kind != "map" {
		out.repeat = 2
		if m.isPacked(f) {
			out.repeat = 1
		}
	}
	if f.GetType() != descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		if f.GetProto3Optional() {
			out.opt = true
		} else if m.isProto2() && f.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL && f.OneofIndex == nil {
			out.opt = true
		}
	}
	return out
}

func (m *module) enum(e *descriptorpb.EnumDescriptorProto, typeName string, enumPath []int32) *enum {
	info := m.schema.lookup(typeName)
	out := &enum{
		name:       info.name,
		typeName:   info.typeName,
		prefix:     enumPrefix(e),
		doc:        m.comments.doc(enumPath),
		deprecated: e.GetOptions().GetDeprecated() || m.fileDeprecated(),
	}
	hasZero := false
	for _, v := range e.Value {
		hasZero = hasZero || v.GetNumber() == 0
	}
	// protobuf-ts insists every enum has a 0, which is what an unset field reads as.
	if !hasZero {
		out.values = append(out.values, &enumValue{name: "UNSPECIFIED$", number: 0})
	}
	for i, v := range e.Value {
		out.values = append(out.values, &enumValue{
			name:       strings.TrimPrefix(v.GetName(), out.prefix),
			number:     v.GetNumber(),
			doc:        m.comments.doc(appendPath(enumPath, 2, i)),
			deprecated: v.GetOptions().GetDeprecated(),
		})
	}
	return out
}

func (m *module) service(svc *descriptorpb.ServiceDescriptorProto, svcPath []int32) *service {
	pkg := ""
	if m.file.GetPackage() != "" {
		pkg = m.file.GetPackage() + "."
	}
	out := &service{
		name:       escapeTypescriptKeyword(svc.GetName()),
		typeName:   pkg + svc.GetName(),
		doc:        m.comments.doc(svcPath),
		deprecated: svc.GetOptions().GetDeprecated() || m.fileDeprecated(),
		options:    m.g.getCustomServiceOptions(svc.Options),
	}
	for i, md := range svc.Method {
		meth := &method{
			name:            md.GetName(),
			input:           m.ref(md.GetInputType()),
			output:          m.ref(md.GetOutputType()),
			inputType:       m.schema.lookup(md.GetInputType()),
			outputType:      m.schema.lookup(md.GetOutputType()),
			serverStreaming: md.GetServerStreaming(),
			clientStreaming: md.GetClientStreaming(),
			options:         m.g.getCustomMethodOptions(md.Options),
			doc:             m.comments.doc(appendPath(svcPath, 2, i)),
			deprecated:      md.GetOptions().GetDeprecated() || m.fileDeprecated(),
		}
		camel := toCamelCase(md.GetName())
		if escaped := escapeMethodName(camel); escaped != camel {
			meth.localName = escaped
		}
		switch md.GetOptions().GetIdempotencyLevel() {
		case descriptorpb.MethodOptions_NO_SIDE_EFFECTS:
			meth.idempotency = "NO_SIDE_EFFECTS"
		case descriptorpb.MethodOptions_IDEMPOTENT:
			meth.idempotency = "IDEMPOTENT"
		}
		out.methods = append(out.methods, meth)
	}
	return out
}

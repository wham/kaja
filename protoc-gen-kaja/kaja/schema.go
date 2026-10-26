package kaja

import (
	"fmt"
	"strings"

	"google.golang.org/protobuf/types/descriptorpb"
)

// schema indexes every type of every file the request carries, under the name a
// descriptor refers to it by (".pkg.Outer.Inner").
type schema struct {
	files  []*descriptorpb.FileDescriptorProto
	byName map[string]*descriptorpb.FileDescriptorProto
	types  map[string]*typeInfo
	// extensions is buildExtensionMap's answer per extendee. Every field asks it, and
	// walking every message for each one was gigabytes of garbage on a large API.
	extensions map[string]map[int32]extInfo
}

type typeInfo struct {
	// typeName is the full proto name without the leading dot, which is what the
	// runtime calls a type.
	typeName string
	file     *descriptorpb.FileDescriptorProto
	msg      *descriptorpb.DescriptorProto
	enum     *descriptorpb.EnumDescriptorProto
	// name is what the type is called in the module of the file declaring it.
	name string
	path []int32
}

func (t *typeInfo) isMapEntry() bool {
	return t.msg != nil && t.msg.GetOptions().GetMapEntry()
}

func newSchema(files []*descriptorpb.FileDescriptorProto) *schema {
	s := &schema{files: files, byName: map[string]*descriptorpb.FileDescriptorProto{}, types: map[string]*typeInfo{}, extensions: map[string]map[int32]extInfo{}}
	for _, file := range files {
		s.byName[file.GetName()] = file
		s.index(file)
	}
	return s
}

// index names a file's types the way protobuf-ts did, since scripts already written
// against those names must go on resolving: a nested type is its parents joined by
// "_", a top-level one escapes a TypeScript keyword, and a name two types in one file
// arrive at is numbered for every type after the first.
func (s *schema) index(file *descriptorpb.FileDescriptorProto) {
	pkg := ""
	if file.GetPackage() != "" {
		pkg = file.GetPackage() + "."
	}
	var declared []*typeInfo
	add := func(info *typeInfo) {
		s.types["."+info.typeName] = info
		declared = append(declared, info)
	}

	var walkEnum func(enum *descriptorpb.EnumDescriptorProto, tsPrefix, protoPrefix string, path []int32)
	walkEnum = func(enum *descriptorpb.EnumDescriptorProto, tsPrefix, protoPrefix string, path []int32) {
		add(&typeInfo{typeName: pkg + protoPrefix + enum.GetName(), file: file, enum: enum, name: tsName(tsPrefix, enum.GetName()), path: path})
	}
	var walkMessage func(msg *descriptorpb.DescriptorProto, tsPrefix, protoPrefix string, path []int32)
	walkMessage = func(msg *descriptorpb.DescriptorProto, tsPrefix, protoPrefix string, path []int32) {
		info := &typeInfo{typeName: pkg + protoPrefix + msg.GetName(), file: file, msg: msg, name: tsName(tsPrefix, msg.GetName()), path: path}
		if info.isMapEntry() {
			s.types["."+info.typeName] = info
			return
		}
		add(info)
		nestedTs := tsPrefix + msg.GetName() + "_"
		nestedProto := protoPrefix + msg.GetName() + "."
		for i, nested := range msg.NestedType {
			walkMessage(nested, nestedTs, nestedProto, appendPath(path, 3, i))
		}
		for i, enum := range msg.EnumType {
			walkEnum(enum, nestedTs, nestedProto, appendPath(path, 4, i))
		}
	}
	for i, msg := range file.MessageType {
		walkMessage(msg, "", "", []int32{4, int32(i)})
	}
	for i, enum := range file.EnumType {
		walkEnum(enum, "", "", []int32{5, int32(i)})
	}

	seen := map[string]int{}
	for _, info := range declared {
		n := seen[info.name]
		seen[info.name] = n + 1
		if n > 0 {
			info.name = fmt.Sprintf("%s$%d", info.name, n)
		}
	}
}

func tsName(prefix, name string) string {
	if prefix == "" {
		return escapeTypescriptKeyword(name)
	}
	return prefix + name
}

func appendPath(path []int32, elements ...int) []int32 {
	out := append([]int32{}, path...)
	for _, e := range elements {
		out = append(out, int32(e))
	}
	return out
}

func (s *schema) lookup(typeName string) *typeInfo {
	if !strings.HasPrefix(typeName, ".") {
		typeName = "." + typeName
	}
	return s.types[typeName]
}

// moduleFiles are the files a request is turned into modules for: the ones asked for,
// and every file declaring a type they reach, so a type a field names always has a
// module to come from. A file declaring nothing is no module at all.
func (s *schema) moduleFiles(toGenerate []string) []*descriptorpb.FileDescriptorProto {
	included := map[string]bool{}
	var queue []*descriptorpb.FileDescriptorProto
	include := func(file *descriptorpb.FileDescriptorProto) {
		if file != nil && !included[file.GetName()] {
			included[file.GetName()] = true
			queue = append(queue, file)
		}
	}
	reach := func(typeName string) {
		if info := s.lookup(typeName); info != nil {
			include(info.file)
		}
	}
	for _, name := range toGenerate {
		include(s.byName[name])
	}
	for len(queue) > 0 {
		file := queue[0]
		queue = queue[1:]
		var walk func(msg *descriptorpb.DescriptorProto)
		walk = func(msg *descriptorpb.DescriptorProto) {
			for _, field := range msg.Field {
				reach(field.GetTypeName())
			}
			for _, nested := range msg.NestedType {
				walk(nested)
			}
		}
		for _, msg := range file.MessageType {
			walk(msg)
		}
		for _, service := range file.Service {
			for _, method := range service.Method {
				reach(method.GetInputType())
				reach(method.GetOutputType())
			}
		}
	}

	var files []*descriptorpb.FileDescriptorProto
	for _, file := range s.files {
		if included[file.GetName()] && (len(file.MessageType) > 0 || len(file.EnumType) > 0 || len(file.Service) > 0) {
			files = append(files, file)
		}
	}
	return files
}

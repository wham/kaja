package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/pluginpb"
)

func main() {
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		os.Stderr.WriteString("failed to read input: " + err.Error() + "\n")
		os.Exit(1)
	}

	req := &pluginpb.CodeGeneratorRequest{}
	if err := proto.Unmarshal(input, req); err != nil {
		os.Stderr.WriteString("failed to unmarshal request: " + err.Error() + "\n")
		os.Exit(1)
	}

	resp := generate(req)

	output, err := proto.Marshal(resp)
	if err != nil {
		os.Stderr.WriteString("failed to marshal response: " + err.Error() + "\n")
		os.Exit(1)
	}

	os.Stdout.Write(output)
}

// TypeScript reserved keywords and type names that need to be escaped
var tsReservedKeywords = map[string]bool{
	"break": true, "case": true, "catch": true, "class": true, "const": true, "continue": true,
	"debugger": true, "default": true, "delete": true, "do": true, "else": true, "enum": true,
	"export": true, "extends": true, "false": true, "finally": true, "for": true, "function": true,
	"if": true, "import": true, "in": true, "instanceof": true, "new": true, "null": true,
	"return": true, "super": true, "switch": true, "this": true, "throw": true, "true": true,
	"try": true, "typeof": true, "var": true, "void": true, "while": true, "with": true,
	"as": true, "implements": true, "interface": true, "let": true, "package": true, "private": true,
	"protected": true, "public": true, "static": true, "yield": true, "any": true, "boolean": true,
	"constructor": true, "declare": true, "get": true, "module": true, "require": true, "number": true,
	"set": true, "string": true, "symbol": true, "type": true, "from": true, "of": true,
}

var tsReservedTypeNames = map[string]bool{
	"object": true, "Uint8Array": true, "array": true, "Array": true, "string": true, "String": true,
	"number": true, "Number": true, "boolean": true, "Boolean": true, "bigint": true, "BigInt": true,
}

// Reserved class method/property names that need escaping in service clients
var tsReservedMethodNames = map[string]bool{
	// Generic reserved names
	"name": true, "constructor": true, "close": true, "toString": true,
	// gRPC client reserved method names
	"makeUnaryRequest": true, "makeClientStreamRequest": true,
	"makeServerStreamRequest": true, "makeBidiStreamRequest": true,
	"getChannel": true, "waitForReady": true,
	// ServiceInfo interface properties
	"methods": true, "typeName": true, "options": true,
}

// Escape TypeScript reserved keywords and type names by adding '$' suffix
func escapeTypescriptKeyword(name string) string {
	if tsReservedKeywords[name] || tsReservedTypeNames[name] {
		return name + "$"
	}
	return name
}

// Escape reserved class method/property names by adding '$' suffix
func escapeMethodName(name string) string {
	if tsReservedMethodNames[name] {
		return name + "$"
	}
	return name
}

type params struct {
	longType string
}

func parseParameters(paramStr *string) params {
	p := params{longType: "string"} // default
	if paramStr == nil {
		return p
	}

	for _, param := range strings.Split(*paramStr, ",") {
		if strings.HasPrefix(param, "long_type_") {
			p.longType = strings.TrimPrefix(param, "long_type_")
		}
	}
	return p
}

func findFile(files []*descriptorpb.FileDescriptorProto, name string) *descriptorpb.FileDescriptorProto {
	for _, f := range files {
		if f.GetName() == name {
			return f
		}
	}
	return nil
}

func getOutputFileName(protoFile string) string {
	base := strings.TrimSuffix(protoFile, ".proto")
	return base + ".ts"
}

func getClientOutputFileName(protoFile string) string {
	base := strings.TrimSuffix(protoFile, ".proto")
	return base + ".client.ts"
}

func generate(req *pluginpb.CodeGeneratorRequest) *pluginpb.CodeGeneratorResponse {
	resp := &pluginpb.CodeGeneratorResponse{}
	resp.SupportedFeatures = proto.Uint64(uint64(pluginpb.CodeGeneratorResponse_FEATURE_PROTO3_OPTIONAL))

	// Parse plugin parameters
	params := parseParameters(req.Parameter)

	// Pre-scan: identify files with services in this batch
	filesWithServices := make(map[string]bool)
	importedByServiceFilesInSameDir := make(map[string]bool) // Dependencies imported by service files in the same directory
	importedByServiceFilesInDiffDir := make(map[string]bool) // Dependencies imported by service files in different directories
	importedByNonServiceFiles := make(map[string]bool)
	
	for _, fileName := range req.FileToGenerate {
		file := findFile(req.ProtoFile, fileName)
		if file != nil {
			hasService := len(file.Service) > 0
			fileDir := filepath.Dir(fileName)
			if hasService {
				filesWithServices[fileName] = true
				// Mark all dependencies of this service file
				for _, dep := range file.Dependency {
					depDir := filepath.Dir(dep)
					if fileDir == depDir {
						// Same directory - not a library file
						importedByServiceFilesInSameDir[dep] = true
					} else {
						// Different directory - potential library file
						importedByServiceFilesInDiffDir[dep] = true
					}
				}
			} else {
				// Mark all dependencies of this non-service file
				for _, dep := range file.Dependency {
					importedByNonServiceFiles[dep] = true
				}
			}
		}
	}

	// Generate files for each proto file to generate, tracking which produced output
	generatedFiles := make(map[string]bool)
	for _, fileName := range req.FileToGenerate {
		file := findFile(req.ProtoFile, fileName)
		if file == nil {
			continue
		}

		// A file is "imported by service files only" if:
		// 1. It's imported by at least one service file in a DIFFERENT directory (library file pattern)
		// 2. It's NOT imported by any non-service files
		// 3. It's NOT imported by any service files in the SAME directory (same-dir imports don't count)
		// 4. It's NOT a main file (has a service) - main service files handle their own imports
		//
		// This flag affects WireType positioning: library files in subdirectories used only by services
		// get WireType early, while files in the same directory as their importers get it late.
		hasService := len(file.Service) > 0
		isImportedOnlyByServices := !hasService && 
			importedByServiceFilesInDiffDir[fileName] && 
			!importedByServiceFilesInSameDir[fileName] &&
			!importedByNonServiceFiles[fileName]
		
		content := generateFile(file, req.ProtoFile, params, isImportedOnlyByServices)
		if content == "" {
			continue
		}

		generatedFiles[fileName] = true
		outputName := getOutputFileName(fileName)
		resp.File = append(resp.File, &pluginpb.CodeGeneratorResponse_File{
			Name:    proto.String(outputName),
			Content: proto.String(content),
		})

		// Generate client file if there are services
		if len(file.Service) > 0 {
			clientContent := generateClientFile(file, req.ProtoFile, params)
			clientName := getClientOutputFileName(fileName)
			resp.File = append(resp.File, &pluginpb.CodeGeneratorResponse_File{
				Name:    proto.String(clientName),
				Content: proto.String(clientContent),
			})
		}
	}
	
	// Also generate for google.protobuf well-known types if they're dependencies,
	// but only if at least one FileToGenerate produced output
	if len(generatedFiles) > 0 {
		for _, file := range req.ProtoFile {
			fileName := file.GetName()
			// Check if this is a well-known type
			if strings.HasPrefix(fileName, "google/protobuf/") {
				// Check if any file to generate depends on this
				needsGeneration := false
				for _, genFileName := range req.FileToGenerate {
					genFile := findFile(req.ProtoFile, genFileName)
					if genFile == nil {
						continue
					}
					for _, dep := range genFile.Dependency {
						if dep == fileName {
							needsGeneration = true
							break
						}
					}
					if needsGeneration {
						break
					}
				}
				
				if needsGeneration {
					content := generateFile(file, req.ProtoFile, params, false) // Well-known types are never imported by service files
					if content != "" {
						outputName := getOutputFileName(fileName)
						resp.File = append(resp.File, &pluginpb.CodeGeneratorResponse_File{
							Name:    proto.String(outputName),
							Content: proto.String(content),
						})
					}
				}
			}
		}
	}

	return resp
}

type generator struct {
	b                   strings.Builder
	params              params
	file                *descriptorpb.FileDescriptorProto
	allFiles            []*descriptorpb.FileDescriptorProto
	indent              string
	isImportedByService bool     // True if imported ONLY by service files (not by non-service files)
	importedTypeNames   map[string]bool   // Set of simple type names that have been imported
	typeNameSuffixes    map[string]int    // Map from full proto type name to numeric suffix (0 = no suffix, 1 = $1, etc.)
	localTypeNames      map[string]bool   // Set of TS names defined locally in this file (for collision detection)
	importAliases       map[string]string // Map from proto type name → aliased TS import name (e.g., ".common.Item" → "Item$")
}

func (g *generator) p(format string, args ...interface{}) {
	line := fmt.Sprintf(format, args...)
	hasLF := strings.Contains(line, "\n")
	hasCR := strings.Contains(line, "\r")
	if hasLF || hasCR {
		isJSDoc := strings.HasPrefix(line, " * ")
		// Process character by character to distinguish \n (JSDoc continuation)
		// from \r (raw line break without JSDoc prefix, matching TS printer behavior)
		var current strings.Builder
		g.b.WriteString(g.indent)
		for i := 0; i < len(line); i++ {
			ch := line[i]
			if ch == '\n' || ch == '\r' {
				g.b.WriteString(current.String())
				g.b.WriteString("\n")
				current.Reset()
				g.b.WriteString(g.indent)
				if ch == '\n' && isJSDoc {
					g.b.WriteString(" * ")
				}
			} else {
				current.WriteByte(ch)
			}
		}
		g.b.WriteString(current.String())
		g.b.WriteString("\n")
	} else {
		g.b.WriteString(g.indent)
		g.b.WriteString(line)
		g.b.WriteString("\n")
	}
}

func (g *generator) pNoIndent(format string, args ...interface{}) {
	fmt.Fprintf(&g.b, format, args...)
	g.b.WriteString("\n")
}

// isFileDeprecated returns true if the entire file is marked as deprecated
func (g *generator) isFileDeprecated() bool {
	return g.file.Options != nil && g.file.GetOptions().GetDeprecated()
}

// isOptimizeCodeSize returns true if the file has option optimize_for = CODE_SIZE or LITE_RUNTIME
func (g *generator) isOptimizeCodeSize() bool {
	if g.file.Options == nil || g.file.Options.OptimizeFor == nil {
		return false
	}
	opt := g.file.GetOptions().GetOptimizeFor()
	return opt == descriptorpb.FileOptions_CODE_SIZE || opt == descriptorpb.FileOptions_LITE_RUNTIME
}

// escapeJSDocComment escapes sequences that would break JSDoc comments
func escapeJSDocComment(s string) string {
	// Escape */ sequences which would close the JSDoc comment prematurely
	return strings.ReplaceAll(s, "*/", "*\\/")
}

// customOption represents a key-value pair for custom options
type customOption struct {
	key   string
	value interface{}
}

type mapEntryValue struct {
	key   string
	value interface{}
}

type extInfo struct {
	ext       *descriptorpb.FieldDescriptorProto
	pkg       string
	msgPrefix string // parent message name(s) for nested extensions, e.g. "Extensions."
}

// buildExtensionMap builds a map of extension field number -> extension info for a given extendee type
func (g *generator) buildExtensionMap(extendeeName string) map[int32]extInfo {
	extensionMap := make(map[int32]extInfo)

	collectFromFile := func(f *descriptorpb.FileDescriptorProto) {
		pkg := ""
		if f.Package != nil {
			pkg = *f.Package
		}
		// Top-level extensions
		for _, ext := range f.Extension {
			if ext.GetExtendee() == extendeeName {
				extensionMap[ext.GetNumber()] = extInfo{ext: ext, pkg: pkg}
			}
		}
		// Extensions nested in messages (recursively)
		var scanMsg func(msg *descriptorpb.DescriptorProto, prefix string)
		scanMsg = func(msg *descriptorpb.DescriptorProto, prefix string) {
			msgPrefix := prefix + msg.GetName() + "."
			for _, ext := range msg.Extension {
				if ext.GetExtendee() == extendeeName {
					extensionMap[ext.GetNumber()] = extInfo{ext: ext, pkg: pkg, msgPrefix: msgPrefix}
				}
			}
			for _, nested := range msg.NestedType {
				scanMsg(nested, msgPrefix)
			}
		}
		for _, msg := range f.MessageType {
			scanMsg(msg, "")
		}
	}

	// Check current file and all imported files
	for _, f := range g.allFiles {
		collectFromFile(f)
	}

	return extensionMap
}

// resolveEnumValueName looks up an enum value name by its fully-qualified type name and numeric value
func (g *generator) resolveEnumValueName(typeName string, number int32) string {
	for _, f := range g.allFiles {
		for _, enum := range f.EnumType {
			var fqn string
			if f.GetPackage() == "" {
				fqn = "." + enum.GetName()
			} else {
				fqn = "." + f.GetPackage() + "." + enum.GetName()
			}
			if fqn == typeName {
				for _, val := range enum.Value {
					if val.GetNumber() == number {
						return val.GetName()
					}
				}
			}
		}
		// Also check nested enums inside messages
		for _, msg := range f.MessageType {
			if name := g.findEnumInMessage(f, msg, typeName, number); name != "" {
				return name
			}
		}
	}
	return fmt.Sprintf("%d", number)
}

func (g *generator) findEnumInMessage(f *descriptorpb.FileDescriptorProto, msg *descriptorpb.DescriptorProto, typeName string, number int32) string {
	var prefix string
	if f.GetPackage() == "" {
		prefix = "." + msg.GetName()
	} else {
		prefix = "." + f.GetPackage() + "." + msg.GetName()
	}
	for _, enum := range msg.EnumType {
		fqn := prefix + "." + enum.GetName()
		if fqn == typeName {
			for _, val := range enum.Value {
				if val.GetNumber() == number {
					return val.GetName()
				}
			}
		}
	}
	for _, nested := range msg.NestedType {
		nestedPrefix := prefix + "." + nested.GetName()
		for _, enum := range nested.EnumType {
			fqn := nestedPrefix + "." + enum.GetName()
			if fqn == typeName {
				for _, val := range enum.Value {
					if val.GetNumber() == number {
						return val.GetName()
					}
				}
			}
		}
	}
	return ""
}

// parseCustomOptions extracts custom extension values from raw unknown fields
func (g *generator) parseCustomOptions(unknown []byte, extensionMap map[int32]extInfo) []customOption {
	var result []customOption
	
	for len(unknown) > 0 {
		num, typ, n := protowire.ConsumeTag(unknown)
		if n < 0 {
			break
		}
		unknown = unknown[n:]
		
		extInf, found := extensionMap[int32(num)]
		if !found {
			switch typ {
			case protowire.VarintType:
				_, n := protowire.ConsumeVarint(unknown)
				unknown = unknown[n:]
			case protowire.Fixed64Type:
				unknown = unknown[8:]
			case protowire.BytesType:
				_, n := protowire.ConsumeBytes(unknown)
				unknown = unknown[n:]
			case protowire.Fixed32Type:
				unknown = unknown[4:]
			}
			continue
		}
		
		ext := extInf.ext
		pkg := extInf.pkg
		if pkg != "" {
			pkg += "."
		}
		extName := pkg + extInf.msgPrefix + ext.GetName()
		
		switch ext.GetType() {
		case descriptorpb.FieldDescriptorProto_TYPE_STRING:
			v, n := protowire.ConsumeBytes(unknown)
			result = append(result, customOption{key: extName, value: string(v)})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
			v, n := protowire.ConsumeVarint(unknown)
			result = append(result, customOption{key: extName, value: v != 0})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
			v, n := protowire.ConsumeVarint(unknown)
			enumName := g.resolveEnumValueName(ext.GetTypeName(), int32(v))
			result = append(result, customOption{key: extName, value: enumName})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_INT32,
		     descriptorpb.FieldDescriptorProto_TYPE_UINT32:
			v, n := protowire.ConsumeVarint(unknown)
			result = append(result, customOption{key: extName, value: int(v)})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_INT64:
			v, n := protowire.ConsumeVarint(unknown)
			result = append(result, customOption{key: extName, value: fmt.Sprintf("%d", int64(v))})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
			v, n := protowire.ConsumeVarint(unknown)
			result = append(result, customOption{key: extName, value: fmt.Sprintf("%d", v)})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
			v, n := protowire.ConsumeVarint(unknown)
			result = append(result, customOption{key: extName, value: int(protowire.DecodeZigZag(v))})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
			v, n := protowire.ConsumeVarint(unknown)
			result = append(result, customOption{key: extName, value: fmt.Sprintf("%d", protowire.DecodeZigZag(v))})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
			v, n := protowire.ConsumeFixed32(unknown)
			result = append(result, customOption{key: extName, value: int(int32(v))})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
			v, n := protowire.ConsumeFixed64(unknown)
			result = append(result, customOption{key: extName, value: fmt.Sprintf("%d", int64(v))})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
			v, n := protowire.ConsumeFixed32(unknown)
			result = append(result, customOption{key: extName, value: int(v)})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
			v, n := protowire.ConsumeFixed64(unknown)
			result = append(result, customOption{key: extName, value: fmt.Sprintf("%d", v)})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
			v, n := protowire.ConsumeFixed32(unknown)
			fval := float64(math.Float32frombits(v))
			if math.IsNaN(fval) {
				result = append(result, customOption{key: extName, value: "NaN"})
			} else if math.IsInf(fval, 1) {
				result = append(result, customOption{key: extName, value: "Infinity"})
			} else if math.IsInf(fval, -1) {
				result = append(result, customOption{key: extName, value: "-Infinity"})
			} else {
				result = append(result, customOption{key: extName, value: fval})
			}
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
			v, n := protowire.ConsumeFixed64(unknown)
			fval := math.Float64frombits(v)
			if math.IsNaN(fval) {
				result = append(result, customOption{key: extName, value: "NaN"})
			} else if math.IsInf(fval, 1) {
				result = append(result, customOption{key: extName, value: "Infinity"})
			} else if math.IsInf(fval, -1) {
				result = append(result, customOption{key: extName, value: "-Infinity"})
			} else {
				result = append(result, customOption{key: extName, value: fval})
			}
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
			v, n := protowire.ConsumeBytes(unknown)
			result = append(result, customOption{key: extName, value: base64.StdEncoding.EncodeToString(v)})
			unknown = unknown[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
			v, n := protowire.ConsumeBytes(unknown)
			msgDesc := g.findMessageType(ext.GetTypeName())
			if msgDesc != nil {
				nested := g.parseMessageValue(v, msgDesc)
				result = append(result, customOption{key: extName, value: nested})
			}
			unknown = unknown[n:]
		default:
			switch typ {
			case protowire.VarintType:
				_, n := protowire.ConsumeVarint(unknown)
				unknown = unknown[n:]
			case protowire.Fixed64Type:
				unknown = unknown[8:]
			case protowire.BytesType:
				_, n := protowire.ConsumeBytes(unknown)
				unknown = unknown[n:]
			case protowire.Fixed32Type:
				unknown = unknown[4:]
			}
		}
	}
	
	if len(result) == 0 {
		return nil
	}
	// Merge repeated fields with the same key into arrays
	result = mergeRepeatedOptions(result)
	return result
}

// mergeRepeatedOptions merges customOption entries with the same key into array values.
// e.g. [{key:"tags", value:"alpha"}, {key:"tags", value:"beta"}] → [{key:"tags", value:["alpha","beta"]}]
func mergeRepeatedOptions(opts []customOption) []customOption {
	var merged []customOption
	seen := make(map[string]int) // key → index in merged
	for _, opt := range opts {
		if me, ok := opt.value.(mapEntryValue); ok {
			// Map entry: merge into []customOption (object)
			entry := customOption{key: me.key, value: me.value}
			if idx, exists := seen[opt.key]; exists {
				existing := merged[idx].value
				if arr, ok := existing.([]customOption); ok {
					merged[idx].value = append(arr, entry)
				} else {
					merged[idx].value = []customOption{entry}
				}
			} else {
				seen[opt.key] = len(merged)
				merged = append(merged, customOption{key: opt.key, value: []customOption{entry}})
			}
		} else if idx, ok := seen[opt.key]; ok {
			// Already seen this key — convert to or append to array
			existing := merged[idx].value
			switch arr := existing.(type) {
			case []interface{}:
				merged[idx].value = append(arr, opt.value)
			default:
				merged[idx].value = []interface{}{existing, opt.value}
			}
		} else {
			seen[opt.key] = len(merged)
			merged = append(merged, opt)
		}
	}
	return merged
}

// parseMessageValue decodes a message's wire bytes into an ordered list of field name→value pairs
func (g *generator) parseMessageValue(data []byte, msgDesc *descriptorpb.DescriptorProto) []customOption {
	// Build field number → field descriptor map
	fieldMap := make(map[int32]*descriptorpb.FieldDescriptorProto)
	for _, f := range msgDesc.Field {
		fieldMap[f.GetNumber()] = f
	}
	
	var result []customOption
	for len(data) > 0 {
		num, typ, n := protowire.ConsumeTag(data)
		if n < 0 {
			break
		}
		data = data[n:]
		
		fd, found := fieldMap[int32(num)]
		if !found {
			// Skip unknown field
			switch typ {
			case protowire.VarintType:
				_, n = protowire.ConsumeVarint(data)
			case protowire.Fixed64Type:
				n = 8
			case protowire.BytesType:
				_, n = protowire.ConsumeBytes(data)
			case protowire.Fixed32Type:
				n = 4
			}
			data = data[n:]
			continue
		}
		
		fieldName := fd.GetJsonName()

		// Handle packed repeated encoding: wire type is BytesType but field is a scalar numeric type
		if typ == protowire.BytesType && fd.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
			switch fd.GetType() {
			case descriptorpb.FieldDescriptorProto_TYPE_INT32, descriptorpb.FieldDescriptorProto_TYPE_UINT32,
				descriptorpb.FieldDescriptorProto_TYPE_INT64, descriptorpb.FieldDescriptorProto_TYPE_UINT64,
				descriptorpb.FieldDescriptorProto_TYPE_SINT32, descriptorpb.FieldDescriptorProto_TYPE_SINT64,
				descriptorpb.FieldDescriptorProto_TYPE_BOOL, descriptorpb.FieldDescriptorProto_TYPE_ENUM:
				packed, pn := protowire.ConsumeBytes(data)
				data = data[pn:]
				for len(packed) > 0 {
					v, vn := protowire.ConsumeVarint(packed)
					if vn < 0 {
						break
					}
					packed = packed[vn:]
					switch fd.GetType() {
					case descriptorpb.FieldDescriptorProto_TYPE_INT32:
						result = append(result, customOption{key: fieldName, value: int(int32(v))})
					case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
						result = append(result, customOption{key: fieldName, value: int(v)})
					case descriptorpb.FieldDescriptorProto_TYPE_INT64:
						result = append(result, customOption{key: fieldName, value: fmt.Sprintf("%d", int64(v))})
					case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
						result = append(result, customOption{key: fieldName, value: fmt.Sprintf("%d", v)})
					case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
						result = append(result, customOption{key: fieldName, value: int(protowire.DecodeZigZag(v))})
					case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
						result = append(result, customOption{key: fieldName, value: fmt.Sprintf("%d", protowire.DecodeZigZag(v))})
					case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
						result = append(result, customOption{key: fieldName, value: v != 0})
					case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
						enumName := g.resolveEnumValueName(fd.GetTypeName(), int32(v))
						result = append(result, customOption{key: fieldName, value: enumName})
					}
				}
				continue
			case descriptorpb.FieldDescriptorProto_TYPE_FIXED32, descriptorpb.FieldDescriptorProto_TYPE_SFIXED32,
				descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
				packed, pn := protowire.ConsumeBytes(data)
				data = data[pn:]
				for len(packed) > 0 {
					v, vn := protowire.ConsumeFixed32(packed)
					if vn < 0 {
						break
					}
					packed = packed[vn:]
					switch fd.GetType() {
					case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
						result = append(result, customOption{key: fieldName, value: int(v)})
					case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
						result = append(result, customOption{key: fieldName, value: int(int32(v))})
					case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
						fval := float64(math.Float32frombits(v))
						if math.IsNaN(fval) {
							result = append(result, customOption{key: fieldName, value: "NaN"})
						} else if math.IsInf(fval, 1) {
							result = append(result, customOption{key: fieldName, value: "Infinity"})
						} else if math.IsInf(fval, -1) {
							result = append(result, customOption{key: fieldName, value: "-Infinity"})
						} else {
							result = append(result, customOption{key: fieldName, value: fval})
						}
					}
				}
				continue
			case descriptorpb.FieldDescriptorProto_TYPE_FIXED64, descriptorpb.FieldDescriptorProto_TYPE_SFIXED64,
				descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
				packed, pn := protowire.ConsumeBytes(data)
				data = data[pn:]
				for len(packed) > 0 {
					v, vn := protowire.ConsumeFixed64(packed)
					if vn < 0 {
						break
					}
					packed = packed[vn:]
					switch fd.GetType() {
					case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
						result = append(result, customOption{key: fieldName, value: fmt.Sprintf("%d", v)})
					case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
						result = append(result, customOption{key: fieldName, value: fmt.Sprintf("%d", int64(v))})
					case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
						fval := math.Float64frombits(v)
						if math.IsNaN(fval) {
							result = append(result, customOption{key: fieldName, value: "NaN"})
						} else if math.IsInf(fval, 1) {
							result = append(result, customOption{key: fieldName, value: "Infinity"})
						} else if math.IsInf(fval, -1) {
							result = append(result, customOption{key: fieldName, value: "-Infinity"})
						} else {
							result = append(result, customOption{key: fieldName, value: fval})
						}
					}
				}
				continue
			}
		}

		switch fd.GetType() {
		case descriptorpb.FieldDescriptorProto_TYPE_STRING:
			v, n := protowire.ConsumeBytes(data)
			result = append(result, customOption{key: fieldName, value: string(v)})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
			v, n := protowire.ConsumeVarint(data)
			result = append(result, customOption{key: fieldName, value: v != 0})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
			v, n := protowire.ConsumeVarint(data)
			enumName := g.resolveEnumValueName(fd.GetTypeName(), int32(v))
			result = append(result, customOption{key: fieldName, value: enumName})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_INT32,
		     descriptorpb.FieldDescriptorProto_TYPE_UINT32:
			v, n := protowire.ConsumeVarint(data)
			result = append(result, customOption{key: fieldName, value: int(v)})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_INT64:
			v, n := protowire.ConsumeVarint(data)
			result = append(result, customOption{key: fieldName, value: fmt.Sprintf("%d", int64(v))})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
			v, n := protowire.ConsumeVarint(data)
			result = append(result, customOption{key: fieldName, value: fmt.Sprintf("%d", v)})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
			v, n := protowire.ConsumeVarint(data)
			result = append(result, customOption{key: fieldName, value: int(protowire.DecodeZigZag(v))})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
			v, n := protowire.ConsumeVarint(data)
			result = append(result, customOption{key: fieldName, value: fmt.Sprintf("%d", protowire.DecodeZigZag(v))})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
			v, n := protowire.ConsumeFixed32(data)
			result = append(result, customOption{key: fieldName, value: int(int32(v))})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
			v, n := protowire.ConsumeFixed64(data)
			result = append(result, customOption{key: fieldName, value: fmt.Sprintf("%d", int64(v))})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
			v, n := protowire.ConsumeFixed32(data)
			result = append(result, customOption{key: fieldName, value: int(v)})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
			v, n := protowire.ConsumeFixed64(data)
			result = append(result, customOption{key: fieldName, value: fmt.Sprintf("%d", v)})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
			v, n := protowire.ConsumeFixed32(data)
			fval := float64(math.Float32frombits(v))
			if math.IsNaN(fval) {
				result = append(result, customOption{key: fieldName, value: "NaN"})
			} else if math.IsInf(fval, 1) {
				result = append(result, customOption{key: fieldName, value: "Infinity"})
			} else if math.IsInf(fval, -1) {
				result = append(result, customOption{key: fieldName, value: "-Infinity"})
			} else {
				result = append(result, customOption{key: fieldName, value: fval})
			}
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
			v, n := protowire.ConsumeFixed64(data)
			fval := math.Float64frombits(v)
			if math.IsNaN(fval) {
				result = append(result, customOption{key: fieldName, value: "NaN"})
			} else if math.IsInf(fval, 1) {
				result = append(result, customOption{key: fieldName, value: "Infinity"})
			} else if math.IsInf(fval, -1) {
				result = append(result, customOption{key: fieldName, value: "-Infinity"})
			} else {
				result = append(result, customOption{key: fieldName, value: fval})
			}
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
			v, n := protowire.ConsumeBytes(data)
			result = append(result, customOption{key: fieldName, value: base64.StdEncoding.EncodeToString(v)})
			data = data[n:]
		case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
			v, n := protowire.ConsumeBytes(data)
			nestedMsg := g.findMessageType(fd.GetTypeName())
			if nestedMsg != nil {
				if nestedMsg.Options != nil && nestedMsg.GetOptions().GetMapEntry() {
					// Map entry: parse key/value and store as mapEntryValue
					nested := g.parseMessageValue(v, nestedMsg)
					var mapKey string
					var mapVal interface{}
					// Determine if map key is numeric (needs quoting in JSON)
					var keyIsNumeric bool
					for _, f := range nestedMsg.Field {
						if f.GetNumber() == 1 { // key field
							switch f.GetType() {
							case descriptorpb.FieldDescriptorProto_TYPE_INT32,
								descriptorpb.FieldDescriptorProto_TYPE_INT64,
								descriptorpb.FieldDescriptorProto_TYPE_UINT32,
								descriptorpb.FieldDescriptorProto_TYPE_UINT64,
								descriptorpb.FieldDescriptorProto_TYPE_SINT32,
								descriptorpb.FieldDescriptorProto_TYPE_SINT64,
								descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
								descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
								descriptorpb.FieldDescriptorProto_TYPE_SFIXED32,
								descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
								keyIsNumeric = true
							}
						}
					}
					for _, e := range nested {
						if e.key == "key" {
							mapKey = fmt.Sprintf("%v", e.value)
						} else if e.key == "value" {
							mapVal = e.value
						}
					}
					if keyIsNumeric {
						mapKey = fmt.Sprintf("\"%s\"", mapKey)
					}
					result = append(result, customOption{key: fieldName, value: mapEntryValue{key: mapKey, value: mapVal}})
				} else {
					nested := g.parseMessageValue(v, nestedMsg)
					result = append(result, customOption{key: fieldName, value: nested})
				}
			}
			data = data[n:]
		default:
			switch typ {
			case protowire.VarintType:
				_, n = protowire.ConsumeVarint(data)
			case protowire.Fixed64Type:
				n = 8
			case protowire.BytesType:
				_, n = protowire.ConsumeBytes(data)
			case protowire.Fixed32Type:
				n = 4
			}
			data = data[n:]
		}
	}
	return mergeRepeatedOptions(result)
}

func (g *generator) getCustomMethodOptions(opts *descriptorpb.MethodOptions) []customOption {
	if opts == nil {
		return nil
	}
	extensionMap := g.buildExtensionMap(".google.protobuf.MethodOptions")
	return g.parseCustomOptions(opts.ProtoReflect().GetUnknown(), extensionMap)
}

func (g *generator) getCustomMessageOptions(opts *descriptorpb.MessageOptions) []customOption {
	if opts == nil {
		return nil
	}
	extensionMap := g.buildExtensionMap(".google.protobuf.MessageOptions")
	return g.parseCustomOptions(opts.ProtoReflect().GetUnknown(), extensionMap)
}

func (g *generator) getCustomFieldOptions(opts *descriptorpb.FieldOptions) []customOption {
	if opts == nil {
		return nil
	}
	extensionMap := g.buildExtensionMap(".google.protobuf.FieldOptions")
	return g.parseCustomOptions(opts.ProtoReflect().GetUnknown(), extensionMap)
}

func (g *generator) getCustomServiceOptions(opts *descriptorpb.ServiceOptions) []customOption {
	if opts == nil {
		return nil
	}
	extensionMap := g.buildExtensionMap(".google.protobuf.ServiceOptions")
	return g.parseCustomOptions(opts.ProtoReflect().GetUnknown(), extensionMap)
}

// formatCustomOptions formats custom options as a TypeScript object literal
func formatCustomOptions(opts []customOption) string {
	if len(opts) == 0 {
		return "{}"
	}
	
	var parts []string
	// Options are already in wire order (field number order)
	for _, opt := range opts {
		var valueStr string
		switch val := opt.value.(type) {
		case string:
			escaped := strings.ReplaceAll(val, `\`, `\\`)
			escaped = strings.ReplaceAll(escaped, `"`, `\"`)
			escaped = strings.ReplaceAll(escaped, "\n", `\n`)
			escaped = strings.ReplaceAll(escaped, "\r", `\r`)
			valueStr = fmt.Sprintf("\"%s\"", escaped)
		case bool:
			valueStr = fmt.Sprintf("%t", val)
		case int:
			valueStr = fmt.Sprintf("%d", val)
		case float64:
			valueStr = formatFloatJS(val)
		case []customOption:
			valueStr = formatCustomOptions(val)
		case []interface{}:
			valueStr = formatCustomOptionArray(val)
		default:
			valueStr = fmt.Sprintf("%v", val)
		}
		keyStr := opt.key
		if strings.Contains(opt.key, ".") || (len(opt.key) > 0 && opt.key[0] >= '0' && opt.key[0] <= '9') {
			keyStr = fmt.Sprintf("\"%s\"", opt.key)
		}
		parts = append(parts, fmt.Sprintf("%s: %s", keyStr, valueStr))
	}
	
	return "{ " + strings.Join(parts, ", ") + " }"
}

// formatFloatJS formats a float64 the way JavaScript's Number.prototype.toString() does:
// scientific notation for |v| < 1e-6 or |v| >= 1e21, fixed-point otherwise.
func formatFloatJS(v float64) string {
	if v == 0 {
		return "0"
	}
	// JavaScript uses fixed-point for 1e-6 <= |v| < 1e21
	abs := v
	if abs < 0 {
		abs = -abs
	}
	if abs < 1e-6 || abs >= 1e21 {
		// Use Go 'e' format then adjust to JS style:
		// Go: 1e-20 → "1e-20", 1.23e-15 → "1.23e-15" — these match JS
		// But Go uses lowercase 'e' which JS also does, and Go omits '+' for negative exp.
		// For positive exponent, JS uses 'e+', Go 'e' format also does.
		s := strconv.FormatFloat(v, 'e', -1, 64)
		// Go's 'e' format uses e+00 / e-00 with at least 2 digits for exponent,
		// but JS uses minimal digits. Remove leading zeros from exponent.
		if idx := strings.Index(s, "e"); idx >= 0 {
			expPart := s[idx+1:] // e.g. "+021" or "-020" or "+07"
			sign := expPart[0]   // '+' or '-'
			digits := strings.TrimLeft(expPart[1:], "0")
			if digits == "" {
				digits = "0"
			}
			if sign == '-' {
				s = s[:idx] + "e-" + digits
			} else {
				s = s[:idx] + "e+" + digits
			}
		}
		return s
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// formatCustomOptionArray formats a []interface{} as a TypeScript array literal
func formatCustomOptionArray(vals []interface{}) string {
	var elems []string
	for _, v := range vals {
		switch val := v.(type) {
		case string:
			escaped := strings.ReplaceAll(val, `\`, `\\`)
			escaped = strings.ReplaceAll(escaped, `"`, `\"`)
			escaped = strings.ReplaceAll(escaped, "\n", `\n`)
			escaped = strings.ReplaceAll(escaped, "\r", `\r`)
			elems = append(elems, fmt.Sprintf("\"%s\"", escaped))
		case bool:
			elems = append(elems, fmt.Sprintf("%t", val))
		case int:
			elems = append(elems, fmt.Sprintf("%d", val))
		case float64:
			elems = append(elems, formatFloatJS(val))
		case []customOption:
			elems = append(elems, formatCustomOptions(val))
		default:
			elems = append(elems, fmt.Sprintf("%v", v))
		}
	}
	return "[" + strings.Join(elems, ", ") + "]"
}

// getLeadingDetachedComments retrieves leading detached comments for a given path in SourceCodeInfo
// Leading detached comments are comments separated from the element by a blank line
func (g *generator) getLeadingDetachedComments(path []int32) []string {
	if g.file.SourceCodeInfo == nil {
		return nil
	}
	for _, loc := range g.file.SourceCodeInfo.Location {
		if len(loc.Path) != len(path) {
			continue
		}
		match := true
		for i := range path {
			if loc.Path[i] != path[i] {
				match = false
				break
			}
		}
		if match && len(loc.LeadingDetachedComments) > 0 {
			var result []string
			for _, comment := range loc.LeadingDetachedComments {
				// Process each detached comment
				// Don't trim trailing newlines - they represent // blank lines in the proto
				// Just trim trailing spaces/tabs from the last line
				comment = strings.TrimRight(comment, " \t")
				// Strip one leading space from each line (protobuf convention)
				lines := strings.Split(comment, "\n")
				for i, line := range lines {
					line = strings.TrimRight(line, " \t")
					if line == "" {
						lines[i] = ""
					} else if strings.HasPrefix(line, " ") {
						lines[i] = line[1:]
					} else {
						lines[i] = line
					}
				}
				result = append(result, strings.Join(lines, "\n"))
			}
			return result
		}
	}
	return nil
}

// getLeadingComments retrieves leading comments for a given path in SourceCodeInfo
func (g *generator) getLeadingComments(path []int32) string {
	if g.file.SourceCodeInfo == nil {
		return ""
	}
	for _, loc := range g.file.SourceCodeInfo.Location {
		if len(loc.Path) != len(path) {
			continue
		}
		match := true
		for i := range path {
			if loc.Path[i] != path[i] {
				match = false
				break
			}
		}
		if match && loc.LeadingComments != nil {
			comment := *loc.LeadingComments
			// Check if original comment ends with blank line before trimming
			hasTrailingBlank := strings.HasSuffix(comment, "\n\n") || strings.HasSuffix(comment, "\n \n")
			
			// Don't trim the start - we need to preserve leading empty lines
			comment = strings.TrimRight(comment, " \t\n")
			// Strip one leading space from each line (protobuf convention)
			lines := strings.Split(comment, "\n")
			for i, line := range lines {
				line = strings.TrimRight(line, " \t")
				if line == "" {
					lines[i] = "" // Keep empty for blank comment lines
				} else if strings.HasPrefix(line, " ") {
					lines[i] = line[1:]
				} else {
					lines[i] = line
				}
			}
			result := strings.Join(lines, "\n")
			// Add marker if original had trailing blank
			if hasTrailingBlank {
				result += "\n__HAS_TRAILING_BLANK__"
			}
			return result
		}
	}
	return ""
}

// getTrailingComments retrieves trailing comments for a given path in SourceCodeInfo
func (g *generator) getTrailingComments(path []int32) string {
	if g.file.SourceCodeInfo == nil {
		return ""
	}
	for _, loc := range g.file.SourceCodeInfo.Location {
		if len(loc.Path) != len(path) {
			continue
		}
		match := true
		for i := range path {
			if loc.Path[i] != path[i] {
				match = false
				break
			}
		}
		if match && loc.TrailingComments != nil {
			comment := *loc.TrailingComments
			comment = strings.TrimSpace(comment)
			// Strip one leading space from each line (protobuf convention)
			lines := strings.Split(comment, "\n")
			for i, line := range lines {
				line = strings.TrimRight(line, " \t")
				if line == "" {
					lines[i] = ""
				} else if strings.HasPrefix(line, " ") {
					lines[i] = line[1:]
				} else {
					lines[i] = line
				}
			}
			return strings.Join(lines, "\n")
		}
	}
	return ""
}

// getEnumTrailingComments retrieves trailing comments for an enum, preserving trailing blank info
func (g *generator) getEnumTrailingComments(path []int32) string {
	if g.file.SourceCodeInfo == nil {
		return ""
	}
	for _, loc := range g.file.SourceCodeInfo.Location {
		if len(loc.Path) != len(path) {
			continue
		}
		match := true
		for i := range path {
			if loc.Path[i] != path[i] {
				match = false
				break
			}
		}
		if match && loc.TrailingComments != nil {
			comment := *loc.TrailingComments
			hasTrailingBlank := strings.HasSuffix(comment, "\n\n") || strings.HasSuffix(comment, "\n \n")
			comment = strings.TrimRight(comment, " \t\n")
			lines := strings.Split(comment, "\n")
			for i, line := range lines {
				line = strings.TrimRight(line, " \t")
				if line == "" {
					lines[i] = ""
				} else if strings.HasPrefix(line, " ") {
					lines[i] = line[1:]
				} else {
					lines[i] = line
				}
			}
			result := strings.Join(lines, "\n")
			if hasTrailingBlank {
				result += "\n__HAS_TRAILING_BLANK__"
			}
			return result
		}
	}
	return ""
}

// detectTypeNameCollisions scans all messages and enums to detect naming collisions
// and assigns numeric suffixes ($1, $2, etc.) where needed
func (g *generator) detectTypeNameCollisions() {
	// Map from TypeScript name to list of full proto names that generate it
	tsNameToProtoNames := make(map[string][]string)
	
	// Collect all type names (messages and enums)
	for _, msg := range g.file.MessageType {
		g.collectMessageTypeNames(msg, "", "", tsNameToProtoNames)
	}
	for _, enum := range g.file.EnumType {
		g.collectEnumTypeNames(enum, "", "", tsNameToProtoNames)
	}
	
	// Assign numeric suffixes for collisions
	for _, protoNames := range tsNameToProtoNames {
		if len(protoNames) > 1 {
			// Collision detected! Assign numeric suffixes
			// First occurrence gets 0 (no suffix), subsequent get 1, 2, 3, etc.
			for i, protoName := range protoNames {
				if i == 0 {
					g.typeNameSuffixes[protoName] = 0 // No suffix
				} else {
					g.typeNameSuffixes[protoName] = i // $1, $2, etc.
				}
			}
		}
	}
}

// collectMessageTypeNames recursively collects all message type names
func (g *generator) collectMessageTypeNames(msg *descriptorpb.DescriptorProto, parentPrefix string, protoParentPrefix string, tsNameToProtoNames map[string][]string) {
	// Skip map entry messages
	if msg.Options != nil && msg.GetOptions().GetMapEntry() {
		return
	}
	
	baseName := msg.GetName()
	escapedName := baseName
	if parentPrefix == "" {
		escapedName = escapeTypescriptKeyword(baseName)
	}
	
	tsName := parentPrefix + escapedName
	protoName := protoParentPrefix + baseName
	
	// Build full proto name for tracking
	pkgPrefix := ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	fullProtoName := pkgPrefix + protoName
	
	// Add to map
	tsNameToProtoNames[tsName] = append(tsNameToProtoNames[tsName], fullProtoName)
	
	// Recurse into nested messages
	for _, nested := range msg.NestedType {
		g.collectMessageTypeNames(nested, tsName + "_", protoName + ".", tsNameToProtoNames)
	}
	
	// Recurse into nested enums
	for _, enum := range msg.EnumType {
		g.collectEnumTypeNames(enum, tsName + "_", protoName + ".", tsNameToProtoNames)
	}
}

// collectEnumTypeNames recursively collects all enum type names
func (g *generator) collectEnumTypeNames(enum *descriptorpb.EnumDescriptorProto, parentPrefix string, protoParentPrefix string, tsNameToProtoNames map[string][]string) {
	baseName := enum.GetName()
	escapedName := baseName
	if parentPrefix == "" {
		escapedName = escapeTypescriptKeyword(baseName)
	}
	
	tsName := parentPrefix + escapedName
	protoName := protoParentPrefix + baseName
	
	// Build full proto name for tracking
	pkgPrefix := ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	fullProtoName := pkgPrefix + protoName
	
	// Add to map
	tsNameToProtoNames[tsName] = append(tsNameToProtoNames[tsName], fullProtoName)
}


func generateFile(file *descriptorpb.FileDescriptorProto, allFiles []*descriptorpb.FileDescriptorProto, params params, isImportedByService bool) string {
	// Skip files that have no messages, enums, or services (e.g., files with only extension definitions)
	if len(file.MessageType) == 0 && len(file.EnumType) == 0 && len(file.Service) == 0 {
		return ""
	}
	
	g := &generator{
		params:              params,
		file:                file,
		allFiles:            allFiles,
		isImportedByService: isImportedByService,
		importedTypeNames:   make(map[string]bool),
		typeNameSuffixes:    make(map[string]int),
		localTypeNames:      make(map[string]bool),
		importAliases:       make(map[string]string),
	}
	
	// Detect type name collisions and assign numeric suffixes
	g.detectTypeNameCollisions()

	// Header
	g.pNoIndent("// @generated by protobuf-ts 2.11.1 with parameter long_type_%s", params.longType)
	pkgComment := ""
	syntax := file.GetSyntax()
	if syntax == "" {
		syntax = "proto2" // Default to proto2 when syntax is not specified
	}
	if file.Package != nil && *file.Package != "" {
		pkgComment = fmt.Sprintf(" (package \"%s\", syntax %s)", *file.Package, syntax)
	} else {
		pkgComment = fmt.Sprintf(" (syntax %s)", syntax)
	}
	g.pNoIndent("// @generated from protobuf file \"%s\"%s", file.GetName(), pkgComment)
	g.pNoIndent("// tslint:disable")
	// Add file-level deprecation comment if the entire file is deprecated
	if g.isFileDeprecated() {
		g.pNoIndent("// @deprecated")
	}
	
	// Add file-level leading detached comments (license headers, etc.)
	// These are typically attached to the syntax declaration (field 12)
	if file.SourceCodeInfo != nil {
		for _, loc := range file.SourceCodeInfo.Location {
			// Check for syntax field with detached comments
			if len(loc.Path) == 1 && loc.Path[0] == 12 && len(loc.LeadingDetachedComments) > 0 {
				// Blank line before the license header
				g.pNoIndent("//")
				for blockIdx, detached := range loc.LeadingDetachedComments {
					// Don't use TrimSpace - it removes trailing newlines which represent blank // lines
					// Just check if the comment has any non-whitespace content
					if strings.TrimSpace(detached) != "" {
						// Split by newline (keeping trailing empty strings for blank lines)
						lines := strings.Split(detached, "\n")
						// Check if last line is empty (trailing newline case)
						hasTrailingNewline := len(lines) > 0 && lines[len(lines)-1] == ""
						// Output all lines except the trailing empty one (we'll handle it separately)
						endIdx := len(lines)
						if hasTrailingNewline {
							endIdx = len(lines) - 1
						}
						for i := 0; i < endIdx; i++ {
							line := lines[i]
							line = strings.TrimRight(line, " \t")
							if line == "" {
								g.pNoIndent("//")
							} else {
								// Strip one leading space if present (protobuf convention)
								if strings.HasPrefix(line, " ") {
									line = line[1:]
								}
								g.pNoIndent("// %s", line)
							}
						}
						// If block has trailing newline, output it
						if hasTrailingNewline {
							g.pNoIndent("//")
						}
						// Add // separator between blocks (not after last block)
						if blockIdx < len(loc.LeadingDetachedComments)-1 {
							g.pNoIndent("//")
						}
					}
				}
			}
		}
	}

	// Add package-level leading detached comments (path [2])
	if file.SourceCodeInfo != nil {
		for _, loc := range file.SourceCodeInfo.Location {
			if len(loc.Path) == 1 && loc.Path[0] == 2 && len(loc.LeadingDetachedComments) > 0 {
				g.pNoIndent("//")
				for blockIdx, detached := range loc.LeadingDetachedComments {
					if strings.TrimSpace(detached) != "" {
						lines := strings.Split(detached, "\n")
						hasTrailingNewline := len(lines) > 0 && lines[len(lines)-1] == ""
						endIdx := len(lines)
						if hasTrailingNewline {
							endIdx = len(lines) - 1
						}
						for i := 0; i < endIdx; i++ {
							line := lines[i]
							line = strings.TrimRight(line, " \t")
							if line == "" {
								g.pNoIndent("//")
							} else {
								if strings.HasPrefix(line, " ") {
									line = line[1:]
								}
								g.pNoIndent("// %s", line)
							}
						}
						if hasTrailingNewline {
							g.pNoIndent("//")
						}
						if blockIdx < len(loc.LeadingDetachedComments)-1 {
							g.pNoIndent("//")
						}
					}
				}
			}
		}
	}

	// Collect imports needed
	imports := g.collectImports(file)
	
	// Write imports
	g.writeImports(imports)

	// Output file-level leading detached comments (from first message)
	if len(file.MessageType) > 0 {
		firstMsgPath := []int32{4, 0}
		detachedComments := g.getLeadingDetachedComments(firstMsgPath)
		for blockIdx, comment := range detachedComments {
			// Trim trailing newline (it will be represented by // separator or blank line)
			comment = strings.TrimRight(comment, "\n")
			// Split by newline and output each line
			for _, line := range strings.Split(comment, "\n") {
				line = strings.TrimRight(line, " \t")
				if line == "" {
					g.pNoIndent("// ")
				} else {
					g.pNoIndent("// %s", line)
				}
			}
			// Add empty line separator between blocks (not after last block)
			if blockIdx < len(detachedComments)-1 {
				g.pNoIndent("")
			}
		}
		// Blank line after all blocks
		if len(detachedComments) > 0 {
			g.pNoIndent("")
		}
	}

	// Generate message interfaces (with nested types/enums)
	for msgIdx, msg := range file.MessageType {
		g.generateMessageInterface(msg, "", "", []int32{4, int32(msgIdx)})
	}

	// Generate top-level enums
	for enumIdx, enum := range file.EnumType {
		g.generateEnum(enum, "", "", []int32{5, int32(enumIdx)})
	}

	// Generate message implementation classes
	for _, msg := range file.MessageType {
		g.generateMessageClass(msg, "", "")
	}

	// Generate services
	for _, svc := range file.Service {
		g.generateService(svc)
	}

	return g.b.String()
}

func (g *generator) collectUsedTypes() (map[string]bool, []string) {
	usedInMessages := make(map[string]bool)
	usedInServices := make(map[string]bool)
	var messageFieldTypes []string
	var serviceTypes []string
	
	// Scan all messages for field types
	// Process in forward declaration order, fields in field number order
	// Then reverse the list to match TypeScript plugin's prepend behavior
	var scanMessage func(*descriptorpb.DescriptorProto)
	scanMessage = func(msg *descriptorpb.DescriptorProto) {
		// Sort fields by field number
		type fieldWithNumber struct {
			field *descriptorpb.FieldDescriptorProto
			number int32
		}
		var sortedFields []fieldWithNumber
		for _, field := range msg.Field {
			sortedFields = append(sortedFields, fieldWithNumber{field, field.GetNumber()})
		}
		// Sort by field number
		for i := 0; i < len(sortedFields); i++ {
			for j := i + 1; j < len(sortedFields); j++ {
				if sortedFields[i].number > sortedFields[j].number {
					sortedFields[i], sortedFields[j] = sortedFields[j], sortedFields[i]
				}
			}
		}
		
		// Process fields in field number order
		for _, f := range sortedFields {
			field := f.field
			if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE ||
				field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM {
				typeName := field.GetTypeName()
				// For map fields, register the value type (not the entry type)
				// at the position of the map field itself
				if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
					entryMsg := g.findMessageType(typeName)
					if entryMsg != nil && entryMsg.Options != nil && entryMsg.GetOptions().GetMapEntry() {
						// Extract the value field (field number 2) type
						for _, entryField := range entryMsg.Field {
							if entryField.GetNumber() == 2 &&
								(entryField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE ||
									entryField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM) {
								valType := entryField.GetTypeName()
								if !usedInMessages[valType] {
									usedInMessages[valType] = true
									messageFieldTypes = append(messageFieldTypes, valType)
								}
							}
						}
						continue
					}
				}
				if !usedInMessages[typeName] {
					usedInMessages[typeName] = true
					messageFieldTypes = append(messageFieldTypes, typeName)
				}
			}
		}
		for _, nested := range msg.NestedType {
			// Skip map entry messages — their value types are handled inline above
			if nested.Options != nil && nested.GetOptions().GetMapEntry() {
				continue
			}
			scanMessage(nested)
		}
	}
	
	// Process messages in forward order
	for i := 0; i < len(g.file.MessageType); i++ {
		scanMessage(g.file.MessageType[i])
	}
	
	// Scan services for method input/output types (in forward method order for imports)
	for _, service := range g.file.Service {
		for i := 0; i < len(service.Method); i++ {
			method := service.Method[i]
			// Add output type first (matches protobuf-ts ordering within each method)
			outputType := method.GetOutputType()
			if outputType != "" && !usedInServices[outputType] {
				usedInServices[outputType] = true
				serviceTypes = append(serviceTypes, outputType)
			}
			// Add input type second
			inputType := method.GetInputType()
			if inputType != "" && !usedInServices[inputType] {
				usedInServices[inputType] = true
				serviceTypes = append(serviceTypes, inputType)
			}
		}
	}
	
	// Reverse messageFieldTypes to match TypeScript plugin's prepend behavior
	// TypeScript plugin adds imports at the top (prepends), so last encountered appears first
	for i, j := 0, len(messageFieldTypes)-1; i < j; i, j = i+1, j-1 {
		messageFieldTypes[i], messageFieldTypes[j] = messageFieldTypes[j], messageFieldTypes[i]
	}
	
	// For service-only files, reverse per-method-pair order to match protobuf-ts's
	// prepend semantics: later methods appear first, but within each method
	// output stays above input. Collect per-method type pairs, reverse the pairs,
	// then flatten. For files with messages, keep forward order (output, input).
	if len(g.file.MessageType) == 0 && len(serviceTypes) > 0 {
		// Re-collect as per-method pairs so we can reverse method order
		var methodPairs [][]string
		usedInServices2 := make(map[string]bool)
		for _, service := range g.file.Service {
			for i := 0; i < len(service.Method); i++ {
				method := service.Method[i]
				var pair []string
				outputType := method.GetOutputType()
				if outputType != "" && !usedInServices2[outputType] {
					usedInServices2[outputType] = true
					pair = append(pair, outputType)
				}
				inputType := method.GetInputType()
				if inputType != "" && !usedInServices2[inputType] {
					usedInServices2[inputType] = true
					pair = append(pair, inputType)
				}
				if len(pair) > 0 {
					methodPairs = append(methodPairs, pair)
				}
			}
		}
		// Reverse method pair order (last method's types appear first)
		for i, j := 0, len(methodPairs)-1; i < j; i, j = i+1, j-1 {
			methodPairs[i], methodPairs[j] = methodPairs[j], methodPairs[i]
		}
		serviceTypes = nil
		for _, pair := range methodPairs {
			serviceTypes = append(serviceTypes, pair...)
		}
	}
	
	// Build final ordered list:
	// 1. Service-only types (not used in message fields) - these go BEFORE ServiceType
	// 2. Message field types (even if also used in services) - these go AFTER runtime imports
	var orderedTypes []string
	used := make(map[string]bool)
	
	// First add service-only types
	for _, typeName := range serviceTypes {
		if !usedInMessages[typeName] {
			orderedTypes = append(orderedTypes, typeName)
			used[typeName] = true
		}
	}
	
	// Then add message field types in reversed order (to match TypeScript prepend)
	for _, typeName := range messageFieldTypes {
		if !used[typeName] {
			orderedTypes = append(orderedTypes, typeName)
			used[typeName] = true
		}
	}
	
	return used, orderedTypes
}

func (g *generator) collectImports(file *descriptorpb.FileDescriptorProto) map[string]bool {
	imports := make(map[string]bool)
	
	// Always need runtime imports for messages
	if len(file.MessageType) > 0 {
		imports["@protobuf-ts/runtime"] = true
	}
	
	// Check for dependencies (other proto files)
	for _, dep := range file.Dependency {
		if strings.Contains(dep, "google/protobuf/") {
			// Well-known types
			imports["./" + strings.TrimSuffix(filepath.Base(dep), ".proto")] = true
		} else {
			imports["./" + strings.TrimSuffix(filepath.Base(dep), ".proto")] = true
		}
	}
	
	return imports
}

func (g *generator) writeImports(imports map[string]bool) {
	// Collect local type names for collision detection
	g.collectLocalTypeNames()

	// Collect used types - service-only types first, then message field types
	usedTypes, orderedTypes := g.collectUsedTypes()
	
	// Build a map from dependency path to file for quick lookup
	depFiles := make(map[string]*descriptorpb.FileDescriptorProto)
	currentFileDir := filepath.Dir(g.file.GetName())
	
	for _, dep := range g.file.Dependency {
		depFile := g.findFileByName(dep)
		if depFile != nil {
			// Compute relative path from current file to dependency
			depPath := strings.TrimSuffix(dep, ".proto")
			relPath := g.getRelativeImportPath(currentFileDir, depPath)
			depFiles[relPath] = depFile
		}
	}
	
	// Helper to generate import statement for a type
	generateImport := func(typeName string) string {
		if !usedTypes[typeName] {
			return ""
		}
		
		// Find which dependency this type belongs to
		typeNameStripped := strings.TrimPrefix(typeName, ".")
		var matchedDepFile *descriptorpb.FileDescriptorProto
		var matchedImportPath string
		
		// First, find all files matching the package
		var candidateFiles []*struct {
			file *descriptorpb.FileDescriptorProto
			path string
		}
		for importPath, depFile := range depFiles {
			depPkg := ""
			if depFile.Package != nil {
				depPkg = *depFile.Package
			}
			if depPkg == "" || strings.HasPrefix(typeNameStripped, depPkg+".") {
				candidateFiles = append(candidateFiles, &struct {
					file *descriptorpb.FileDescriptorProto
					path string
				}{depFile, importPath})
			}
		}
		
		if len(candidateFiles) == 0 {
			return ""
		}
		
		// If multiple files have the same package, we need to find which one contains the type
		if len(candidateFiles) == 1 {
			matchedDepFile = candidateFiles[0].file
			matchedImportPath = candidateFiles[0].path
		} else {
			// Check each candidate to find which one contains the type
			for _, candidate := range candidateFiles {
				depPkg := ""
				if candidate.file.Package != nil {
					depPkg = *candidate.file.Package
				}
				parts := strings.Split(strings.TrimPrefix(typeNameStripped, depPkg+"."), ".")
				
				// Check if this file contains the type
				found := false
				
				// Check top-level enums
				for _, enum := range candidate.file.EnumType {
					if enum.GetName() == parts[0] && len(parts) == 1 {
						found = true
						break
					}
				}
				
				// Check doubly-nested messages (Outer.Middle.Inner)
				if !found && len(parts) == 3 {
					for _, msg := range candidate.file.MessageType {
						if msg.GetName() == parts[0] {
							for _, nested := range msg.NestedType {
								if nested.GetName() == parts[1] {
									for _, innerNested := range nested.NestedType {
										if innerNested.GetName() == parts[2] {
											found = true
											break
										}
									}
									if found {
										break
									}
								}
							}
							if found {
								break
							}
						}
					}
				}
				
				// Check doubly-nested enums (Outer.Middle.EnumValue)
				if !found && len(parts) == 3 {
					for _, msg := range candidate.file.MessageType {
						if msg.GetName() == parts[0] {
							for _, nested := range msg.NestedType {
								if nested.GetName() == parts[1] {
									for _, enum := range nested.EnumType {
										if enum.GetName() == parts[2] {
											found = true
											break
										}
									}
									if found {
										break
									}
								}
							}
							if found {
								break
							}
						}
					}
				}
				
				// Check nested enums
				if !found && len(parts) == 2 {
					for _, msg := range candidate.file.MessageType {
						if msg.GetName() == parts[0] {
							for _, enum := range msg.EnumType {
								if enum.GetName() == parts[1] {
									found = true
									break
								}
							}
							if found {
								break
							}
						}
					}
				}
				
				// Check nested messages
				if !found && len(parts) == 2 {
					for _, msg := range candidate.file.MessageType {
						if msg.GetName() == parts[0] {
							for _, nested := range msg.NestedType {
								if nested.GetName() == parts[1] {
									found = true
									break
								}
							}
							if found {
								break
							}
						}
					}
				}
				
				// Check top-level messages
				if !found {
					for _, msg := range candidate.file.MessageType {
						if msg.GetName() == parts[0] {
							found = true
							break
						}
					}
				}
				
				if found {
					matchedDepFile = candidate.file
					matchedImportPath = candidate.path
					break
				}
			}
		}
		
		if matchedDepFile == nil {
			return ""
		}
		
		// Extract the type from this dependency
		depPkg := ""
		if matchedDepFile.Package != nil {
			depPkg = *matchedDepFile.Package
		}
		parts := strings.Split(strings.TrimPrefix(typeNameStripped, depPkg+"."), ".")
		
		var importStmt string
		var importedName string
		
		// Check if it's a top-level enum
		found := false
		for _, enum := range matchedDepFile.EnumType {
			if enum.GetName() == parts[0] && len(parts) == 1 {
				importedName = escapeTypescriptKeyword(enum.GetName())
				importStmt = fmt.Sprintf("import { %s } from \"%s\";", importedName, matchedImportPath)
				found = true
				break
			}
		}
		if !found && len(parts) == 3 {
			// Check if it's a doubly-nested message (Outer.Middle.Inner)
			for _, msg := range matchedDepFile.MessageType {
				if msg.GetName() == parts[0] {
					for _, nested := range msg.NestedType {
						if nested.GetName() == parts[1] {
							for _, innerNested := range nested.NestedType {
								if innerNested.GetName() == parts[2] {
									importedName = fmt.Sprintf("%s_%s_%s", parts[0], parts[1], parts[2])
									importStmt = fmt.Sprintf("import { %s } from \"%s\";", importedName, matchedImportPath)
									found = true
									break
								}
							}
							if found {
								break
							}
						}
					}
					if found {
						break
					}
				}
			}
		}
		if !found && len(parts) == 3 {
			// Check if it's a doubly-nested enum (Outer.Middle.Enum)
			for _, msg := range matchedDepFile.MessageType {
				if msg.GetName() == parts[0] {
					for _, nested := range msg.NestedType {
						if nested.GetName() == parts[1] {
							for _, enum := range nested.EnumType {
								if enum.GetName() == parts[2] {
									importedName = fmt.Sprintf("%s_%s_%s", parts[0], parts[1], parts[2])
									importStmt = fmt.Sprintf("import { %s } from \"%s\";", importedName, matchedImportPath)
									found = true
									break
								}
							}
							if found {
								break
							}
						}
					}
					if found {
						break
					}
				}
			}
		}
		if !found && len(parts) == 2 {
			// Check if it's a nested enum (Message.Enum)
			for _, msg := range matchedDepFile.MessageType {
				if msg.GetName() == parts[0] {
					for _, enum := range msg.EnumType {
						if enum.GetName() == parts[1] {
							importedName = fmt.Sprintf("%s_%s", parts[0], parts[1])
							importStmt = fmt.Sprintf("import { %s } from \"%s\";", importedName, matchedImportPath)
							found = true
							break
						}
					}
					if found {
						break
					}
				}
			}
		}
		if !found && len(parts) == 2 {
			// Check if it's a nested message (Message.Nested)
			for _, msg := range matchedDepFile.MessageType {
				if msg.GetName() == parts[0] {
					for _, nested := range msg.NestedType {
						if nested.GetName() == parts[1] {
							importedName = fmt.Sprintf("%s_%s", parts[0], parts[1])
							importStmt = fmt.Sprintf("import { %s } from \"%s\";", importedName, matchedImportPath)
							found = true
							break
						}
					}
					if found {
						break
					}
				}
			}
		}
		if !found {
			// Must be a top-level message
			for _, msg := range matchedDepFile.MessageType {
				if msg.GetName() == parts[0] {
					importedName = escapeTypescriptKeyword(msg.GetName())
					importStmt = fmt.Sprintf("import { %s } from \"%s\";", importedName, matchedImportPath)
					break
				}
			}
		}
		
		// Check for name collision with local types and create alias if needed
		if importedName != "" {
			// If already imported (same type from same file), return existing import
			if _, alreadyAliased := g.importAliases[typeName]; alreadyAliased {
				return importStmt
			}
			if g.importedTypeNames[importedName] {
				// Already imported with the same name — check it's from same source
				return importStmt
			}
			// Check collision with local type names only
			if g.localTypeNames[importedName] {
				// Name collision with local type — create alias with '$' suffix
				taken := make(map[string]bool)
				for k := range g.localTypeNames {
					taken[k] = true
				}
				for k := range g.importedTypeNames {
					taken[k] = true
				}
				alias := importedName + "$"
				i := 0
				for taken[alias] {
					i++
					alias = importedName + "$" + fmt.Sprintf("%d", i+1)
				}
				importStmt = fmt.Sprintf("import { %s as %s } from \"%s\";", importedName, alias, matchedImportPath)
				g.importAliases[typeName] = alias
				g.importedTypeNames[alias] = true
			} else {
				g.importedTypeNames[importedName] = true
			}
		}
		
		return importStmt
	}
	
	// Determine which types are service-only (imported before ServiceType)
	// vs message-field types (imported after MessageType)
	usedInMessages := make(map[string]bool)
	var scanMessage func(*descriptorpb.DescriptorProto)
	scanMessage = func(msg *descriptorpb.DescriptorProto) {
		for _, field := range msg.Field {
			if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE ||
				field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM {
				usedInMessages[field.GetTypeName()] = true
			}
		}
		for _, nested := range msg.NestedType {
			scanMessage(nested)
		}
	}
	for _, msg := range g.file.MessageType {
		scanMessage(msg)
	}
	
	// Phase 1: Import service-only external types (before ServiceType)
	seenImports := make(map[string]bool)
	for _, typeName := range orderedTypes {
		// Skip if used in messages (will be imported later)
		if usedInMessages[typeName] {
			continue
		}
		// Skip if it's defined in the current file (not external)
		if g.isLocalType(typeName) {
			continue
		}
		importStmt := generateImport(typeName)
		if importStmt != "" && !seenImports[importStmt] {
			g.pNoIndent("%s", importStmt)
			seenImports[importStmt] = true
		}
	}
	
	// Check if we need ServiceType import
	needsServiceType := len(g.file.Service) > 0
	
	// Check if service comes before messages in the file
	// The WireType import position depends on source order in certain cases
	serviceBeforeMessages := false
	if needsServiceType && len(g.file.MessageType) > 0 {
		// Service is field 6, MessageType is field 4 in FileDescriptorProto
		// Check source code info to see which appears first
		if g.file.SourceCodeInfo != nil {
			firstServiceLine := int32(999999)
			firstMessageLine := int32(999999)
			
			// First pass: find service and message line numbers
			messageLines := make(map[int]int32)
			
			for _, loc := range g.file.SourceCodeInfo.Location {
				// Service definition: path [6, index]
				if len(loc.Path) >= 2 && loc.Path[0] == 6 && loc.Span != nil && len(loc.Span) > 0 {
					if loc.Span[0] < firstServiceLine {
						firstServiceLine = loc.Span[0]
					}
				}
				// Message definition: path [4, index]
				if len(loc.Path) == 2 && loc.Path[0] == 4 && loc.Span != nil && len(loc.Span) > 0 {
					msgIdx := int(loc.Path[1])
					msgLine := loc.Span[0]
					messageLines[msgIdx] = msgLine
					if msgLine < firstMessageLine {
						firstMessageLine = msgLine
					}
				}
			}
			
			// Second pass: determine which messages are before the service
			messagesBeforeService := make(map[int]bool)
			for msgIdx, msgLine := range messageLines {
				messagesBeforeService[msgIdx] = msgLine < firstServiceLine
			}
			
			// WireType comes right after ServiceType if:
			// 1. Service comes before the first message AND file has many messages (>10), OR
			// 2. All messages before the service have zero actual fields (are truly empty)
			if firstServiceLine < firstMessageLine && len(g.file.MessageType) > 10 {
				serviceBeforeMessages = true
			} else {
				// Check if all messages before service are empty
				allBeforeAreEmpty := true
				countBefore := 0
				for msgIdx, beforeService := range messagesBeforeService {
					if beforeService {
						countBefore++
						if msgIdx < len(g.file.MessageType) {
							msg := g.file.MessageType[msgIdx]
							// Count actual fields (skip reserved, skip map entry messages)
							hasActualFields := false
							if msg.Options == nil || !msg.GetOptions().GetMapEntry() {
								for _, field := range msg.Field {
									// Skip GROUP type fields
									if field.GetType() != descriptorpb.FieldDescriptorProto_TYPE_GROUP {
										hasActualFields = true
										break
									}
								}
							}
							if hasActualFields {
								allBeforeAreEmpty = false
								break
							}
						}
					}
				}
				serviceBeforeMessages = allBeforeAreEmpty && countBefore > 0
			}
		}
	}
	
	// Check if this is google.protobuf.Timestamp, Duration, FieldMask, Struct, or Any for special imports
	isTimestamp := false
	isDuration := false
	isFieldMask := false
	isStruct := false
	isAny := false
	isWrapper := false // For Int32Value, StringValue, etc.
	if g.file.Package != nil && *g.file.Package == "google.protobuf" {
		for _, msg := range g.file.MessageType {
			name := msg.GetName()
			if name == "Timestamp" {
				isTimestamp = true
			} else if name == "Duration" {
				isDuration = true
			} else if name == "FieldMask" {
				isFieldMask = true
			} else if name == "Struct" || name == "Value" || name == "ListValue" {
				isStruct = true
			} else if name == "Any" {
				isAny = true
			} else if strings.HasSuffix(name, "Value") { // Int32Value, StringValue, etc.
				isWrapper = true
			}
		}
	}
	
	// Import ServiceType if needed (before Phase 2 imports)
	if needsServiceType {
		g.pNoIndent("import { ServiceType } from \"@protobuf-ts/runtime-rpc\";")
	}
	
	// Phase 2: Standard runtime imports if we have messages
	if len(g.file.MessageType) > 0 {
		// Check if any message (including nested) has actual fields (not just GROUP fields)
		hasAnyFields := false
		var checkMessageForFields func(*descriptorpb.DescriptorProto) bool
		checkMessageForFields = func(msg *descriptorpb.DescriptorProto) bool {
			// Skip map entry messages
			if msg.Options != nil && msg.GetOptions().GetMapEntry() {
				return false
			}
			// Check direct fields
			for _, field := range msg.Field {
				if field.GetType() != descriptorpb.FieldDescriptorProto_TYPE_GROUP {
					return true
				}
			}
			// Check nested messages
			for _, nested := range msg.NestedType {
				if checkMessageForFields(nested) {
					return true
				}
			}
			return false
		}
		
		for _, msg := range g.file.MessageType {
			if checkMessageForFields(msg) {
				hasAnyFields = true
				break
			}
		}
		
		// Determine if WireType comes early:
		// 1. File has service AND service comes before messages
		// 2. File has NO service BUT is imported by a service file in the same batch
		// 3. File has NO service AND first message is empty (no actual fields)
		wireTypeEarly := false
		wireTypeVeryLate := false // After UnknownFieldHandler
		if needsServiceType {
			wireTypeEarly = serviceBeforeMessages
		} else {
			// Check if first message is empty
			firstMessageEmpty := false
			if len(g.file.MessageType) > 0 {
				firstMsg := g.file.MessageType[0]
				actualFieldCount := 0
				for _, field := range firstMsg.Field {
					if field.GetType() != descriptorpb.FieldDescriptorProto_TYPE_GROUP {
						actualFieldCount++
					}
				}
				firstMessageEmpty = actualFieldCount == 0
			}
			wireTypeEarly = g.isImportedByService || firstMessageEmpty
		}
		
		// WireType goes after UnknownFieldHandler ("very late") when the first message's
		// InternalBinaryRead registers WireType (via scalarRepeated for repeated numeric/enum
		// fields). This happens when the first message with fields has at least one repeated
		// scalar/enum field that is not string/bytes.
		firstMsgHasRepeatedNumeric := false
		if len(g.file.MessageType) > 0 {
			firstMsg := g.file.MessageType[0]
			for _, field := range firstMsg.Field {
				if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_GROUP {
					continue
				}
				if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
					ft := field.GetType()
					if ft != descriptorpb.FieldDescriptorProto_TYPE_STRING &&
						ft != descriptorpb.FieldDescriptorProto_TYPE_BYTES &&
						ft != descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
						firstMsgHasRepeatedNumeric = true
						break
					}
				}
			}
		}
		if firstMsgHasRepeatedNumeric {
			wireTypeVeryLate = true
			wireTypeEarly = false
		}
		
		// Skip method-related imports when optimize_for = CODE_SIZE
		if !g.isOptimizeCodeSize() {
		// Add ScalarType and LongType for wrappers - must come first
		if isWrapper {
			g.pNoIndent("import { ScalarType } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import { LongType } from \"@protobuf-ts/runtime\";")
		}
		if hasAnyFields && wireTypeEarly {
			g.pNoIndent("import { WireType } from \"@protobuf-ts/runtime\";")
		}
		g.pNoIndent("import type { BinaryWriteOptions } from \"@protobuf-ts/runtime\";")
		g.pNoIndent("import type { IBinaryWriter } from \"@protobuf-ts/runtime\";")
		if hasAnyFields && !wireTypeEarly && !wireTypeVeryLate {
			g.pNoIndent("import { WireType } from \"@protobuf-ts/runtime\";")
		}
		// For Any, BinaryReadOptions comes later with JSON imports
		if !isAny {
			g.pNoIndent("import type { BinaryReadOptions } from \"@protobuf-ts/runtime\";")
		}
		g.pNoIndent("import type { IBinaryReader } from \"@protobuf-ts/runtime\";")
		g.pNoIndent("import { UnknownFieldHandler } from \"@protobuf-ts/runtime\";")
		if hasAnyFields && wireTypeVeryLate {
			g.pNoIndent("import { WireType } from \"@protobuf-ts/runtime\";")
		}
		g.pNoIndent("import type { PartialMessage } from \"@protobuf-ts/runtime\";")
		g.pNoIndent("import { reflectionMergePartial } from \"@protobuf-ts/runtime\";")
		}
		
		// Add JSON imports for Timestamp
		if isTimestamp {
			g.pNoIndent("import { typeofJsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonReadOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonWriteOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import { PbLong } from \"@protobuf-ts/runtime\";")
		}
		
		// Add JSON imports for Duration
		if isDuration {
			g.pNoIndent("import { typeofJsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonReadOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonWriteOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import { PbLong } from \"@protobuf-ts/runtime\";")
		}
		
		// Add JSON imports for FieldMask
		if isFieldMask {
			g.pNoIndent("import { typeofJsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import { lowerCamelCase } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonReadOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonWriteOptions } from \"@protobuf-ts/runtime\";")
		}
		
		// Add JSON imports for Struct
		if isStruct {
			g.pNoIndent("import { isJsonObject } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import { typeofJsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonReadOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonWriteOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonObject } from \"@protobuf-ts/runtime\";")
		}
		
		// Add JSON imports for wrapper types
		if isWrapper {
			g.pNoIndent("import type { JsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonReadOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonWriteOptions } from \"@protobuf-ts/runtime\";")
		}
		
		// Add JSON imports for Any
		if isAny {
			g.pNoIndent("import { isJsonObject } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import { typeofJsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import { jsonWriteOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonReadOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonWriteOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { BinaryReadOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { IMessageType } from \"@protobuf-ts/runtime\";")
		}
		
		g.pNoIndent("import { MessageType } from \"@protobuf-ts/runtime\";")
	}
	
	// Phase 3: Import message field types and types used in both services and messages
	for _, typeName := range orderedTypes {
		// Skip if already imported (service-only)
		importStmt := generateImport(typeName)
		if importStmt == "" || seenImports[importStmt] {
			continue
		}
		// Skip local types
		if g.isLocalType(typeName) {
			continue
		}
		g.pNoIndent("%s", importStmt)
		seenImports[importStmt] = true
	}
}

func (g *generator) isLocalType(typeName string) bool {
	// Check if the type is defined in the current file
	typeNameStripped := strings.TrimPrefix(typeName, ".")
	currentPkg := ""
	if g.file.Package != nil {
		currentPkg = *g.file.Package
	}
	
	// If it doesn't start with current package, it's not local
	if !strings.HasPrefix(typeNameStripped, currentPkg+".") {
		return false
	}
	
	// Extract just the type name without package
	localName := strings.TrimPrefix(typeNameStripped, currentPkg+".")
	parts := strings.Split(localName, ".")
	
	// Check if it's a top-level message or enum
	for _, msg := range g.file.MessageType {
		if msg.GetName() == parts[0] {
			return true
		}
	}
	for _, enum := range g.file.EnumType {
		if enum.GetName() == parts[0] {
			return true
		}
	}
	
	return false
}

// collectLocalTypeNames populates g.localTypeNames with all TS names
// that are defined locally in this file (messages, enums, including nested).
// This is used to detect import name collisions.
func (g *generator) collectLocalTypeNames() {
	var collectMsg func(msg *descriptorpb.DescriptorProto, prefix string)
	collectMsg = func(msg *descriptorpb.DescriptorProto, prefix string) {
		name := prefix + msg.GetName()
		tsName := escapeTypescriptKeyword(name)
		// Check for typeNameSuffixes
		fullProtoName := ""
		if g.file.Package != nil && *g.file.Package != "" {
			fullProtoName = *g.file.Package + "." + strings.ReplaceAll(name, "_", ".")
		} else {
			fullProtoName = strings.ReplaceAll(name, "_", ".")
		}
		if suffix, exists := g.typeNameSuffixes[fullProtoName]; exists && suffix > 0 {
			tsName = tsName + fmt.Sprintf("$%d", suffix)
		}
		g.localTypeNames[tsName] = true
		for _, nested := range msg.NestedType {
			collectMsg(nested, name+"_")
		}
		for _, enum := range msg.EnumType {
			enumName := prefix + msg.GetName() + "_" + enum.GetName()
			g.localTypeNames[enumName] = true
		}
	}
	for _, msg := range g.file.MessageType {
		collectMsg(msg, "")
	}
	for _, enum := range g.file.EnumType {
		tsName := escapeTypescriptKeyword(enum.GetName())
		g.localTypeNames[tsName] = true
	}
}

func (g *generator) getRelativeImportPath(fromDir, toPath string) string {
	// If fromDir is empty (file at root), use simple ./ path
	if fromDir == "" || fromDir == "." {
		return "./" + toPath
	}
	
	// Handle same directory
	if fromDir == filepath.Dir(toPath) {
		return "./" + filepath.Base(toPath)
	}
	
	// Handle parent directory navigation
	fromParts := []string{}
	if fromDir != "" {
		fromParts = strings.Split(fromDir, "/")
	}
	toParts := strings.Split(toPath, "/")
	
	// Find common prefix length
	commonLen := 0
	minLen := len(fromParts)
	if len(toParts) < minLen {
		minLen = len(toParts)
	}
	for i := 0; i < minLen; i++ {
		if fromParts[i] == toParts[i] {
			commonLen++
		} else {
			break
		}
	}
	
	// Build relative path
	upCount := len(fromParts) - commonLen
	var result []string
	for i := 0; i < upCount; i++ {
		result = append(result, "..")
	}
	for i := commonLen; i < len(toParts); i++ {
		result = append(result, toParts[i])
	}
	
	if len(result) == 0 {
		return "./" + filepath.Base(toPath)
	}
	
	// Don't use ./ prefix when going up directories
	if upCount > 0 {
		return strings.Join(result, "/")
	}
	
	return "./" + strings.Join(result, "/")
}

func (g *generator) getImportPathForType(fullTypeName string) string {
	// fullTypeName starts with . (e.g., .lib.Void, .quirks.v1.TypesRequest)
	typeNameStripped := strings.TrimPrefix(fullTypeName, ".")
	
	// Helper to check if a type is defined in a file
	typeInFile := func(file *descriptorpb.FileDescriptorProto, typeName string) bool {
		pkg := ""
		if file.Package != nil {
			pkg = *file.Package
		}
		
		// Type must be in this file's package
		if pkg != "" && !strings.HasPrefix(typeName, pkg+".") {
			return false
		}
		
		// Strip package to get the type parts
		var parts []string
		if pkg == "" {
			parts = strings.Split(typeName, ".")
		} else {
			parts = strings.Split(strings.TrimPrefix(typeName, pkg+"."), ".")
		}
		
		// Check top-level messages
		for _, msg := range file.MessageType {
			if msg.GetName() == parts[0] {
				if len(parts) == 1 {
					return true
				}
				// Check nested types
				return g.typeInMessage(msg, parts[1:])
			}
		}
		
		// Check top-level enums
		for _, enum := range file.EnumType {
			if enum.GetName() == parts[0] && len(parts) == 1 {
				return true
			}
		}
		
		return false
	}
	
	// Check dependencies first
	currentFileDir := filepath.Dir(g.file.GetName())
	for _, dep := range g.file.Dependency {
		depFile := g.findFileByName(dep)
		if depFile != nil && typeInFile(depFile, typeNameStripped) {
			depPath := strings.TrimSuffix(dep, ".proto")
			return g.getRelativeImportPath(currentFileDir, depPath)
		}
	}
	
	// Check current file
	if typeInFile(g.file, typeNameStripped) {
		return "./" + strings.TrimSuffix(filepath.Base(g.file.GetName()), ".proto")
	}
	
	// Default to current file (should not happen)
	return "./" + strings.TrimSuffix(filepath.Base(g.file.GetName()), ".proto")
}

// typeInMessage checks if a nested type path exists in a message
func (g *generator) typeInMessage(msg *descriptorpb.DescriptorProto, parts []string) bool {
	if len(parts) == 0 {
		return false
	}
	
	// Check nested messages
	for _, nested := range msg.NestedType {
		if nested.GetName() == parts[0] {
			if len(parts) == 1 {
				return true
			}
			return g.typeInMessage(nested, parts[1:])
		}
	}
	
	// Check nested enums
	for _, enum := range msg.EnumType {
		if enum.GetName() == parts[0] && len(parts) == 1 {
			return true
		}
	}
	
	return false
}

func (g *generator) findFileByName(name string) *descriptorpb.FileDescriptorProto {
	for _, f := range g.allFiles {
		if f.GetName() == name {
			return f
		}
	}
	return nil
}

func (g *generator) generateMessageInterface(msg *descriptorpb.DescriptorProto, parentPrefix string, protoParentPrefix string, msgPath []int32) {
	// Skip map entry messages
	if msg.Options != nil && msg.GetOptions().GetMapEntry() {
		return
	}
	
	baseName := msg.GetName()
	// Only escape top-level types (nested types don't need escaping)
	escapedName := baseName
	if parentPrefix == "" {
		escapedName = escapeTypescriptKeyword(baseName)
	}
	fullName := parentPrefix + escapedName
	// For @generated comment, use original name not escaped
	protoName := protoParentPrefix + baseName
	
	// Check if this type has a collision suffix
	pkgPrefix := ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	fullProtoName := pkgPrefix + protoName
	if suffix, exists := g.typeNameSuffixes[fullProtoName]; exists && suffix > 0 {
		fullName = fullName + fmt.Sprintf("$%d", suffix)
	}
	
	// Output message-level detached comments (comments between messages)
	// Skip for first message - those are output as file-level comments after imports
	isFirstMessage := len(msgPath) == 2 && msgPath[0] == 4 && msgPath[1] == 0
	if len(msgPath) > 0 && !isFirstMessage {
		detachedComments := g.getLeadingDetachedComments(msgPath)
		if len(detachedComments) > 0 {
			// Output detached comments as // style BEFORE message JSDoc
			for idx, detached := range detachedComments {
				// Trim trailing newline (it will be represented by blank line or separator)
				detached = strings.TrimRight(detached, "\n")
				// Split by newline and output each line
				for _, line := range strings.Split(detached, "\n") {
					line = strings.TrimRight(line, " \t")
					if line == "" {
						// For message-level: blank lines within blocks are "// " (with space)
						g.pNoIndent("// ")
					} else {
						g.pNoIndent("// %s", line)
					}
				}
				// Add separator after detached comment block (except for last block)
				// For message-level: separator is a blank line (not "//")
				if idx < len(detachedComments)-1 {
					g.pNoIndent("")
				}
			}
			// Add blank line after all detached comments, before JSDoc
			g.pNoIndent("")
		}
	}
	
	// Message interface first
	g.pNoIndent("/**")
	
	// Add leading and trailing comments if available (msgPath should point to this message)
	if len(msgPath) > 0 {
		leadingComments := g.getLeadingComments(msgPath)
		trailingComments := g.getEnumTrailingComments(msgPath)
		
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(leadingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.pNoIndent(" *")
				} else {
					g.pNoIndent(" * %s", escapeJSDocComment(line))
				}
			}
			// Add separator blank line(s)
			if hasTrailingBlank {
				g.pNoIndent(" *")
				g.pNoIndent(" *")
			} else {
				g.pNoIndent(" *")
			}
		}
		
		if trailingComments != "" {
			hasTrailingBlank := strings.HasSuffix(trailingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				trailingComments = strings.TrimSuffix(trailingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(trailingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.pNoIndent(" *")
				} else {
					g.pNoIndent(" * %s", escapeJSDocComment(line))
				}
			}
			if hasTrailingBlank {
				g.pNoIndent(" *")
				g.pNoIndent(" *")
			} else {
				g.pNoIndent(" *")
			}
		}
	}
	
	// Add @deprecated if message has deprecated option OR file is deprecated
	if (msg.Options != nil && msg.GetOptions().GetDeprecated()) || g.isFileDeprecated() {
		g.pNoIndent(" * @deprecated")
	}
	
	g.pNoIndent(" * @generated from protobuf message %s%s", pkgPrefix, protoName)
	g.pNoIndent(" */")
	g.pNoIndent("export interface %s {", fullName)
	
	// Track which oneofs have been generated
	generatedOneofs := make(map[int32]bool)
	
	// Track if we've generated the first field (for detached comment handling)
	firstFieldGenerated := false
	
	// Generate fields in field number order
	// When we encounter a field that's part of a oneof, generate the entire oneof at that point
	for fieldIdx, field := range msg.Field {
		// Skip GROUP type fields - they're deprecated and handled as nested messages
		if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_GROUP {
			continue
		}
		
		var fieldPath []int32
		if len(msgPath) > 0 {
			fieldPath = append(msgPath, 2, int32(fieldIdx))
		}
		
		if field.OneofIndex != nil {
			// This field is part of a oneof
			oneofIdx := field.GetOneofIndex()
			oneofProtoName := msg.OneofDecl[oneofIdx].GetName()
			
			// Check if this is a proto3 optional (synthetic oneof)
			isProto3Optional := field.Proto3Optional != nil && *field.Proto3Optional
			
			if isProto3Optional {
				// Proto3 optional field - treat as regular optional field
				g.generateField(field, fullName, fieldPath, firstFieldGenerated)
				firstFieldGenerated = true
			} else {
				// Real oneof - only generate once (when we encounter its first field)
				if !generatedOneofs[oneofIdx] {
					generatedOneofs[oneofIdx] = true
					
					// Collect all fields for this oneof
					var oneofFields []*descriptorpb.FieldDescriptorProto
					for _, f := range msg.Field {
						if f.OneofIndex != nil && f.GetOneofIndex() == oneofIdx {
							oneofFields = append(oneofFields, f)
						}
					}
					
					// Convert oneof name to camelCase
					oneofCamelName := g.toCamelCase(oneofProtoName)
					
					// Escape reserved property names
					if oneofCamelName == "__proto__" || oneofCamelName == "toString" || oneofCamelName == "oneofKind" {
						oneofCamelName = oneofCamelName + "$"
					}
					
					g.generateOneofField(oneofCamelName, oneofProtoName, oneofFields, msg, msgPath, oneofIdx)
					firstFieldGenerated = true
				}
			}
		} else {
			// Regular field
			g.generateField(field, fullName, fieldPath, firstFieldGenerated)
			firstFieldGenerated = true
		}
	}
	
	g.pNoIndent("}")
	
	// Generate nested message interfaces first
	for nestedIdx, nested := range msg.NestedType {
		nestedPath := append(msgPath, 3, int32(nestedIdx))
		// Build TypeScript prefix by appending baseName with underscore
		// Build proto prefix by appending baseName with dot
		g.generateMessageInterface(nested, parentPrefix + baseName + "_", protoName + ".", nestedPath)
	}
	
	// Generate nested enums after nested messages
	for enumIdx, nested := range msg.EnumType {
		// Build path for nested enum: msgPath + field 4 (enum_type) + index
		var enumPath []int32
		if len(msgPath) > 0 {
			enumPath = append([]int32{}, msgPath...)
			enumPath = append(enumPath, 4, int32(enumIdx))
		}
		// Build TypeScript prefix by appending baseName with underscore
		// Build proto prefix by appending baseName with dot
		g.generateEnum(nested, parentPrefix + baseName + "_", protoName + ".", enumPath)
	}
}

func (g *generator) generateMessageClass(msg *descriptorpb.DescriptorProto, parentPrefix string, protoParentPrefix string) {
	// Skip map entry messages
	if msg.Options != nil && msg.GetOptions().GetMapEntry() {
		return
	}
	
	baseName := msg.GetName()
	// Only escape top-level types (nested types don't need escaping)
	escapedName := baseName
	if parentPrefix == "" {
		escapedName = escapeTypescriptKeyword(baseName)
	}
	fullName := parentPrefix + escapedName
	protoName := protoParentPrefix + baseName
	
	// Check if this type has a collision suffix
	pkgPrefix := ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	fullProtoName := pkgPrefix + protoName
	if suffix, exists := g.typeNameSuffixes[fullProtoName]; exists && suffix > 0 {
		fullName = fullName + fmt.Sprintf("$%d", suffix)
	}
	
	// Message type class
	g.generateMessageTypeClass(msg, fullName, protoName)
	
	// Generate nested message classes
	for _, nested := range msg.NestedType {
		// Build TypeScript prefix by appending baseName with underscore
		// Build proto prefix by appending baseName with dot
		g.generateMessageClass(nested, parentPrefix + baseName + "_", protoName + ".")
	}
}

func (g *generator) generateField(field *descriptorpb.FieldDescriptorProto, msgName string, fieldPath []int32, isNotFirstField bool) {
	g.indent = "    "
	
	// Add leading detached comments (always as // style before JSDoc)
	if len(fieldPath) > 0 {
		detachedComments := g.getLeadingDetachedComments(fieldPath)
		if len(detachedComments) > 0 {
			// Output detached comments as // style BEFORE JSDoc
			for idx, detached := range detachedComments {
				// Trim trailing newline (it will be represented by blank line or separator)
				detached = strings.TrimRight(detached, "\n")
				// Split by newline and output each line
				for _, line := range strings.Split(detached, "\n") {
					line = strings.TrimRight(line, " \t")
					if line == "" {
						g.p("// ")
					} else {
						g.p("// %s", line)
					}
				}
				// Add blank line separator after detached comment block (except for last block)
				if idx < len(detachedComments)-1 {
					g.pNoIndent("")
				}
			}
			// Add blank line after all detached comments, before JSDoc
			g.pNoIndent("")
		}
	}
	
	g.p("/**")
	
	// Add leading comments if fieldPath is provided
	hasLeadingComments := false
	hasTrailingBlankInComment := false
	if len(fieldPath) > 0 {
		leadingComments := g.getLeadingComments(fieldPath)
		// Check if comment had trailing blank line
		if strings.HasSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__") {
			hasTrailingBlankInComment = true
			leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
		}
		if leadingComments != "" {
			hasLeadingComments = true
			for _, line := range strings.Split(leadingComments, "\n") {
				if line == "" {
					g.p(" *")
				} else {
					g.p(" * %s", escapeJSDocComment(line))
				}
			}
		}
	}
	
	// Add blank lines before @generated
	// If comment had trailing blank, add that blank line
	if hasTrailingBlankInComment {
		g.p(" *")
	}
	// Add standard blank line before @generated (if we had any comments)
	if hasLeadingComments {
		g.p(" *")
	}
	
	// Build the @generated comment line
	protoType := g.getProtoType(field)
	fieldName := field.GetName()
	fieldNumber := field.GetNumber()
	
	optionsAnnotation := g.formatFieldOptionsAnnotation(field)
	
	// Check if field is deprecated OR file is deprecated
	fieldIsDeprecated := field.Options != nil && field.GetOptions().GetDeprecated()
	// Add @deprecated tag for both field-level and file-level deprecation
	if fieldIsDeprecated || g.isFileDeprecated() {
		g.p(" * @deprecated")
	}
	
	g.p(" * @generated from protobuf field: %s %s = %d%s", protoType, fieldName, fieldNumber, optionsAnnotation)
	g.p(" */")
	
	fieldName = g.propertyName(field)
	
	// Get trailing comments if fieldPath is provided
	trailingComment := ""
	if len(fieldPath) > 0 {
		tc := g.getTrailingComments(fieldPath)
		if tc != "" {
			// Convert multiline comments to single line with proper formatting
			lines := strings.Split(tc, "\n")
			trailingComment = " // " + strings.Join(lines, " ")
		}
	}
	
	// Check if it's a repeated field
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		// Check if it's a map field
		msgType := g.findMessageType(field.GetTypeName())
		if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
			// Map field - multiline format
			keyField := msgType.Field[0]
			valueField := msgType.Field[1]
			keyType := g.getTypescriptTypeForMapKey(keyField)
			valueType := g.getBaseTypescriptType(valueField)
			g.p("%s: {", fieldName)
			g.indent = "        "
			g.p("[key: %s]: %s;", keyType, valueType)
			g.indent = "    "
			g.p("};%s", trailingComment)
		} else {
			// Regular repeated field
			baseType := g.getBaseTypescriptType(field)
			g.p("%s: %s[];%s", fieldName, baseType, trailingComment)
		}
	} else {
		// Singular field
		fieldType := g.getBaseTypescriptType(field)
		optional := ""
		// Mark as optional if:
		// 1. Proto2 optional (syntax is proto2 AND label is OPTIONAL)
		// 2. Proto3 message (messages are always optional)
		// 3. Proto3 explicit optional scalar (proto3_optional = true)
		isProto2 := g.file.GetSyntax() == "proto2" || g.file.GetSyntax() == ""
		if field.GetLabel() != descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
			if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REQUIRED {
				// Proto2 required message fields are still optional in TS (no zero value)
				if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
					optional = "?"
				}
			} else if isProto2 && field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL {
				// Proto2 optional scalar or message
				optional = "?"
			} else if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
				// Proto3 message (implicitly optional)
				optional = "?"
			} else if field.Proto3Optional != nil && *field.Proto3Optional {
				// Proto3 explicit optional scalar
				optional = "?"
			}
		}
		g.p("%s%s: %s;%s", fieldName, optional, fieldType, trailingComment)
	}
	
	g.indent = ""
}

func (g *generator) generateOneofField(oneofCamelName string, oneofProtoName string, fields []*descriptorpb.FieldDescriptorProto, msg *descriptorpb.DescriptorProto, msgPath []int32, oneofIndex int32) {
	g.indent = "    "
	
	// Get oneof leading comment
	oneofPath := append(append([]int32{}, msgPath...), 8, oneofIndex)
	oneofLeadingComments := g.getLeadingComments(oneofPath)
	
	// Add leading detached comments (as // style before JSDoc)
	detachedComments := g.getLeadingDetachedComments(oneofPath)
	if len(detachedComments) > 0 {
		for idx, detached := range detachedComments {
			detached = strings.TrimRight(detached, "\n")
			for _, line := range strings.Split(detached, "\n") {
				line = strings.TrimRight(line, " \t")
				if line == "" {
					g.p("// ")
				} else {
					g.p("// %s", line)
				}
			}
			if idx < len(detachedComments)-1 {
				g.pNoIndent("")
			}
		}
		g.pNoIndent("")
	}
	
	// Generate oneof JSDoc
	g.p("/**")
	
	// Add leading comments if present
	if oneofLeadingComments != "" {
		hasTrailingBlank := strings.HasSuffix(oneofLeadingComments, "__HAS_TRAILING_BLANK__")
		if hasTrailingBlank {
			oneofLeadingComments = strings.TrimSuffix(oneofLeadingComments, "\n__HAS_TRAILING_BLANK__")
		}
		for _, line := range strings.Split(oneofLeadingComments, "\n") {
			if line == "" {
				g.p(" *")
			} else {
				g.p(" * %s", escapeJSDocComment(line))
			}
		}
		if hasTrailingBlank {
			g.p(" *")
			g.p(" *")
		} else {
			g.p(" *")
		}
	}
	
	// Oneof trailing comment goes into the oneof JSDoc (before @generated)
	oneofTrailingComment := g.getTrailingComments(oneofPath)
	if oneofTrailingComment != "" {
		for _, line := range strings.Split(oneofTrailingComment, "\n") {
			if line == "" {
				g.p(" *")
			} else {
				g.p(" * %s", escapeJSDocComment(line))
			}
		}
		g.p(" *")
	}
	// Add @deprecated if file is deprecated
	if g.isFileDeprecated() {
		g.p(" * @deprecated")
	}
	g.p(" * @generated from protobuf oneof: %s", oneofProtoName)
	g.p(" */")
	g.p("%s: {", oneofCamelName)
	
	// Generate each alternative
	for i, field := range fields {
		g.indent = "        "
		fieldJsonName := g.propertyName(field)
		g.p("oneofKind: \"%s\";", fieldJsonName)
		
		// Get field index in message
		var fieldIndex int32
		for idx, f := range msg.Field {
			if f.GetNumber() == field.GetNumber() {
				fieldIndex = int32(idx)
				break
			}
		}
		
		// Get field leading comment
		fieldPath := append(append([]int32{}, msgPath...), 2, fieldIndex)
		fieldLeadingComments := g.getLeadingComments(fieldPath)
		
		// Add detached comments for non-first oneof member fields as // style
		if i > 0 {
			fieldDetached := g.getLeadingDetachedComments(fieldPath)
			if len(fieldDetached) > 0 {
				for dIdx, detached := range fieldDetached {
					detached = strings.TrimRight(detached, "\n")
					for _, line := range strings.Split(detached, "\n") {
						line = strings.TrimRight(line, " \t")
						if line == "" {
							g.p("// ")
						} else {
							g.p("// %s", line)
						}
					}
					if dIdx < len(fieldDetached)-1 {
						g.pNoIndent("")
					}
				}
				g.pNoIndent("")
			}
		}
		
		// Generate field JSDoc
		g.p("/**")
		if fieldLeadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(fieldLeadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				fieldLeadingComments = strings.TrimSuffix(fieldLeadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			for _, line := range strings.Split(fieldLeadingComments, "\n") {
				if line == "" {
					g.p(" *")
				} else {
					g.p(" * %s", escapeJSDocComment(line))
				}
			}
			if hasTrailingBlank {
				g.p(" *")
				g.p(" *")
			} else {
				g.p(" *")
			}
		}
		optionsAnnotation := g.formatFieldOptionsAnnotation(field)
		// Check if field is deprecated
		fieldIsDeprecated := field.Options != nil && field.GetOptions().GetDeprecated()
		if fieldIsDeprecated || g.isFileDeprecated() {
			g.p(" * @deprecated")
		}
		g.p(" * @generated from protobuf field: %s %s = %d%s", g.getProtoType(field), field.GetName(), field.GetNumber(), optionsAnnotation)
		g.p(" */")
		fieldType := g.getTypescriptType(field)
		fieldTrailingComment := g.getTrailingComments(fieldPath)
		if fieldTrailingComment != "" {
			g.p("%s: %s; // %s", fieldJsonName, fieldType, fieldTrailingComment)
		} else {
			g.p("%s: %s;", fieldJsonName, fieldType)
		}
		g.indent = "    "
		if i < len(fields)-1 {
			g.p("} | {")
		}
	}
	
	// Add undefined alternative
	g.p("} | {")
	g.indent = "        "
	g.p("oneofKind: undefined;")
	g.indent = "    "
	g.p("};")
	g.indent = ""
}

// propertyName returns the TypeScript property name for a field
// This does camelCase conversion where all letters after underscores are capitalized
// Reserved object properties (__proto__, toString) and the oneofKind discriminator get $ suffix
func (g *generator) propertyName(field *descriptorpb.FieldDescriptorProto) string {
	name := field.GetName()
	camelName := g.toCamelCase(name)
	
	// Escape reserved object properties and oneofKind discriminator
	if camelName == "__proto__" || camelName == "toString" || camelName == "oneofKind" {
		return camelName + "$"
	}
	
	return camelName
}

// needsLocalName returns true if the field's TypeScript property name differs
// from the default camelCase conversion (i.e., it was escaped)
func (g *generator) needsLocalName(field *descriptorpb.FieldDescriptorProto) bool {
	name := field.GetName()
	camelName := g.toCamelCase(name)
	return camelName == "__proto__" || camelName == "toString" || camelName == "oneofKind"
}

// toCamelCase converts a snake_case name to camelCase
func (g *generator) toCamelCase(name string) string {
	// Convert snake_case to camelCase: capitalize all letters after underscores
	parts := strings.Split(name, "_")
	startsWithUnderscore := len(name) > 0 && name[0] == '_'
	
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	result := strings.Join(parts, "")
	
	// Special handling: if a lowercase letter follows a digit, capitalize it
	// Example: "int32s" becomes "int32S" in "fInt32S"
	runes := []rune(result)
	for i := 1; i < len(runes); i++ {
		if runes[i] >= 'a' && runes[i] <= 'z' && runes[i-1] >= '0' && runes[i-1] <= '9' {
			runes[i] = runes[i] - 'a' + 'A'
		}
	}
	result = string(runes)
	
	// If name started with underscore, capitalize the first letter
	// Otherwise, lowercase the first letter
	if len(result) > 0 {
		if startsWithUnderscore {
			result = strings.ToUpper(result[:1]) + result[1:]
		} else {
			result = strings.ToLower(result[:1]) + result[1:]
		}
	}
	return result
}

// jsonName returns the jsonName for use in reflection metadata
// This uses protoc's JsonName which follows JSON naming conventions
func (g *generator) jsonName(field *descriptorpb.FieldDescriptorProto) string {
	if field.JsonName != nil {
		// Use the proto-provided JsonName as-is
		return *field.JsonName
	}
	// Fallback: convert snake_case to camelCase (should not happen with protoc)
	return g.propertyName(field)
}

// protocGeneratedJsonName returns what protoc would auto-generate as the jsonName
// This follows protoc's rules: remove underscores, capitalize letter after underscore
func (g *generator) protocGeneratedJsonName(fieldName string) string {
	var result strings.Builder
	capitalizeNext := false
	
	for _, ch := range fieldName {
		if ch == '_' {
			capitalizeNext = true
			continue
		}
		
		// Capitalize the next letter (but not digit) after underscore
		if capitalizeNext && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
			if ch >= 'a' && ch <= 'z' {
				result.WriteRune(ch - 'a' + 'A')
			} else {
				result.WriteRune(ch)
			}
			capitalizeNext = false
		} else {
			result.WriteRune(ch)
			capitalizeNext = false
		}
	}
	
	return result.String()
}

func (g *generator) getProtoType(field *descriptorpb.FieldDescriptorProto) string {
	// Check if it's a map field
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED && 
	   field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		msgType := g.findMessageType(field.GetTypeName())
		if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
			// It's a map field
			keyField := msgType.Field[0]
			valueField := msgType.Field[1]
			keyType := g.getProtoTypeSimple(keyField)
			valueType := g.getProtoTypeSimple(valueField)
			return fmt.Sprintf("map<%s, %s>", keyType, valueType)
		}
	}
	
	label := ""
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		label = "repeated "
	} else if field.Proto3Optional != nil && *field.Proto3Optional {
		// Proto3 explicit optional
		label = "optional "
	} else if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL {
		// Only show "optional" for proto2 optional fields (not oneof members)
		isProto2 := g.file.GetSyntax() == "proto2" || g.file.GetSyntax() == ""
		if isProto2 && field.OneofIndex == nil {
			label = "optional "
		}
	} else if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REQUIRED {
		label = "required "
	}
	
	typeName := ""
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		typeName = g.getProtoTypeName(field.GetTypeName())
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		typeName = g.getProtoTypeName(field.GetTypeName())
	default:
		typeName = strings.ToLower(field.GetType().String()[5:]) // Remove TYPE_ prefix
	}
	
	return label + typeName
}

func (g *generator) getProtoTypeSimple(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		return g.getProtoTypeName(field.GetTypeName())
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return g.getProtoTypeName(field.GetTypeName())
	default:
		return strings.ToLower(field.GetType().String()[5:]) // Remove TYPE_ prefix
	}
}

func (g *generator) getProtoTypeName(typeName string) string {
	// Remove leading dot
	typeName = strings.TrimPrefix(typeName, ".")
	// Keep package prefix and convert nested types
	return strings.ReplaceAll(typeName, ".", ".")
}

func (g *generator) stripPackage(typeName string) string {
	// Check if this type has an import alias (collision-resolved name)
	if alias, ok := g.importAliases[typeName]; ok {
		return alias
	}
	// Also check with leading dot stripped
	dotPrefixed := "." + strings.TrimPrefix(typeName, ".")
	if alias, ok := g.importAliases[dotPrefixed]; ok {
		return alias
	}

	// Remove leading dot
	typeName = strings.TrimPrefix(typeName, ".")
	
	// Check if this is from the EXACT same package (not a sub-package)
	if g.file.Package != nil && *g.file.Package != "" {
		prefix := *g.file.Package + "."
		if strings.HasPrefix(typeName, prefix) {
			// Could be same package or sub-package
			// Extract what comes after the package prefix
			remainder := strings.TrimPrefix(typeName, prefix)
			
			// To distinguish between same-package types and sub-packages:
			// - Check if the type is defined in this file
			// - If it's defined here, it's a same-package type (possibly nested)
			// - If not, it's a sub-package
			parts := strings.Split(remainder, ".")
			if len(parts) > 0 {
				// Check if the first part is a top-level message/enum in this file
				isInThisFile := false
				firstPart := parts[0]
				for _, msg := range g.file.MessageType {
					if msg.GetName() == firstPart {
						isInThisFile = true
						break
					}
				}
				if !isInThisFile {
					for _, enum := range g.file.EnumType {
						if enum.GetName() == firstPart {
							isInThisFile = true
							break
						}
					}
				}
				
				if isInThisFile {
					// It's a type defined in this file (possibly nested)
					// Replace dots with underscores for nested types
					result := strings.ReplaceAll(remainder, ".", "_")
					// For top-level types, apply keyword escaping
					if !strings.Contains(remainder, ".") {
						result = escapeTypescriptKeyword(result)
					}
					
					// Check if this type has a collision suffix
					pkgPrefix := ""
					if g.file.Package != nil && *g.file.Package != "" {
						pkgPrefix = *g.file.Package + "."
					}
					fullProtoName := pkgPrefix + remainder
					if suffix, exists := g.typeNameSuffixes[fullProtoName]; exists && suffix > 0 {
						result = result + fmt.Sprintf("$%d", suffix)
					}
					
					return result
				}
			}
			// Otherwise it's a sub-package, fall through to handle as external type
		}
	}
	
	// Different package - need to strip package but keep message.nested structure
	// e.g., api.v1.HealthCheckResponse.Status -> HealthCheckResponse_Status
	//  or   auth.UserProfile -> UserProfile (if imported)
	
	// Find the source file for this type to get its actual package
	remainder := ""
	if srcPkg := g.findPackageForType(typeName); srcPkg != "" {
		remainder = strings.TrimPrefix(typeName, srcPkg+".")
	} else {
		// No package (empty package) — the entire typeName is the type path
		remainder = typeName
	}
	
	if remainder == "" {
		return typeName
	}
	
	parts := strings.Split(remainder, ".")
	if len(parts) > 1 {
		return strings.Join(parts, "_")
	}
	
	return escapeTypescriptKeyword(parts[0])
}

// findPackageForType returns the package name for a fully-qualified type name
// by searching all known files. Returns "" if the type has no package.
func (g *generator) findPackageForType(typeName string) string {
	typeName = strings.TrimPrefix(typeName, ".")

	checkFile := func(file *descriptorpb.FileDescriptorProto) bool {
		pkg := file.GetPackage()
		var remainder string
		if pkg != "" {
			if !strings.HasPrefix(typeName, pkg+".") {
				return false
			}
			remainder = strings.TrimPrefix(typeName, pkg+".")
		} else {
			remainder = typeName
		}
		parts := strings.Split(remainder, ".")
		for _, msg := range file.MessageType {
			if msg.GetName() == parts[0] {
				return true
			}
		}
		for _, enum := range file.EnumType {
			if enum.GetName() == parts[0] {
				return true
			}
		}
		return false
	}

	// Check current file
	if checkFile(g.file) {
		return g.file.GetPackage()
	}
	// Check all files
	for _, f := range g.allFiles {
		if checkFile(f) {
			return f.GetPackage()
		}
	}
	return ""
}

func (g *generator) getTypescriptType(field *descriptorpb.FieldDescriptorProto) string {
	baseType := g.getBaseTypescriptType(field)
	
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		// Check if it's a map
		if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
			msgType := g.findMessageType(field.GetTypeName())
			if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
				// It's a map entry
				keyField := msgType.Field[0]
				valueField := msgType.Field[1]
				keyType := g.getBaseTypescriptType(keyField)
				valueType := g.getBaseTypescriptType(valueField)
				return fmt.Sprintf("{\n        [key: %s]: %s;\n    }", keyType, valueType)
			}
		}
		return baseType + "[]"
	}
	
	return baseType
}

func (g *generator) getTypescriptTypeForMapKey(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "string"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "number"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		// 64-bit integers as map keys use the same type as regular fields
		return g.params.longType
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		// Boolean map keys are converted to strings in JavaScript/TypeScript
		// because object keys are always strings
		return "string"
	default:
		return "string"
	}
}

func (g *generator) getReaderMethodForMapKey(field *descriptorpb.FieldDescriptorProto) string {
	// Map keys are always strings in JavaScript/TypeScript objects
	// Boolean keys need .toString() conversion
	if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_BOOL {
		return "reader.bool().toString()"
	}
	// Other key types use the standard reader method
	return g.getReaderMethod(field)
}

func (g *generator) getBaseTypescriptType(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "number"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "number"
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "bigint"
			}
			// JS_STRING falls through to use longType
		}
		return g.params.longType
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "boolean"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "string"
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "Uint8Array"
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		return g.stripPackage(field.GetTypeName())
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return g.stripPackage(field.GetTypeName())
	default:
		return "any"
	}
}

func isJsTypeNormal(field *descriptorpb.FieldDescriptorProto) bool {
	return field.Options != nil && field.GetOptions().Jstype != nil &&
		field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL
}

func is64BitIntType(field *descriptorpb.FieldDescriptorProto) bool {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return true
	}
	return false
}

func (g *generator) findMessageType(typeName string) *descriptorpb.DescriptorProto {
	typeName = strings.TrimPrefix(typeName, ".")
	
	// Search in current file
	for _, msg := range g.file.MessageType {
		if found := g.findMessageTypeInMessage(msg, typeName, ""); found != nil {
			return found
		}
	}
	
	// Search in dependencies
	for _, dep := range g.file.Dependency {
		depFile := g.findFileByName(dep)
		if depFile != nil {
			for _, msg := range depFile.MessageType {
				if found := g.findMessageTypeInMessage(msg, typeName, ""); found != nil {
					return found
				}
			}
		}
	}
	
	return nil
}

func (g *generator) findEnumType(typeName string) *descriptorpb.EnumDescriptorProto {
	typeName = strings.TrimPrefix(typeName, ".")
	
	// Search in current file top-level enums
	for _, enum := range g.file.EnumType {
		fullName := ""
		if g.file.Package != nil && *g.file.Package != "" {
			fullName = *g.file.Package + "."
		}
		fullName += enum.GetName()
		if typeName == fullName {
			return enum
		}
	}
	
	// Search in current file nested enums
	currentPkg := ""
	if g.file.Package != nil && *g.file.Package != "" {
		currentPkg = *g.file.Package
	}
	for _, msg := range g.file.MessageType {
		if found := g.findEnumTypeInMessage(msg, typeName, currentPkg); found != nil {
			return found
		}
	}
	
	// Search in dependencies
	for _, dep := range g.file.Dependency {
		depFile := g.findFileByName(dep)
		if depFile != nil {
			depPkg := ""
			if depFile.Package != nil && *depFile.Package != "" {
				depPkg = *depFile.Package
			}
			
			for _, enum := range depFile.EnumType {
				fullName := ""
				if depPkg != "" {
					fullName = depPkg + "."
				}
				fullName += enum.GetName()
				if typeName == fullName {
					return enum
				}
			}
			for _, msg := range depFile.MessageType {
				prefix := depPkg
				if found := g.findEnumTypeInMessage(msg, typeName, prefix); found != nil {
					return found
				}
			}
		}
	}
	
	return nil
}

func (g *generator) findEnumTypeInMessage(msg *descriptorpb.DescriptorProto, typeName string, prefix string) *descriptorpb.EnumDescriptorProto {
	msgFullName := prefix
	if msgFullName != "" {
		msgFullName += "."
	}
	msgFullName += msg.GetName()
	
	// Check nested enums
	for _, enum := range msg.EnumType {
		fullName := msgFullName + "." + enum.GetName()
		if typeName == fullName {
			return enum
		}
	}
	
	// Search nested messages
	for _, nested := range msg.NestedType {
		if found := g.findEnumTypeInMessage(nested, typeName, msgFullName); found != nil {
			return found
		}
	}
	
	return nil
}

func (g *generator) findMessageTypeInMessage(msg *descriptorpb.DescriptorProto, typeName string, prefix string) *descriptorpb.DescriptorProto {
	fullName := prefix
	if fullName != "" {
		fullName += "."
	}
	fullName += msg.GetName()
	
	// Check if current message matches
	if strings.HasSuffix(typeName, fullName) {
		return msg
	}
	
	// Search nested types
	for _, nested := range msg.NestedType {
		if found := g.findMessageTypeInMessage(nested, typeName, fullName); found != nil {
			return found
		}
	}
	
	return nil
}

// generateFieldDescriptor generates a single field descriptor in the MessageType constructor
// oneofName is the proto snake_case name - it will be converted to camelCase for the descriptor
func (g *generator) generateFieldDescriptor(field *descriptorpb.FieldDescriptorProto, oneofName string, comma string) {
	kind := "scalar"
	t := g.getScalarTypeEnum(field)
	extraFields := ""
	
	// Convert oneof name to camelCase for use in field descriptor
	oneofCamelName := ""
	if oneofName != "" {
		oneofCamelName = g.toCamelCase(oneofName)
		// Escape reserved property names
		if oneofCamelName == "__proto__" || oneofCamelName == "toString" || oneofCamelName == "oneofKind" {
			oneofCamelName = oneofCamelName + "$"
		}
	}
	
	// Determine field kind and extra fields
	if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		msgType := g.findMessageType(field.GetTypeName())
		if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
			// Map field
			kind = "map"
			keyField := msgType.Field[0]
			valueField := msgType.Field[1]
			keyT := g.getScalarTypeEnum(keyField)
			keyTypeName := g.getScalarTypeName(keyField)
			if valueField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
				extraFields = fmt.Sprintf(", K: %s /*ScalarType.%s*/, V: { kind: \"message\", T: () => %s }", keyT, keyTypeName, g.stripPackage(valueField.GetTypeName()))
			} else if valueField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM {
				valueTypeName := g.stripPackage(valueField.GetTypeName())
				valueFullTypeName := g.getProtoTypeName(valueField.GetTypeName())
				enumType := g.findEnumType(valueField.GetTypeName())
				enumPrefix := ""
				if enumType != nil {
					enumPrefix = g.detectEnumPrefix(enumType)
				}
				if enumPrefix != "" {
					extraFields = fmt.Sprintf(", K: %s /*ScalarType.%s*/, V: { kind: \"enum\", T: () => [\"%s\", %s, \"%s\"] }", keyT, keyTypeName, valueFullTypeName, valueTypeName, enumPrefix)
				} else {
					extraFields = fmt.Sprintf(", K: %s /*ScalarType.%s*/, V: { kind: \"enum\", T: () => [\"%s\", %s] }", keyT, keyTypeName, valueFullTypeName, valueTypeName)
				}
			} else {
				valueT := g.getScalarTypeEnum(valueField)
				valueTypeName := g.getScalarTypeName(valueField)
				extraFields = fmt.Sprintf(", K: %s /*ScalarType.%s*/, V: { kind: \"scalar\", T: %s /*ScalarType.%s*/ }", keyT, keyTypeName, valueT, valueTypeName)
			}
		} else {
			// Message field
			kind = "message"
			if oneofCamelName != "" {
				extraFields = fmt.Sprintf(", oneof: \"%s\", T: () => %s", oneofCamelName, g.stripPackage(field.GetTypeName()))
			} else {
				extraFields = fmt.Sprintf(", T: () => %s", g.stripPackage(field.GetTypeName()))
			}
		}
	} else if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM {
		// Enum field
		kind = "enum"
		typeName := g.stripPackage(field.GetTypeName())
		fullTypeName := g.getProtoTypeName(field.GetTypeName())
		
		// Get enum to detect prefix
		enumType := g.findEnumType(field.GetTypeName())
		enumPrefix := ""
		if enumType != nil {
			enumPrefix = g.detectEnumPrefix(enumType)
		}
		
		// Build T parameter
		var tParam string
		if enumPrefix != "" {
			tParam = fmt.Sprintf("[\"%s\", %s, \"%s\"]", fullTypeName, typeName, enumPrefix)
		} else {
			tParam = fmt.Sprintf("[\"%s\", %s]", fullTypeName, typeName)
		}
		
		if oneofCamelName != "" {
			extraFields = fmt.Sprintf(", oneof: \"%s\", T: () => %s", oneofCamelName, tParam)
		} else {
			extraFields = fmt.Sprintf(", T: () => %s", tParam)
		}
	} else {
		// Scalar field
		if oneofCamelName != "" {
			extraFields = fmt.Sprintf(", oneof: \"%s\"", oneofCamelName)
		}
	}
	
	// Add repeat field for repeated fields (not maps)
	repeat := ""
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED && kind != "map" {
		if g.isFieldPacked(field) {
			repeat = ", repeat: 1 /*RepeatType.PACKED*/"
		} else {
			repeat = ", repeat: 2 /*RepeatType.UNPACKED*/"
		}
	}
	
	// Add localName when property name was escaped for reserved object properties
	localNameField := ""
	if g.needsLocalName(field) {
		propertyName := g.propertyName(field)
		localNameField = fmt.Sprintf(", localName: \"%s\"", propertyName)
	}
	
	// Add jsonName when it differs from the TypeScript property name (before escaping)
	jsonNameField := ""
	if field.JsonName != nil {
		// Compare against unescaped camelCase name
		camelName := g.toCamelCase(field.GetName())
		actualJsonName := *field.JsonName
		// Include jsonName if it differs from the unescaped camelCase name
		if camelName != actualJsonName {
			jsonNameField = fmt.Sprintf(", jsonName: \"%s\"", actualJsonName)
		}
	}
	
	// Mark as optional for proto3 optional scalars/enums or proto2 optional scalars
	opt := ""
	isProto2 := g.file.GetSyntax() == "proto2" || g.file.GetSyntax() == ""
	if field.Proto3Optional != nil && *field.Proto3Optional {
		// Proto3 explicit optional - scalars and enums get opt flag, messages don't (they're already optional)
		if field.GetType() != descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
			opt = ", opt: true"
		}
	} else if isProto2 && field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL && 
	    field.GetType() != descriptorpb.FieldDescriptorProto_TYPE_MESSAGE &&
	    field.OneofIndex == nil {
		// Proto2 optional scalars get opt flag (not messages or oneof members)
		opt = ", opt: true"
	}
	
	// Check for jstype option to add L parameter
	longTypeParam := ""
	if field.Options != nil && field.GetOptions().Jstype != nil && is64BitIntType(field) {
		if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
			longTypeParam = ", L: 2 /*LongType.NUMBER*/"
		} else if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
			longTypeParam = ", L: 0 /*LongType.BIGINT*/"
		}
	}
	
	// Custom field options
	customFieldOptsStr := ""
	customFieldOpts := g.getCustomFieldOptions(field.Options)
	if len(customFieldOpts) > 0 {
		customFieldOptsStr = ", options: " + formatCustomOptions(customFieldOpts)
	}

	// Generate the field descriptor
	if kind == "scalar" && oneofName == "" {
		// Regular scalar field needs T parameter
		typeName := g.getScalarTypeName(field)
		g.p("{ no: %d, name: \"%s\", kind: \"%s\"%s%s%s%s, T: %s /*ScalarType.%s*/%s%s }%s",
			field.GetNumber(), field.GetName(), kind, localNameField, jsonNameField, repeat, opt, t, typeName, longTypeParam, customFieldOptsStr, comma)
	} else if kind == "scalar" && oneofName != "" {
		// Scalar oneof field - jsonName comes BEFORE oneof, oneof comes BEFORE T
		typeName := g.getScalarTypeName(field)
		g.p("{ no: %d, name: \"%s\", kind: \"%s\"%s%s%s, T: %s /*ScalarType.%s*/%s%s }%s",
			field.GetNumber(), field.GetName(), kind, localNameField, jsonNameField, extraFields, t, typeName, longTypeParam, customFieldOptsStr, comma)
	} else {
		// Message, enum, or map field
		g.p("{ no: %d, name: \"%s\", kind: \"%s\"%s%s%s%s%s%s }%s",
			field.GetNumber(), field.GetName(), kind, localNameField, jsonNameField, repeat, opt, extraFields, customFieldOptsStr, comma)
	}
}

func (g *generator) generateMessageTypeClass(msg *descriptorpb.DescriptorProto, fullName string, protoName string) {
	className := fullName + "$Type"
	
	g.pNoIndent("// @generated message type with reflection information, may provide speed optimized methods")
	g.pNoIndent("class %s extends MessageType<%s> {", className, fullName)
	g.indent = "    "
	
	// Constructor
	pkgPrefix := ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	// protoName already uses dots as separators
	typeName := pkgPrefix + protoName
	
	g.p("constructor() {")
	g.indent = "        "
	
	// Classify fields by type and sort by field number
	type fieldInfo struct {
		field      *descriptorpb.FieldDescriptorProto
		isProto3Optional bool
		oneofName  string // Proto snake_case oneof name (for real oneofs only)
	}
	
	var allFields []fieldInfo
	for _, field := range msg.Field {
		// Skip GROUP type fields - they're deprecated and handled as nested messages
		if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_GROUP {
			continue
		}
		
		info := fieldInfo{field: field}
		
		// Check if this field is part of a oneof
		if field.OneofIndex != nil {
			oneofIdx := field.GetOneofIndex()
			if oneofIdx < int32(len(msg.OneofDecl)) {
				oneofName := msg.OneofDecl[oneofIdx].GetName()
				isProto3Optional := field.Proto3Optional != nil && *field.Proto3Optional
				
				if isProto3Optional {
					info.isProto3Optional = true
				} else {
					info.oneofName = oneofName
				}
			}
		}
		
		allFields = append(allFields, info)
	}
	
	// Keep fields in proto file order (don't sort)
	// The order in msg.Field is the order they appear in the .proto file
	
	// Get custom message options
	customMsgOpts := g.getCustomMessageOptions(msg.Options)
	customMsgOptsStr := ""
	if len(customMsgOpts) > 0 {
		customMsgOptsStr = ", " + formatCustomOptions(customMsgOpts)
	}
	
	// If no fields, use compact format
	if len(allFields) == 0 {
		g.p("super(\"%s\", []%s);", typeName, customMsgOptsStr)
	} else {
		g.p("super(\"%s\", [", typeName)
		
		// Generate field descriptors in field number order
		g.indent = "            "
		for i, info := range allFields {
			field := info.field
			comma := ","
			if i == len(allFields)-1 {
				comma = ""
			}
			
			// Generate field descriptor
			g.generateFieldDescriptor(field, info.oneofName, comma)
		}
		
		g.indent = "        "
		g.p("]%s);", customMsgOptsStr)
	}
	g.indent = "    "
	g.p("}")
	
	// Check if this is a well-known type that needs special handling
	isTimestamp := g.file.Package != nil && *g.file.Package == "google.protobuf" && fullName == "Timestamp"
	isDuration := g.file.Package != nil && *g.file.Package == "google.protobuf" && fullName == "Duration"
	isFieldMask := g.file.Package != nil && *g.file.Package == "google.protobuf" && fullName == "FieldMask"
	isStruct := g.file.Package != nil && *g.file.Package == "google.protobuf" && (fullName == "Struct" || fullName == "Value" || fullName == "ListValue")
	isAny := g.file.Package != nil && *g.file.Package == "google.protobuf" && fullName == "Any"
	isWrapper := g.file.Package != nil && *g.file.Package == "google.protobuf" && strings.HasSuffix(fullName, "Value") && fullName != "Value" && fullName != "ListValue"
	
	// Add special methods for well-known types BEFORE standard methods
	if isTimestamp {
		g.generateTimestampMethods()
	} else if isDuration {
		g.generateDurationMethods()
	} else if isFieldMask {
		g.generateFieldMaskMethods()
	} else if isStruct {
		g.generateStructMethods(fullName)
	} else if isWrapper {
		g.generateWrapperMethods(fullName)
	} else if isAny {
		g.generateAnyMethods()
	}
	
	// Skip create, internalBinaryRead, internalBinaryWrite when optimize_for = CODE_SIZE
	if !g.isOptimizeCodeSize() {
	// create method
	g.p("create(value?: PartialMessage<%s>): %s {", fullName, fullName)
	g.indent = "        "
	g.p("const message = globalThis.Object.create((this.messagePrototype!));")
	
	// Initialize fields and oneofs in field number order
	// Build a list of all initialization items (fields and oneofs) with their field numbers
	type initItem struct {
		fieldNumber int32
		isOneof     bool
		oneofIdx    int32
		oneofName   string
		fieldName   string
		defaultVal  string
	}
	
	var initItems []initItem
	oneofSeen := make(map[int32]bool)
	
	for _, field := range msg.Field {
		// Skip GROUP type fields - they're deprecated and handled as nested messages
		if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_GROUP {
			continue
		}
		
		fieldNum := field.GetNumber()
		
		if field.OneofIndex != nil {
			oneofIdx := field.GetOneofIndex()
			if oneofIdx < int32(len(msg.OneofDecl)) {
				oneofName := msg.OneofDecl[oneofIdx].GetName()
				isProto3Optional := field.Proto3Optional != nil && *field.Proto3Optional
				
				if !isProto3Optional {
					// Real oneof - add initialization for it (only once)
					if !oneofSeen[oneofIdx] {
						oneofSeen[oneofIdx] = true
						initItems = append(initItems, initItem{
							fieldNumber: fieldNum,
							isOneof:     true,
							oneofIdx:    oneofIdx,
							oneofName:   oneofName,
						})
					}
					continue
				}
				// Proto3 optional - treat as regular field, fall through
			}
		}
		
		// Regular field or proto3 optional
		fieldName := g.propertyName(field)
		defaultVal := g.getDefaultValue(field)
		if defaultVal != "" {
			initItems = append(initItems, initItem{
				fieldNumber: fieldNum,
				isOneof:     false,
				fieldName:   fieldName,
				defaultVal:  defaultVal,
			})
		}
	}
	
	// Deduplicate fields with the same property name (e.g. x123y and x_123_y both → x123Y)
	fieldNameSeen := make(map[string]bool)
	dedupItems := initItems[:0]
	for _, item := range initItems {
		if item.isOneof || !fieldNameSeen[item.fieldName] {
			if !item.isOneof {
				fieldNameSeen[item.fieldName] = true
			}
			dedupItems = append(dedupItems, item)
		}
	}
	initItems = dedupItems
	
	// Generate initializations in proto file order
	for _, item := range initItems {
		if item.isOneof {
			// Initialize oneof
			oneofCamelName := g.toCamelCase(item.oneofName)
			// Escape reserved property names
			if oneofCamelName == "__proto__" || oneofCamelName == "toString" || oneofCamelName == "oneofKind" {
				oneofCamelName = oneofCamelName + "$"
			}
			g.p("message.%s = { oneofKind: undefined };", oneofCamelName)
		} else {
			// Initialize regular field
			g.p("message.%s = %s;", item.fieldName, item.defaultVal)
		}
	}
	
	g.p("if (value !== undefined)")
	g.indent = "            "
	g.p("reflectionMergePartial<%s>(this, message, value);", fullName)
	g.indent = "        "
	g.p("return message;")
	g.indent = "    "
	g.p("}")
	
	// internalBinaryRead method
	g.p("internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: %s): %s {", fullName, fullName)
	g.indent = "        "
	g.p("let message = target ?? this.create(), end = reader.pos + length;")
	g.p("while (reader.pos < end) {")
	g.indent = "            "
	g.p("let [fieldNo, wireType] = reader.tag();")
	g.p("switch (fieldNo) {")
	
	// Read each field
	for _, field := range msg.Field {
		// Skip GROUP type fields - they're deprecated and handled as nested messages
		if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_GROUP {
			continue
		}
		
		g.indent = "                "
		fieldName := g.propertyName(field)
		
		// Build the options annotation
		optionsAnnotation := g.formatFieldOptionsAnnotation(field)
		
		// Show field number if there are options
		fieldNumberInComment := ""
		if optionsAnnotation != "" {
			fieldNumberInComment = fmt.Sprintf(" = %d", field.GetNumber())
		}
		
		g.p("case /* %s %s%s%s */ %d:", g.getProtoType(field), field.GetName(), fieldNumberInComment, optionsAnnotation, field.GetNumber())
		g.indent = "                    "
		
		// Check if this is a real oneof (not proto3 optional)
		isRealOneof := false
		var oneofCamelName string
		if field.OneofIndex != nil {
			oneofIdx := field.GetOneofIndex()
			oneofName := msg.OneofDecl[oneofIdx].GetName()
			isProto3Optional := field.Proto3Optional != nil && *field.Proto3Optional
			
			if !isProto3Optional {
				isRealOneof = true
				oneofCamelName = g.toCamelCase(oneofName)
				// Escape reserved property names
				if oneofCamelName == "__proto__" || oneofCamelName == "toString" || oneofCamelName == "oneofKind" {
					oneofCamelName = oneofCamelName + "$"
				}
			}
		}
		
		if isRealOneof {
			// Real oneof field
			fieldJsonName := g.propertyName(field)
			if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
				// For message types, support merging
				g.p("message.%s = {", oneofCamelName)
				g.indent = "                        "
				g.p("oneofKind: \"%s\",", fieldJsonName)
				g.p("%s: %s", fieldJsonName, g.getReaderMethodWithMerge(field, fmt.Sprintf("(message.%s as any).%s", oneofCamelName, fieldJsonName)))
				g.indent = "                    "
				g.p("};")
			} else {
				g.p("message.%s = {", oneofCamelName)
				g.indent = "                        "
				g.p("oneofKind: \"%s\",", fieldJsonName)
				g.p("%s: %s", fieldJsonName, g.getReaderMethod(field))
				g.indent = "                    "
				g.p("};")
			}
		} else if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
			msgType := g.findMessageType(field.GetTypeName())
			if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
				// Map field
				_ = msgType.Field[1] // valueField used in map generation
				g.p("this.binaryReadMap%d(message.%s, reader, options);", field.GetNumber(), fieldName)
			} else if g.isPackedType(field) {
				// Packed repeated fields can come as either packed or unpacked
				g.p("if (wireType === WireType.LengthDelimited)")
				g.indent = "                        "
				g.p("for (let e = reader.int32() + reader.pos; reader.pos < e;)")
				g.indent = "                            "
				g.p("message.%s.push(%s);", fieldName, g.getReaderMethodSimple(field))
				g.indent = "                    "
				g.p("else")
				g.indent = "                        "
				g.p("message.%s.push(%s);", fieldName, g.getReaderMethod(field))
				g.indent = "                    "
			} else {
				g.p("message.%s.push(%s);", fieldName, g.getReaderMethod(field))
			}
		} else {
			if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
				// For message fields, pass existing message for merging
				fieldName := g.propertyName(field)
				g.p("message.%s = %s;", fieldName, g.getReaderMethodWithMerge(field, "message."+fieldName))
			} else {
				g.p("message.%s = %s;", fieldName, g.getReaderMethod(field))
			}
		}
		
		g.indent = "                    "
		g.p("break;")
	}
	
	g.indent = "                "
	g.p("default:")
	g.indent = "                    "
	g.p("let u = options.readUnknownField;")
	g.p("if (u === \"throw\")")
	g.indent = "                        "
	g.p("throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);")
	g.indent = "                    "
	g.p("let d = reader.skip(wireType);")
	g.p("if (u !== false)")
	g.indent = "                        "
	g.p("(u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);")
	g.indent = "            "
	g.p("}")
	g.indent = "        "
	g.p("}")
	g.p("return message;")
	g.indent = "    "
	g.p("}")
	
	// Add map read helpers if needed
	pkgPrefix = ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	protoTypeName := pkgPrefix + protoName
	
	for _, field := range msg.Field {
		if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
			msgType := g.findMessageType(field.GetTypeName())
			if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
				keyField := msgType.Field[0]
				valueField := msgType.Field[1]
				
				fieldName := g.propertyName(field)
				g.p("private binaryReadMap%d(map: %s[\"%s\"], reader: IBinaryReader, options: BinaryReadOptions): void {",
					field.GetNumber(),
					fullName,
					fieldName)
				g.indent = "        "
				g.p("let len = reader.uint32(), end = reader.pos + len, key: keyof %s[\"%s\"] | undefined, val: %s[\"%s\"][any] | undefined;",
					fullName, fieldName, fullName, fieldName)
				g.p("while (reader.pos < end) {")
				g.indent = "            "
				g.p("let [fieldNo, wireType] = reader.tag();")
				g.p("switch (fieldNo) {")
				g.indent = "                "
				g.p("case 1:")
				g.indent = "                    "
				g.p("key = %s;", g.getReaderMethodForMapKey(keyField))
				g.indent = "                    "
				g.p("break;")
				g.indent = "                "
				g.p("case 2:")
				g.indent = "                    "
				g.p("val = %s;", g.getReaderMethod(valueField))
				g.indent = "                    "
				g.p("break;")
				g.indent = "                "
				g.p("default: throw new globalThis.Error(\"unknown map entry field for %s.%s\");", protoTypeName, field.GetName())
				g.indent = "            "
				g.p("}")
				g.indent = "        "
				g.p("}")
				
				// Generate proper default assignment
				keyDefault := g.getMapKeyDefault(keyField)
				valueDefault := g.getMapValueDefault(valueField)
				g.p("map[key ?? %s] = val ?? %s;", keyDefault, valueDefault)
				g.indent = "    "
				g.p("}")
			}
		}
	}
	
	// internalBinaryWrite method
	g.p("internalBinaryWrite(message: %s, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {", fullName)
	g.indent = "        "
	
	// Sort fields by field number for write method (for efficiency)
	sortedFields := make([]*descriptorpb.FieldDescriptorProto, len(msg.Field))
	copy(sortedFields, msg.Field)
	// Using a simple bubble sort to avoid importing sort package
	for i := 0; i < len(sortedFields); i++ {
		for j := i + 1; j < len(sortedFields); j++ {
			if sortedFields[i].GetNumber() > sortedFields[j].GetNumber() {
				sortedFields[i], sortedFields[j] = sortedFields[j], sortedFields[i]
			}
		}
	}
	
	for _, field := range sortedFields {
		// Skip GROUP type fields - they're deprecated and handled as nested messages
		if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_GROUP {
			continue
		}
		
		fieldName := g.propertyName(field)
		
		optionsAnnotation := g.formatFieldOptionsAnnotation(field)
		
		g.p("/* %s %s = %d%s; */", g.getProtoType(field), field.GetName(), field.GetNumber(), optionsAnnotation)
		
		// Check if this is a real oneof (not proto3 optional)
		isRealOneof := false
		var oneofCamelName string
		if field.OneofIndex != nil {
			oneofIdx := field.GetOneofIndex()
			oneofName := msg.OneofDecl[oneofIdx].GetName()
			isProto3Optional := field.Proto3Optional != nil && *field.Proto3Optional
			
			if !isProto3Optional {
				isRealOneof = true
				oneofCamelName = g.toCamelCase(oneofName)
				// Escape reserved property names
				if oneofCamelName == "__proto__" || oneofCamelName == "toString" || oneofCamelName == "oneofKind" {
					oneofCamelName = oneofCamelName + "$"
				}
			}
		}
		
		if isRealOneof {
			// Real oneof field
			fieldJsonName := g.propertyName(field)
			g.p("if (message.%s.oneofKind === \"%s\")", oneofCamelName, fieldJsonName)
			g.indent = "            "
			g.p("%s", g.getWriterMethod(field, "message."+oneofCamelName+"."+fieldJsonName))
			g.indent = "        "
		} else if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
			msgType := g.findMessageType(field.GetTypeName())
			if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
				// Map field
				keyField := msgType.Field[0]
				valueField := msgType.Field[1]
				
				// Check if key is numeric
				isNumericKey := keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_INT32 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_INT64 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_UINT32 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_UINT64 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SINT32 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SINT64 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_FIXED32 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_FIXED64 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SFIXED32 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SFIXED64
				
				isBooleanKey := keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_BOOL
				
				if valueField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
					// Message value - needs special handling
					if isNumericKey {
						keyVar := "k"
						valueAccessor := "message." + fieldName + "[k]"
						if keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_INT32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_UINT32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SINT32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_FIXED32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SFIXED32 {
							keyVar = "parseInt(k)"
							valueAccessor = "message." + fieldName + "[k as any]"
						}
						keyWriter := g.getMapKeyWriter(keyField, keyVar)
						g.p("for (let k of globalThis.Object.keys(message.%s)) {", fieldName)
						g.indent = "            "
						g.p("writer.tag(%d, WireType.LengthDelimited).fork()%s;", field.GetNumber(), keyWriter)
						g.p("writer.tag(2, WireType.LengthDelimited).fork();")
						g.p("%s.internalBinaryWrite(%s, writer, options);", g.stripPackage(valueField.GetTypeName()), valueAccessor)
						g.p("writer.join().join();")
						g.indent = "        "
						g.p("}")
					} else if isBooleanKey {
						g.p("for (let k of globalThis.Object.keys(message.%s)) {", fieldName)
						g.indent = "            "
						g.p("writer.tag(%d, WireType.LengthDelimited).fork().tag(1, WireType.Varint).bool(k === \"true\");", field.GetNumber())
						g.p("writer.tag(2, WireType.LengthDelimited).fork();")
						g.p("%s.internalBinaryWrite(message.%s[k], writer, options);", g.stripPackage(valueField.GetTypeName()), fieldName)
						g.p("writer.join().join();")
						g.indent = "        "
						g.p("}")
					} else {
						g.p("for (let k of globalThis.Object.keys(message.%s)) {", fieldName)
						g.indent = "            "
						g.p("writer.tag(%d, WireType.LengthDelimited).fork().tag(1, WireType.LengthDelimited).string(k);", field.GetNumber())
						g.p("writer.tag(2, WireType.LengthDelimited).fork();")
						g.p("%s.internalBinaryWrite(message.%s[k], writer, options);", g.stripPackage(valueField.GetTypeName()), fieldName)
						g.p("writer.join().join();")
						g.indent = "        "
						g.p("}")
					}
				} else {
					// Scalar value
					g.p("for (let k of globalThis.Object.keys(message.%s))", fieldName)
					g.indent = "            "
					if isNumericKey {
						// For 64-bit types and signed types that use string keys, use k directly
						// For 32-bit types that use number keys, use parseInt(k)
						keyVar := "k"
						valueAccessor := "message." + fieldName + "[k]"
						if keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_INT32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_UINT32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SINT32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_FIXED32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SFIXED32 {
							keyVar = "parseInt(k)"
							valueAccessor = "message." + fieldName + "[k as any]"
						}
						keyWriter := g.getMapKeyWriter(keyField, keyVar)
						valueWriter := g.getMapValueWriter(valueField, valueAccessor)
						g.p("writer.tag(%d, WireType.LengthDelimited).fork()%s%s.join();",
							field.GetNumber(), keyWriter, valueWriter)
					} else if isBooleanKey {
						valueWriter := g.getMapValueWriter(valueField, "message."+fieldName+"[k]")
						g.p("writer.tag(%d, WireType.LengthDelimited).fork().tag(1, WireType.Varint).bool(k === \"true\")%s.join();",
							field.GetNumber(), valueWriter)
					} else {
						valueWriter := g.getMapValueWriter(valueField, "message."+fieldName+"[k]")
						g.p("writer.tag(%d, WireType.LengthDelimited).fork().tag(1, WireType.LengthDelimited).string(k)%s.join();",
							field.GetNumber(), valueWriter)
					}
					g.indent = "        "
				}
			} else if g.isFieldPacked(field) {
				// Write packed repeated fields
				g.p("if (message.%s.length) {", fieldName)
				g.indent = "            "
				g.p("writer.tag(%d, WireType.LengthDelimited).fork();", field.GetNumber())
				g.p("for (let i = 0; i < message.%s.length; i++)", fieldName)
				g.indent = "                "
				method := g.getWriterMethodName(field)
				g.p("writer.%s(message.%s[i]);", method, fieldName)
				g.indent = "            "
				g.p("writer.join();")
				g.indent = "        "
				g.p("}")
			} else {
				g.p("for (let i = 0; i < message.%s.length; i++)", fieldName)
				g.indent = "            "
				g.p("%s", g.getWriterMethod(field, "message."+fieldName+"[i]"))
				g.indent = "        "
			}
		} else {
			condition := g.getWriteCondition(field, fieldName)
			if condition != "" {
				g.p("if (%s)", condition)
				g.indent = "            "
			}
			g.p("%s", g.getWriterMethod(field, "message."+fieldName))
			if condition != "" {
				g.indent = "        "
			}
		}
	}
	
	g.p("let u = options.writeUnknownFields;")
	g.p("if (u !== false)")
	g.indent = "            "
	g.p("(u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);")
	g.indent = "        "
	g.p("return writer;")
	g.indent = "    "
	g.p("}")
	} // end !isOptimizeCodeSize
	
	g.indent = ""
	g.pNoIndent("}")
	
	// Export constant
	g.pNoIndent("/**")
	// Add @deprecated if message has deprecated option OR file is deprecated
	if (msg.Options != nil && msg.GetOptions().GetDeprecated()) || g.isFileDeprecated() {
		g.pNoIndent(" * @deprecated")
	}
	g.pNoIndent(" * @generated MessageType for protobuf message %s", typeName)
	g.pNoIndent(" */")
	g.pNoIndent("export const %s = new %s();", fullName, className)
}

func (g *generator) getScalarTypeEnum(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return "1"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return "2"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return "3"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		return "4"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return "5"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return "6"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return "7"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "8"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "9"
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "12"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return "13"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "15"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return "16"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return "17"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return "18"
	default:
		return "9" // default to string
	}
}

func (g *generator) getScalarTypeName(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return "DOUBLE"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return "FLOAT"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return "INT64"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		return "UINT64"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return "INT32"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return "FIXED64"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return "FIXED32"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "BOOL"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "STRING"
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "BYTES"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return "UINT32"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "SFIXED32"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return "SFIXED64"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return "SINT32"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return "SINT64"
	default:
		return "STRING"
	}
}

// formatDefaultValueAnnotation formats a default value for the @generated comment annotation
func (g *generator) formatDefaultValueAnnotation(field *descriptorpb.FieldDescriptorProto, defaultVal string) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_STRING,
		descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		// Match protobuf-ts: only escape the first double-quote (JS String.replace replaces first match only)
		escaped := strings.Replace(defaultVal, `"`, `\"`, 1)
		return fmt.Sprintf("\"%s\"", escaped)
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		// Enum defaults show the enum value name (not the number)
		return defaultVal
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL,
		descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		// Numeric and boolean defaults are shown as-is
		return defaultVal
	default:
		return defaultVal
	}
}

// formatFieldOptionsAnnotation builds a combined "[opt1, opt2, ...]" string for field comments.
// Order matches protobuf-ts: packed, default, json_name, jstype, deprecated.
func (g *generator) formatFieldOptionsAnnotation(field *descriptorpb.FieldDescriptorProto) string {
	var options []string

	// 1. packed
	if field.Options != nil && field.GetOptions().Packed != nil {
		options = append(options, fmt.Sprintf("packed = %v", field.GetOptions().GetPacked()))
	}

	// 2. default
	if field.DefaultValue != nil {
		formattedDefault := g.formatDefaultValueAnnotation(field, field.GetDefaultValue())
		options = append(options, fmt.Sprintf("default = %s", formattedDefault))
	}

	// 3. json_name
	if field.JsonName != nil {
		protocDefault := g.protocGeneratedJsonName(field.GetName())
		if protocDefault != *field.JsonName {
			options = append(options, fmt.Sprintf("json_name = \"%s\"", *field.JsonName))
		}
	}

	// 4. jstype
	if field.Options != nil && field.GetOptions().Jstype != nil {
		jstype := field.GetOptions().GetJstype()
		if jstype == descriptorpb.FieldOptions_JS_STRING {
			options = append(options, "jstype = JS_STRING")
		} else if jstype == descriptorpb.FieldOptions_JS_NUMBER {
			options = append(options, "jstype = JS_NUMBER")
		} else if jstype == descriptorpb.FieldOptions_JS_NORMAL {
			options = append(options, "jstype = JS_NORMAL")
		}
	}

	// 5. deprecated
	if field.Options != nil && field.GetOptions().GetDeprecated() {
		options = append(options, "deprecated = true")
	}

	if len(options) == 0 {
		return ""
	}
	return " [" + strings.Join(options, ", ") + "]"
}

func (g *generator) getDefaultValue(field *descriptorpb.FieldDescriptorProto) string {
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		msgType := g.findMessageType(field.GetTypeName())
		if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
			return "{}"
		}
		return "[]"
	}
	
	if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		return "" // optional messages don't get defaults
	}
	
	// Proto2 optional scalars don't get defaults
	isProto2 := g.file.GetSyntax() == "proto2" || g.file.GetSyntax() == ""
	if isProto2 && field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL {
		return ""
	}
	
	// Proto3 explicit optional scalars don't get defaults
	if field.Proto3Optional != nil && *field.Proto3Optional {
		return ""
	}
	
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "0" // JS_NUMBER uses number type
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "0n" // JS_NORMAL uses bigint type
			}
			// JS_STRING falls through to string default
		}
		if g.params.longType == "string" {
			return "\"0\""
		}
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "false"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "\"\""
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "new Uint8Array(0)"
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return "0"
	default:
		return ""
	}
}

func (g *generator) getReaderMethod(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return "reader.double()"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return "reader.float()"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "reader.int64().toNumber()"
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "reader.int64().toBigInt()"
			}
		}
		return "reader.int64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "reader.uint64().toNumber()"
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "reader.uint64().toBigInt()"
			}
		}
		return "reader.uint64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return "reader.int32()"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "reader.fixed64().toNumber()"
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "reader.fixed64().toBigInt()"
			}
		}
		return "reader.fixed64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return "reader.fixed32()"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "reader.bool()"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "reader.string()"
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "reader.bytes()"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return "reader.uint32()"
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return "reader.int32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "reader.sfixed32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "reader.sfixed64().toNumber()"
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "reader.sfixed64().toBigInt()"
			}
		}
		return "reader.sfixed64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return "reader.sint32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "reader.sint64().toNumber()"
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "reader.sint64().toBigInt()"
			}
		}
		return "reader.sint64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		typeName := g.stripPackage(field.GetTypeName())
		return fmt.Sprintf("%s.internalBinaryRead(reader, reader.uint32(), options)", typeName)
	default:
		return "reader.string()"
	}
}

func (g *generator) getReaderMethodWithMerge(field *descriptorpb.FieldDescriptorProto, existingVar string) string {
	if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		typeName := g.stripPackage(field.GetTypeName())
		return fmt.Sprintf("%s.internalBinaryRead(reader, reader.uint32(), options, %s)", typeName, existingVar)
	}
	return g.getReaderMethod(field)
}

func (g *generator) getReaderMethodSimple(field *descriptorpb.FieldDescriptorProto) string {
	// Simpler reader for packed repeated fields (no length prefix)
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return "reader.double()"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return "reader.float()"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "reader.int64().toNumber()"
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "reader.int64().toBigInt()"
			}
		}
		return "reader.int64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "reader.uint64().toNumber()"
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "reader.uint64().toBigInt()"
			}
		}
		return "reader.uint64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return "reader.int32()"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "reader.fixed64().toNumber()"
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "reader.fixed64().toBigInt()"
			}
		}
		return "reader.fixed64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return "reader.fixed32()"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "reader.bool()"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return "reader.uint32()"
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return "reader.int32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "reader.sfixed32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "reader.sfixed64().toNumber()"
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "reader.sfixed64().toBigInt()"
			}
		}
		return "reader.sfixed64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return "reader.sint32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		// Check for jstype option
		if field.Options != nil && field.GetOptions().Jstype != nil {
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NUMBER {
				return "reader.sint64().toNumber()"
			}
			if field.GetOptions().GetJstype() == descriptorpb.FieldOptions_JS_NORMAL {
				return "reader.sint64().toBigInt()"
			}
		}
		return "reader.sint64().toString()"
	default:
		return "reader.int32()"
	}
}

func (g *generator) getWriterMethod(field *descriptorpb.FieldDescriptorProto, varName string) string {
	wireType := g.getWireType(field)
	
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		typeName := g.stripPackage(field.GetTypeName())
		return fmt.Sprintf("%s.internalBinaryWrite(%s, writer.tag(%d, %s).fork(), options).join();",
			typeName, varName, field.GetNumber(), wireType)
	default:
		method := g.getWriterMethodName(field)
		return fmt.Sprintf("writer.tag(%d, %s).%s(%s);", field.GetNumber(), wireType, method, varName)
	}
}

func (g *generator) getMapValueWriter(field *descriptorpb.FieldDescriptorProto, varName string) string {
	wireType := g.getWireType(field)
	methodName := g.getWriterMethodName(field)
	return fmt.Sprintf(".tag(2, %s).%s(%s)", wireType, methodName, varName)
}

func (g *generator) getMapKeyWriter(field *descriptorpb.FieldDescriptorProto, varName string) string {
	wireType := g.getWireType(field)
	writerMethod := g.getWriterMethodName(field)
	return fmt.Sprintf(".tag(1, %s).%s(%s)", wireType, writerMethod, varName)
}

func (g *generator) getWireType(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return "WireType.Bit64"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "WireType.Bit32"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING,
		descriptorpb.FieldDescriptorProto_TYPE_BYTES,
		descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		return "WireType.LengthDelimited"
	default:
		return "WireType.Varint"
	}
}

func (g *generator) getWriterMethodName(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return "double"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return "float"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return "int64"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		return "uint64"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return "int32"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return "fixed64"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return "fixed32"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "bool"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "string"
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "bytes"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return "uint32"
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return "int32"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "sfixed32"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return "sfixed64"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return "sint32"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return "sint64"
	default:
		return "string"
	}
}

func (g *generator) getWriteCondition(field *descriptorpb.FieldDescriptorProto, fieldName string) string {
	isProto2 := g.file.GetSyntax() == "proto2" || g.file.GetSyntax() == ""
	isProto3Optional := field.Proto3Optional != nil && *field.Proto3Optional
	
	// Optional message fields (proto2, proto3 implicit or explicit optional) use truthy check
	if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE && 
	   field.GetLabel() != descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		return fmt.Sprintf("message.%s", fieldName)
	}
	
	// Proto2 optional fields (non-message) need undefined check
	if isProto2 && field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL {
		return fmt.Sprintf("message.%s !== undefined", fieldName)
	}
	// Proto3 optional SCALARS and ENUMS need undefined check
	if isProto3Optional {
		return fmt.Sprintf("message.%s !== undefined", fieldName)
	}
	
	if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_BYTES {
		return fmt.Sprintf("message.%s.length", fieldName)
	}
	
	defaultVal := g.getDefaultValue(field)
	if defaultVal == "" || defaultVal == "[]" || defaultVal == "{}" {
		return ""
	}
	return fmt.Sprintf("message.%s !== %s", fieldName, defaultVal)
}

func (g *generator) generateEnum(enum *descriptorpb.EnumDescriptorProto, parentPrefix string, protoParentPrefix string, enumPath []int32) {
	baseName := enum.GetName()
	// Only escape top-level types (nested types don't need escaping)
	escapedName := baseName
	if parentPrefix == "" {
		escapedName = escapeTypescriptKeyword(baseName)
	}
	enumName := parentPrefix + escapedName
	protoName := protoParentPrefix + baseName
	
	// Check if this type has a collision suffix
	pkgPrefix := ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	fullProtoName := pkgPrefix + protoName
	if suffix, exists := g.typeNameSuffixes[fullProtoName]; exists && suffix > 0 {
		enumName = enumName + fmt.Sprintf("$%d", suffix)
	}
	
	// Add leading detached comments before enum JSDoc
	if len(enumPath) > 0 {
		detachedComments := g.getLeadingDetachedComments(enumPath)
		if len(detachedComments) > 0 {
			for idx, detached := range detachedComments {
				detached = strings.TrimRight(detached, "\n")
				for _, line := range strings.Split(detached, "\n") {
					line = strings.TrimRight(line, " \t")
					if line == "" {
						g.pNoIndent("// ")
					} else {
						g.pNoIndent("// %s", line)
					}
				}
				if idx < len(detachedComments)-1 {
					g.pNoIndent("")
				}
			}
			g.pNoIndent("")
		}
	}

	g.pNoIndent("/**")
	
	// Add leading and trailing comments if available
	if len(enumPath) > 0 {
		leadingComments := g.getLeadingComments(enumPath)
		trailingComments := g.getEnumTrailingComments(enumPath)
		
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(leadingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.pNoIndent(" *")
				} else {
					g.pNoIndent(" * %s", escapeJSDocComment(line))
				}
			}
			// Add separator after leading comments
			if hasTrailingBlank {
				g.pNoIndent(" *")
				g.pNoIndent(" *")
			} else {
				g.pNoIndent(" *")
			}
		}
		
		if trailingComments != "" {
			hasTrailingBlank := strings.HasSuffix(trailingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				trailingComments = strings.TrimSuffix(trailingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(trailingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.pNoIndent(" *")
				} else {
					g.pNoIndent(" * %s", escapeJSDocComment(line))
				}
			}
			// Add separator after trailing comments
			if hasTrailingBlank {
				g.pNoIndent(" *")
				g.pNoIndent(" *")
			} else {
				g.pNoIndent(" *")
			}
		}
		
	}
	
	// Add @deprecated if enum has deprecated option OR file is deprecated
	if (enum.Options != nil && enum.GetOptions().GetDeprecated()) || g.isFileDeprecated() {
		g.pNoIndent(" * @deprecated")
	}
	
	// protoParentPrefix already has dots as separators
	g.pNoIndent(" * @generated from protobuf enum %s%s", pkgPrefix, protoName)
	g.pNoIndent(" */")
	g.pNoIndent("export enum %s {", enumName)
	
	// Check if enum has a zero value
	hasZero := false
	for _, value := range enum.Value {
		if value.GetNumber() == 0 {
			hasZero = true
			break
		}
	}
	
	// Add synthetic zero value if needed
	if !hasZero {
		g.indent = "    "
		g.p("/**")
		g.p(" * @generated synthetic value - protobuf-ts requires all enums to have a 0 value")
		g.p(" */")
		g.p("UNSPECIFIED$ = 0,")
		g.indent = ""
	}
	
	// Detect common prefix
	commonPrefix := g.detectEnumPrefix(enum)
	
	// Build map from number to first value name and index (for alias handling)
	firstValueForNumber := make(map[int32]string)
	firstValueIndexForNumber := make(map[int32]int)
	for idx, value := range enum.Value {
		num := value.GetNumber()
		if _, exists := firstValueForNumber[num]; !exists {
			firstValueForNumber[num] = value.GetName()
			firstValueIndexForNumber[num] = idx
		}
	}
	
	for i, value := range enum.Value {
		g.indent = "    "
		
		// Build path to this enum value: [5 or 4, enumIndex, 2, valueIndex]
		valuePath := append(enumPath, 2, int32(i))
		
		// Check if this is an alias (not the first value with this number)
		isAlias := value.GetName() != firstValueForNumber[value.GetNumber()]
		
		// For aliases, use the first value's comments
		var leadingComments, trailingComments string
		if isAlias {
			firstIdx := firstValueIndexForNumber[value.GetNumber()]
			firstValuePath := append(enumPath, 2, int32(firstIdx))
			leadingComments = g.getLeadingComments(firstValuePath)
			trailingComments = g.getTrailingComments(firstValuePath)
		} else {
			leadingComments = g.getLeadingComments(valuePath)
			trailingComments = g.getTrailingComments(valuePath)
		}
		
		g.p("/**")
		
		// Add leading comments if present
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			for _, line := range strings.Split(leadingComments, "\n") {
				if line == "" {
					g.p(" *")
				} else {
					g.p(" * %s", escapeJSDocComment(line))
				}
			}
			if hasTrailingBlank {
				g.p(" *")
				g.p(" *")
			} else {
				g.p(" *")
			}
		}
		
		// Add trailing comments if present (before @generated line)
		// For aliases, we use the first value's trailing comments (fetched above)
		if trailingComments != "" {
			for _, line := range strings.Split(trailingComments, "\n") {
				if line == "" {
					g.p(" *")
				} else {
					g.p(" * %s", escapeJSDocComment(line))
				}
			}
			g.p(" *")
		}
		
		// Add @deprecated if value has deprecated option OR file is deprecated
		// For aliases, use the first value's deprecated status (not the alias's)
		var checkValue *descriptorpb.EnumValueDescriptorProto
		if isAlias {
			checkValue = enum.Value[firstValueIndexForNumber[value.GetNumber()]]
		} else {
			checkValue = value
		}
		valueIsDeprecated := checkValue.Options != nil && checkValue.GetOptions().GetDeprecated()
		if valueIsDeprecated || g.isFileDeprecated() {
			g.p(" * @deprecated")
		}
		
		// Build the @generated line with deprecated annotation if applicable
		deprecatedAnnotation := ""
		if valueIsDeprecated {
			deprecatedAnnotation = " [deprecated = true]"
		}
		
		// For aliases (multiple values with same number), show the first value's name
		nameToShow := firstValueForNumber[value.GetNumber()]
		g.p(" * @generated from protobuf enum value: %s = %d%s;", nameToShow, value.GetNumber(), deprecatedAnnotation)
		g.p(" */")
		
		// Strip common prefix
		tsName := value.GetName()
		if commonPrefix != "" {
			tsName = strings.TrimPrefix(tsName, commonPrefix)
		}
		
		// No comma on last value
		comma := ","
		if i == len(enum.Value)-1 {
			comma = ""
		}
		g.p("%s = %d%s", tsName, value.GetNumber(), comma)
	}
	
	g.indent = ""
	g.pNoIndent("}")
}

func (g *generator) detectEnumPrefix(enum *descriptorpb.EnumDescriptorProto) string {
	if len(enum.Value) == 0 {
		return ""
	}
	
	// Create possible prefix from enum name
	// Convert enum name to UPPER_SNAKE_CASE
	// For example, "MyEnum" => "MY_ENUM_", "const_enum" => "CONST_ENUM_"
	enumName := enum.GetName()
	
	// Match protobuf-ts algorithm:
	// 1. Prepend "_" before every uppercase letter
	// 2. Strip leading "_" if present
	// 3. Uppercase
	// 4. Append "_"
	var prefixBuilder strings.Builder
	for _, r := range enumName {
		if r >= 'A' && r <= 'Z' {
			prefixBuilder.WriteRune('_')
		}
		prefixBuilder.WriteRune(r)
	}
	intermediate := prefixBuilder.String()
	if len(intermediate) > 0 && intermediate[0] == '_' {
		intermediate = intermediate[1:]
	}
	enumPrefix := strings.ToUpper(intermediate) + "_"
	
	// Check if all enum values start with this prefix
	allHavePrefix := true
	for _, v := range enum.Value {
		if !strings.HasPrefix(v.GetName(), enumPrefix) {
			allHavePrefix = false
			break
		}
	}
	
	if !allHavePrefix {
		return ""
	}
	
	// Check if stripped names are valid (start with uppercase letter, at least 2 chars)
	for _, v := range enum.Value {
		stripped := strings.TrimPrefix(v.GetName(), enumPrefix)
		// Must have at least 2 characters and start with uppercase letter
		if len(stripped) < 2 || !(stripped[0] >= 'A' && stripped[0] <= 'Z') {
			return ""
		}
	}
	
	return enumPrefix
}

func generateClientFile(file *descriptorpb.FileDescriptorProto, allFiles []*descriptorpb.FileDescriptorProto, params params) string {
	g := &generator{
		params:            params,
		file:              file,
		allFiles:          allFiles,
		importedTypeNames: make(map[string]bool),
		localTypeNames:   make(map[string]bool),
		importAliases:    make(map[string]string),
	}
	
	// Header
	g.pNoIndent("// @generated by protobuf-ts 2.11.1 with parameter long_type_%s", params.longType)
	pkgComment := ""
	syntax := file.GetSyntax()
	if syntax == "" {
		syntax = "proto2" // Default to proto2 when syntax is not specified
	}
	if file.Package != nil && *file.Package != "" {
		pkgComment = fmt.Sprintf(" (package \"%s\", syntax %s)", *file.Package, syntax)
	} else {
		pkgComment = fmt.Sprintf(" (syntax %s)", syntax)
	}
	g.pNoIndent("// @generated from protobuf file \"%s\"%s", file.GetName(), pkgComment)
	g.pNoIndent("// tslint:disable")
	// Add file-level deprecation comment if the entire file is deprecated
	if g.isFileDeprecated() {
		g.pNoIndent("// @deprecated")
	}
	
	// Add file-level leading detached comments (license headers, etc.)
	if file.SourceCodeInfo != nil {
		for _, loc := range file.SourceCodeInfo.Location {
			// Check for syntax field with detached comments
			if len(loc.Path) == 1 && loc.Path[0] == 12 && len(loc.LeadingDetachedComments) > 0 {
				// Blank line before the license header
				g.pNoIndent("//")
				for _, detached := range loc.LeadingDetachedComments {
					comments := strings.TrimSpace(detached)
					if comments != "" {
						for _, line := range strings.Split(comments, "\n") {
							line = strings.TrimRight(line, " \t")
							if line == "" {
								g.pNoIndent("//")
							} else {
								// Strip one leading space if present (protobuf convention)
								if strings.HasPrefix(line, " ") {
									line = line[1:]
								}
								g.pNoIndent("// %s", line)
							}
						}
						// Add blank line after detached comment block
						g.pNoIndent("//")
					}
				}
			}
		}
	}
	
	baseFileName := strings.TrimSuffix(filepath.Base(file.GetName()), ".proto")
	
	// Collect imports
	seen := make(map[string]bool)
	
	// Collect all types used in first service to avoid importing them early
	service1Types := make(map[string]bool)
	if len(file.Service) > 0 {
		for _, method := range file.Service[0].Method {
			service1Types[g.stripPackage(method.GetOutputType())] = true
			service1Types[g.stripPackage(method.GetInputType())] = true
		}
	}
	
	// For services 2..N (in reverse order), output Service + all method types
	for svcIdx := len(file.Service) - 1; svcIdx >= 1; svcIdx-- {
		service := file.Service[svcIdx]
		escapedServiceName := escapeTypescriptKeyword(service.GetName())
		g.pNoIndent("import { %s } from \"./%s\";", escapedServiceName, baseFileName)
		
		// Add method types in reverse order, but skip types used in service 1
		for i := len(service.Method) - 1; i >= 0; i-- {
			method := service.Method[i]
			resType := g.stripPackage(method.GetOutputType())
			reqType := g.stripPackage(method.GetInputType())
			resTypePath := g.getImportPathForType(method.GetOutputType())
			reqTypePath := g.getImportPathForType(method.GetInputType())
			
			if !seen[resType] && !service1Types[resType] {
				g.pNoIndent("import type { %s } from \"%s\";", resType, resTypePath)
				seen[resType] = true
			}
			if !seen[reqType] && !service1Types[reqType] {
				g.pNoIndent("import type { %s } from \"%s\";", reqType, reqTypePath)
				seen[reqType] = true
			}
		}
	}
	
	// RPC imports
	g.pNoIndent("import type { RpcTransport } from \"@protobuf-ts/runtime-rpc\";")
	g.pNoIndent("import type { ServiceInfo } from \"@protobuf-ts/runtime-rpc\";")
	
	// First service + methods types with special ordering
	if len(file.Service) > 0 {
		service := file.Service[0]
		escapedServiceName := escapeTypescriptKeyword(service.GetName())
		g.pNoIndent("import { %s } from \"./%s\";", escapedServiceName, baseFileName)
		
		// Collect method 0 types for filtering
		method0Types := make(map[string]bool)
		if len(service.Method) > 0 {
			method0 := service.Method[0]
			method0Types[g.stripPackage(method0.GetOutputType())] = true
			method0Types[g.stripPackage(method0.GetInputType())] = true
		}
		
		// Import entry: either a type import or a streaming call type import
		type importEntry struct {
			typeName string
			typePath string
			callType string // non-empty for streaming call type imports ("duplex", "client", "server")
		}
		
		var imports []importEntry
		
		// Pre-compute which method index first uses each type (forward order).
		// This determines where the type import should appear in the N→1 prepend stack.
		firstMethodForType := map[string]int{}
		for i := 0; i < len(service.Method); i++ {
			method := service.Method[i]
			resType := g.stripPackage(method.GetOutputType())
			reqType := g.stripPackage(method.GetInputType())
			if _, ok := firstMethodForType[resType]; !ok {
				firstMethodForType[resType] = i
			}
			if _, ok := firstMethodForType[reqType]; !ok {
				firstMethodForType[reqType] = i
			}
		}
		
		// Collect all method imports in N→1 order (matching protobuf-ts prepend semantics).
		// For each method, only add type imports for types that are FIRST used by this method.
		var deferredInputs []importEntry
		
		for i := len(service.Method) - 1; i >= 1; i-- {
			method := service.Method[i]
			
			resType := g.stripPackage(method.GetOutputType())
			reqType := g.stripPackage(method.GetInputType())
			resTypePath := g.getImportPathForType(method.GetOutputType())
			reqTypePath := g.getImportPathForType(method.GetInputType())
			
			isStreaming := method.GetClientStreaming() || method.GetServerStreaming()
			
			// Skip non-streaming methods if both types are in method 0
			if !isStreaming && method0Types[resType] && method0Types[reqType] {
				continue
			}
			
			if isStreaming {
				// Only add types that are first used by this method
				if firstMethodForType[resType] == i && !method0Types[resType] && !seen[resType] {
					imports = append(imports, importEntry{typeName: resType, typePath: resTypePath})
					seen[resType] = true
				}
				if firstMethodForType[reqType] == i && !method0Types[reqType] && !seen[reqType] {
					imports = append(imports, importEntry{typeName: reqType, typePath: reqTypePath})
					seen[reqType] = true
				}
				
				// Add call type marker
				var callType string
				if method.GetClientStreaming() && method.GetServerStreaming() {
					callType = "duplex"
				} else if method.GetServerStreaming() {
					callType = "server"
				} else if method.GetClientStreaming() {
					callType = "client"
				}
				imports = append(imports, importEntry{callType: callType})
			} else {
				// Non-streaming: collect types (includes types first used by this or lower methods)
				// Output first
				if !method0Types[resType] && !seen[resType] {
					imports = append(imports, importEntry{typeName: resType, typePath: resTypePath})
					seen[resType] = true
					
					// Check if any deferred inputs match this output's path and emit them now
					var remainingDeferred []importEntry
					for _, deferred := range deferredInputs {
						if deferred.typePath == resTypePath {
							imports = append(imports, deferred)
						} else {
							remainingDeferred = append(remainingDeferred, deferred)
						}
					}
					deferredInputs = remainingDeferred
				}
				
				// Input: emit immediately if same path as output, otherwise defer
				if !method0Types[reqType] && !seen[reqType] {
					if reqType == resType || reqTypePath == resTypePath {
						imports = append(imports, importEntry{typeName: reqType, typePath: reqTypePath})
						seen[reqType] = true
					} else {
						deferredInputs = append(deferredInputs, importEntry{typeName: reqType, typePath: reqTypePath})
						seen[reqType] = true
					}
				}
			}
		}
		
		// Append any remaining deferred inputs
		imports = append(imports, deferredInputs...)
		
		// Determine method 0's call type (if streaming) so we don't duplicate it
		method0CallType := ""
		if len(service.Method) > 0 {
			m0 := service.Method[0]
			if m0.GetClientStreaming() || m0.GetServerStreaming() {
				if m0.GetClientStreaming() && m0.GetServerStreaming() {
					method0CallType = "duplex"
				} else if m0.GetServerStreaming() {
					method0CallType = "server"
				} else {
					method0CallType = "client"
				}
			}
		}

		// When method 0 is streaming and there are unary methods later,
		// UnaryCall is prepended last (appears above other streaming call types)
		hasUnaryInService := false
		if method0CallType != "" {
			for _, m := range service.Method {
				if !m.GetClientStreaming() && !m.GetServerStreaming() {
					hasUnaryInService = true
					break
				}
			}
			if hasUnaryInService {
				g.pNoIndent("import type { UnaryCall } from \"@protobuf-ts/runtime-rpc\";")
			}
		}

		{
			// Deduplicate streaming call types: only emit at last occurrence
			// (which corresponds to first registration in protobuf-ts's forward/prepend model)
			lastCallTypeIdx := map[string]int{}
			for i, entry := range imports {
				if entry.callType != "" && entry.callType != method0CallType {
					lastCallTypeIdx[entry.callType] = i
				}
			}
			
			for i, entry := range imports {
				if entry.callType != "" {
					// Call type entry: only emit at last occurrence, skip method 0's call type
					if entry.callType == method0CallType {
						continue
					}
					if idx, ok := lastCallTypeIdx[entry.callType]; ok && idx != i {
						continue
					}
					var callTypeImport string
					switch entry.callType {
					case "duplex":
						callTypeImport = "DuplexStreamingCall"
					case "client":
						callTypeImport = "ClientStreamingCall"
					case "server":
						callTypeImport = "ServerStreamingCall"
					}
					if callTypeImport != "" {
						g.pNoIndent("import type { %s } from \"@protobuf-ts/runtime-rpc\";", callTypeImport)
					}
				} else {
					// Type import entry
					g.pNoIndent("import type { %s } from \"%s\";", entry.typeName, entry.typePath)
				}
			}
		}
	}
	
	// 4. Check if we need stackIntercept (for any method - unary or streaming)
	hasAnyMethod := false
	hasUnary := false
	for _, service := range file.Service {
		for _, method := range service.Method {
			hasAnyMethod = true
			if !method.GetClientStreaming() && !method.GetServerStreaming() {
				hasUnary = true
				break
			}
		}
		if hasUnary {
			break
		}
	}
	
	// Compute method0IsStreaming for later use
	method0IsStreaming := false
	if len(file.Service) > 0 && len(file.Service[0].Method) > 0 {
		m0 := file.Service[0].Method[0]
		method0IsStreaming = m0.GetClientStreaming() || m0.GetServerStreaming()
	}
	
	if hasAnyMethod {
		g.pNoIndent("import { stackIntercept } from \"@protobuf-ts/runtime-rpc\";")
	}
	
	// 5. Emit method 0 types (output first, then input)
	if len(file.Service) > 0 && len(file.Service[0].Method) > 0 {
		method := file.Service[0].Method[0]
		resType := g.stripPackage(method.GetOutputType())
		reqType := g.stripPackage(method.GetInputType())
		resTypePath := g.getImportPathForType(method.GetOutputType())
		reqTypePath := g.getImportPathForType(method.GetInputType())
		
		// Import output type first
		if !seen[resType] {
			g.pNoIndent("import type { %s } from \"%s\";", resType, resTypePath)
			seen[resType] = true
		}
		// Import input type second
		if !seen[reqType] {
			g.pNoIndent("import type { %s } from \"%s\";", reqType, reqTypePath)
			seen[reqType] = true
		}
		
		// If method 0 is streaming, emit its call type
		if method.GetClientStreaming() || method.GetServerStreaming() {
			var callTypeImport string
			if method.GetClientStreaming() && method.GetServerStreaming() {
				callTypeImport = "DuplexStreamingCall"
			} else if method.GetServerStreaming() {
				callTypeImport = "ServerStreamingCall"
			} else if method.GetClientStreaming() {
				callTypeImport = "ClientStreamingCall"
			}
			if callTypeImport != "" {
				g.pNoIndent("import type { %s } from \"@protobuf-ts/runtime-rpc\";", callTypeImport)
			}
		}
	}
	
	// Emit UnaryCall (if method 0 is unary) and RpcOptions
	if len(file.Service) > 0 {
		if hasUnary && !method0IsStreaming {
			g.pNoIndent("import type { UnaryCall } from \"@protobuf-ts/runtime-rpc\";")
		}
		if hasAnyMethod {
			g.pNoIndent("import type { RpcOptions } from \"@protobuf-ts/runtime-rpc\";")
		}
	}
	
	// Generate service clients
	for _, service := range file.Service {
		g.generateServiceClient(service)
	}
	
	return g.b.String()
}

func (g *generator) generateServiceClient(service *descriptorpb.ServiceDescriptorProto) {
	baseName := service.GetName()
	serviceName := escapeTypescriptKeyword(baseName)
	clientName := "I" + serviceName + "Client"
	
	pkgPrefix := ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	
	// Get service index for comments
	svcIndex := -1
	for i, s := range g.file.Service {
		if s.GetName() == baseName {
			svcIndex = i
			break
		}
	}
	
	// Interface - detached comments
	if svcIndex >= 0 {
		detachedComments := g.getLeadingDetachedComments([]int32{6, int32(svcIndex)})
		if len(detachedComments) > 0 {
			for idx, detached := range detachedComments {
				detached = strings.TrimRight(detached, "\n")
				for _, line := range strings.Split(detached, "\n") {
					line = strings.TrimRight(line, " \t")
					if line == "" {
						g.pNoIndent("// ")
					} else {
						g.pNoIndent("// %s", line)
					}
				}
				if idx < len(detachedComments)-1 {
					g.pNoIndent("")
				}
			}
			g.pNoIndent("")
		}
	}
	
	g.pNoIndent("/**")
	
	// Add service-level leading comments if available
	if svcIndex >= 0 {
		leadingComments := g.getLeadingComments([]int32{6, int32(svcIndex)})
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(leadingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.pNoIndent(" *")
				} else {
					g.pNoIndent(" * %s", escapeJSDocComment(line))
				}
			}
			if hasTrailingBlank {
				g.pNoIndent(" *")
				g.pNoIndent(" *")
			} else {
				g.pNoIndent(" *")
			}
		}
		
		trailingComments := g.getEnumTrailingComments([]int32{6, int32(svcIndex)})
		if trailingComments != "" {
			hasTrailingBlank := strings.HasSuffix(trailingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				trailingComments = strings.TrimSuffix(trailingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(trailingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.pNoIndent(" *")
				} else {
					g.pNoIndent(" * %s", escapeJSDocComment(line))
				}
			}
			if hasTrailingBlank {
				g.pNoIndent(" *")
				g.pNoIndent(" *")
			} else {
				g.pNoIndent(" *")
			}
		}
	}
	
	// Add @deprecated if service has deprecated option OR file is deprecated
	if (service.Options != nil && service.GetOptions().GetDeprecated()) || g.isFileDeprecated() {
		g.pNoIndent(" * @deprecated")
	}
	
	g.pNoIndent(" * @generated from protobuf service %s%s", pkgPrefix, baseName)
	g.pNoIndent(" */")
	g.pNoIndent("export interface %s {", clientName)
	g.indent = "    "
	
	for methodIdx, method := range service.Method {
		reqType := g.stripPackage(method.GetInputType())
		resType := g.stripPackage(method.GetOutputType())
		methodName := escapeMethodName(g.toCamelCase(method.GetName()))
		
		methodPath := []int32{6, int32(svcIndex), 2, int32(methodIdx)}
		detachedComments := g.getLeadingDetachedComments(methodPath)
		if len(detachedComments) > 0 {
			for idx, detached := range detachedComments {
				detached = strings.TrimRight(detached, "\n")
				for _, line := range strings.Split(detached, "\n") {
					line = strings.TrimRight(line, " \t")
					if line == "" {
						g.p("// ")
					} else {
						g.p("// %s", line)
					}
				}
				if idx < len(detachedComments)-1 {
					g.pNoIndent("")
				}
			}
			g.pNoIndent("")
		}
		
		g.p("/**")
		
		// Add method-level leading comments if available
		leadingComments := g.getLeadingComments(methodPath)
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(leadingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.p(" *")
				} else {
					g.p(" * %s", escapeJSDocComment(line))
				}
			}
			if hasTrailingBlank {
				g.p(" *")
				g.p(" *")
			} else {
				g.p(" *")
			}
		}
		
		trailingComments := g.getEnumTrailingComments(methodPath)
		if trailingComments != "" {
			hasTrailingBlank := strings.HasSuffix(trailingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				trailingComments = strings.TrimSuffix(trailingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(trailingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.p(" *")
				} else {
					g.p(" * %s", escapeJSDocComment(line))
				}
			}
			if hasTrailingBlank {
				g.p(" *")
				g.p(" *")
			} else {
				g.p(" *")
			}
		}
		
		// Add @deprecated if method has deprecated option OR file is deprecated
		if (method.Options != nil && method.GetOptions().GetDeprecated()) || g.isFileDeprecated() {
			g.p(" * @deprecated")
		}
		
		g.p(" * @generated from protobuf rpc: %s", method.GetName())
		g.p(" */")
		
		// Determine call type and signature based on streaming
		if method.GetClientStreaming() && method.GetServerStreaming() {
			// Bidirectional streaming
			g.p("%s(options?: RpcOptions): DuplexStreamingCall<%s, %s>;", methodName, reqType, resType)
		} else if method.GetServerStreaming() {
			// Server streaming
			g.p("%s(input: %s, options?: RpcOptions): ServerStreamingCall<%s, %s>;", methodName, reqType, reqType, resType)
		} else if method.GetClientStreaming() {
			// Client streaming
			g.p("%s(options?: RpcOptions): ClientStreamingCall<%s, %s>;", methodName, reqType, resType)
		} else {
			// Unary
			g.p("%s(input: %s, options?: RpcOptions): UnaryCall<%s, %s>;", methodName, reqType, reqType, resType)
		}
	}
	
	g.indent = ""
	g.pNoIndent("}")
	
	// Implementation - detached comments
	if svcIndex >= 0 {
		detachedComments := g.getLeadingDetachedComments([]int32{6, int32(svcIndex)})
		if len(detachedComments) > 0 {
			for idx, detached := range detachedComments {
				detached = strings.TrimRight(detached, "\n")
				for _, line := range strings.Split(detached, "\n") {
					line = strings.TrimRight(line, " \t")
					if line == "" {
						g.pNoIndent("// ")
					} else {
						g.pNoIndent("// %s", line)
					}
				}
				if idx < len(detachedComments)-1 {
					g.pNoIndent("")
				}
			}
			g.pNoIndent("")
		}
	}
	
	g.pNoIndent("/**")
	
	// Add service-level leading comments if available
	if svcIndex >= 0 {
		leadingComments := g.getLeadingComments([]int32{6, int32(svcIndex)})
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(leadingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.pNoIndent(" *")
				} else {
					g.pNoIndent(" * %s", escapeJSDocComment(line))
				}
			}
			if hasTrailingBlank {
				g.pNoIndent(" *")
				g.pNoIndent(" *")
			} else {
				g.pNoIndent(" *")
			}
		}
	}
	
	// Add service-level trailing comments if available
	if svcIndex >= 0 {
		trailingComments := g.getEnumTrailingComments([]int32{6, int32(svcIndex)})
		if trailingComments != "" {
			hasTrailingBlank := strings.HasSuffix(trailingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				trailingComments = strings.TrimSuffix(trailingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(trailingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.pNoIndent(" *")
				} else {
					g.pNoIndent(" * %s", escapeJSDocComment(line))
				}
			}
			if hasTrailingBlank {
				g.pNoIndent(" *")
				g.pNoIndent(" *")
			} else {
				g.pNoIndent(" *")
			}
		}
	}
	
	// Add @deprecated if service has deprecated option OR file is deprecated
	if (service.Options != nil && service.GetOptions().GetDeprecated()) || g.isFileDeprecated() {
		g.pNoIndent(" * @deprecated")
	}
	
	g.pNoIndent(" * @generated from protobuf service %s%s", pkgPrefix, baseName)
	g.pNoIndent(" */")
	g.pNoIndent("export class %sClient implements %s, ServiceInfo {", serviceName, clientName)
	g.indent = "    "
	g.p("typeName = %s.typeName;", serviceName)
	g.p("methods = %s.methods;", serviceName)
	g.p("options = %s.options;", serviceName)
	g.p("constructor(private readonly _transport: RpcTransport) {")
	g.p("}")
	
	for methodIdx, method := range service.Method {
		reqType := g.stripPackage(method.GetInputType())
		resType := g.stripPackage(method.GetOutputType())
		methodName := escapeMethodName(g.toCamelCase(method.GetName()))
		
		methodPath := []int32{6, int32(svcIndex), 2, int32(methodIdx)}
		detachedComments := g.getLeadingDetachedComments(methodPath)
		if len(detachedComments) > 0 {
			for idx, detached := range detachedComments {
				detached = strings.TrimRight(detached, "\n")
				for _, line := range strings.Split(detached, "\n") {
					line = strings.TrimRight(line, " \t")
					if line == "" {
						g.p("// ")
					} else {
						g.p("// %s", line)
					}
				}
				if idx < len(detachedComments)-1 {
					g.pNoIndent("")
				}
			}
			g.pNoIndent("")
		}
		
		g.p("/**")
		
		// Add method-level leading comments if available
		leadingComments := g.getLeadingComments(methodPath)
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(leadingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.p(" *")
				} else {
					g.p(" * %s", escapeJSDocComment(line))
				}
			}
			if hasTrailingBlank {
				g.p(" *")
				g.p(" *")
			} else {
				g.p(" *")
			}
		}
		
		trailingComments := g.getEnumTrailingComments(methodPath)
		if trailingComments != "" {
			hasTrailingBlank := strings.HasSuffix(trailingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				trailingComments = strings.TrimSuffix(trailingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(trailingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.p(" *")
				} else {
					g.p(" * %s", escapeJSDocComment(line))
				}
			}
			if hasTrailingBlank {
				g.p(" *")
				g.p(" *")
			} else {
				g.p(" *")
			}
		}
		
		// Add @deprecated if method has deprecated option OR file is deprecated
		if (method.Options != nil && method.GetOptions().GetDeprecated()) || g.isFileDeprecated() {
			g.p(" * @deprecated")
		}
		
		g.p(" * @generated from protobuf rpc: %s", method.GetName())
		g.p(" */")
		
		// Determine call type and implementation based on streaming
		if method.GetClientStreaming() && method.GetServerStreaming() {
			// Bidirectional streaming
			g.p("%s(options?: RpcOptions): DuplexStreamingCall<%s, %s> {", methodName, reqType, resType)
			g.indent = "        "
			g.p("const method = this.methods[%d], opt = this._transport.mergeOptions(options);", g.findMethodIndex(service, method))
			g.p("return stackIntercept<%s, %s>(\"duplex\", this._transport, method, opt);", reqType, resType)
			g.indent = "    "
			g.p("}")
		} else if method.GetServerStreaming() {
			// Server streaming
			g.p("%s(input: %s, options?: RpcOptions): ServerStreamingCall<%s, %s> {", methodName, reqType, reqType, resType)
			g.indent = "        "
			g.p("const method = this.methods[%d], opt = this._transport.mergeOptions(options);", g.findMethodIndex(service, method))
			g.p("return stackIntercept<%s, %s>(\"serverStreaming\", this._transport, method, opt, input);", reqType, resType)
			g.indent = "    "
			g.p("}")
		} else if method.GetClientStreaming() {
			// Client streaming
			g.p("%s(options?: RpcOptions): ClientStreamingCall<%s, %s> {", methodName, reqType, resType)
			g.indent = "        "
			g.p("const method = this.methods[%d], opt = this._transport.mergeOptions(options);", g.findMethodIndex(service, method))
			g.p("return stackIntercept<%s, %s>(\"clientStreaming\", this._transport, method, opt);", reqType, resType)
			g.indent = "    "
			g.p("}")
		} else {
			// Unary
			g.p("%s(input: %s, options?: RpcOptions): UnaryCall<%s, %s> {", methodName, reqType, reqType, resType)
			g.indent = "        "
			g.p("const method = this.methods[%d], opt = this._transport.mergeOptions(options);", g.findMethodIndex(service, method))
			g.p("return stackIntercept<%s, %s>(\"unary\", this._transport, method, opt, input);", reqType, resType)
			g.indent = "    "
			g.p("}")
		}
	}
	
	g.indent = ""
	g.pNoIndent("}")
}

func (g *generator) findMethodIndex(service *descriptorpb.ServiceDescriptorProto, method *descriptorpb.MethodDescriptorProto) int {
	for i, m := range service.Method {
		if m == method {
			return i
		}
	}
	return 0
}

func (g *generator) lowerFirst(s string) string {
	if len(s) == 0 {
		return s
	}
	return strings.ToLower(s[:1]) + s[1:]
}

func (g *generator) isPackedType(field *descriptorpb.FieldDescriptorProto) bool {
	// Check if the type can be packed (numeric and bool types)
	// This determines if we need to handle both packed and unpacked wire formats during deserialization
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_BOOL,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_ENUM,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return true
	default:
		return false
	}
}

func (g *generator) isFieldPacked(field *descriptorpb.FieldDescriptorProto) bool {
	// Determine if this field should be marked as packed in metadata
	// This affects how it's serialized and the RepeatType in metadata
	
	// Only packable types can be packed
	if !g.isPackedType(field) {
		return false
	}
	
	// If packed option is explicitly set, use it
	if field.Options != nil && field.GetOptions().Packed != nil {
		return field.GetOptions().GetPacked()
	}
	
	// Default behavior depends on syntax:
	// - proto3: packed by default
	// - proto2: unpacked by default
	isProto3 := g.file.GetSyntax() == "proto3"
	return isProto3
}

func (g *generator) getMapKeyDefault(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		if g.params.longType == "string" && (field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_INT64 ||
			field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_UINT64 ||
			field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SINT64 ||
			field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_FIXED64 ||
			field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SFIXED64) {
			return "\"0\""
		}
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		// Boolean keys are stored as strings in TypeScript object keys
		return "\"false\""
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "\"\""
	default:
		return "\"\""
	}
}

func (g *generator) getMapValueDefault(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		if g.params.longType == "string" {
			return "\"0\""
		}
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "false"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "\"\""
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "new Uint8Array(0)"
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		typeName := g.stripPackage(field.GetTypeName())
		return fmt.Sprintf("%s.create()", typeName)
	default:
		return "\"\""
	}
}

func (g *generator) generateService(svc *descriptorpb.ServiceDescriptorProto) {
pkgPrefix := ""
if g.file.Package != nil && *g.file.Package != "" {
pkgPrefix = *g.file.Package + "."
}

svcName := svc.GetName()
escapedSvcName := escapeTypescriptKeyword(svcName)
fullName := pkgPrefix + svcName

g.pNoIndent("/**")
// Add @deprecated if service has deprecated option OR file is deprecated
if (svc.Options != nil && svc.GetOptions().GetDeprecated()) || g.isFileDeprecated() {
	g.pNoIndent(" * @deprecated")
}
g.pNoIndent(" * @generated ServiceType for protobuf service %s", fullName)
g.pNoIndent(" */")

if len(svc.Method) == 0 {
	customSvcOpts := g.getCustomServiceOptions(svc.Options)
	if len(customSvcOpts) > 0 {
		g.pNoIndent("export const %s = new ServiceType(\"%s\", [], %s);", escapedSvcName, fullName, formatCustomOptions(customSvcOpts))
	} else {
		g.pNoIndent("export const %s = new ServiceType(\"%s\", []);", escapedSvcName, fullName)
	}
} else {
g.pNoIndent("export const %s = new ServiceType(\"%s\", [", escapedSvcName, fullName)

// Generate method descriptors
g.indent = "    "
for i, method := range svc.Method {
inputType := g.stripPackage(method.GetInputType())
outputType := g.stripPackage(method.GetOutputType())
comma := ","
if i == len(svc.Method)-1 {
comma = ""
}

	// Check if method name needs escaping and add localName
	methodName := g.toCamelCase(method.GetName())
	escapedName := escapeMethodName(methodName)
	localNameField := ""
	if escapedName != methodName {
		localNameField = fmt.Sprintf("localName: \"%s\", ", escapedName)
	}

	// Add idempotency field if specified
	idempotencyField := ""
	if method.Options != nil {
		idempotencyLevel := method.GetOptions().GetIdempotencyLevel()
		switch idempotencyLevel {
		case descriptorpb.MethodOptions_NO_SIDE_EFFECTS:
			idempotencyField = "idempotency: \"NO_SIDE_EFFECTS\", "
		case descriptorpb.MethodOptions_IDEMPOTENT:
			idempotencyField = "idempotency: \"IDEMPOTENT\", "
		}
	}

	// Build streaming flags
	streamingFlags := ""
	if method.GetServerStreaming() {
		streamingFlags += "serverStreaming: true, "
	}
	if method.GetClientStreaming() {
		streamingFlags += "clientStreaming: true, "
	}

	// Extract custom method options
	customOpts := g.getCustomMethodOptions(method.Options)
	optsStr := formatCustomOptions(customOpts)

	g.p("{ name: \"%s\", %s%s%soptions: %s, I: %s, O: %s }%s",
		method.GetName(), localNameField, idempotencyField, streamingFlags, optsStr, inputType, outputType, comma)
}
g.indent = ""
customSvcOpts := g.getCustomServiceOptions(svc.Options)
if len(customSvcOpts) > 0 {
	g.pNoIndent("], %s);", formatCustomOptions(customSvcOpts))
} else {
	g.pNoIndent("]);")
}
}
}

func (g *generator) generateTimestampMethods() {
g.indent = "    "

// now() method
g.p("/**")
g.p(" * Creates a new `Timestamp` for the current time.")
g.p(" */")
g.p("now(): Timestamp {")
g.indent = "        "
g.p("const msg = this.create();")
g.p("const ms = Date.now();")
g.p("msg.seconds = PbLong.from(Math.floor(ms / 1000)).toString();")
g.p("msg.nanos = (ms %% 1000) * 1000000;")
g.p("return msg;")
g.indent = "    "
g.p("}")

// toDate() method
g.p("/**")
g.p(" * Converts a `Timestamp` to a JavaScript Date.")
g.p(" */")
g.p("toDate(message: Timestamp): Date {")
g.indent = "        "
g.p("return new Date(PbLong.from(message.seconds).toNumber() * 1000 + Math.ceil(message.nanos / 1000000));")
g.indent = "    "
g.p("}")

// fromDate() method
g.p("/**")
g.p(" * Converts a JavaScript Date to a `Timestamp`.")
g.p(" */")
g.p("fromDate(date: Date): Timestamp {")
g.indent = "        "
g.p("const msg = this.create();")
g.p("const ms = date.getTime();")
g.p("msg.seconds = PbLong.from(Math.floor(ms / 1000)).toString();")
g.p("msg.nanos = ((ms %% 1000) + (ms < 0 && ms %% 1000 !== 0 ? 1000 : 0)) * 1000000;")
g.p("return msg;")
g.indent = "    "
g.p("}")

// internalJsonWrite() method
g.p("/**")
g.p(" * In JSON format, the `Timestamp` type is encoded as a string")
g.p(" * in the RFC 3339 format.")
g.p(" */")
g.p("internalJsonWrite(message: Timestamp, options: JsonWriteOptions): JsonValue {")
g.indent = "        "
g.p("let ms = PbLong.from(message.seconds).toNumber() * 1000;")
g.p("if (ms < Date.parse(\"0001-01-01T00:00:00Z\") || ms > Date.parse(\"9999-12-31T23:59:59Z\"))")
g.indent = "            "
g.p("throw new Error(\"Unable to encode Timestamp to JSON. Must be from 0001-01-01T00:00:00Z to 9999-12-31T23:59:59Z inclusive.\");")
g.indent = "        "
g.p("if (message.nanos < 0)")
g.indent = "            "
g.p("throw new Error(\"Unable to encode invalid Timestamp to JSON. Nanos must not be negative.\");")
g.indent = "        "
g.p("let z = \"Z\";")
g.p("if (message.nanos > 0) {")
g.indent = "            "
g.p("let nanosStr = (message.nanos + 1000000000).toString().substring(1);")
g.p("if (nanosStr.substring(3) === \"000000\")")
g.indent = "                "
g.p("z = \".\" + nanosStr.substring(0, 3) + \"Z\";")
g.indent = "            "
g.p("else if (nanosStr.substring(6) === \"000\")")
g.indent = "                "
g.p("z = \".\" + nanosStr.substring(0, 6) + \"Z\";")
g.indent = "            "
g.p("else")
g.indent = "                "
g.p("z = \".\" + nanosStr + \"Z\";")
g.indent = "        "
g.p("}")
g.p("return new Date(ms).toISOString().replace(\".000Z\", z);")
g.indent = "    "
g.p("}")

// internalJsonRead() method
g.p("/**")
g.p(" * In JSON format, the `Timestamp` type is encoded as a string")
g.p(" * in the RFC 3339 format.")
g.p(" */")
g.p("internalJsonRead(json: JsonValue, options: JsonReadOptions, target?: Timestamp): Timestamp {")
g.indent = "        "
g.p("if (typeof json !== \"string\")")
g.indent = "            "
g.p("throw new Error(\"Unable to parse Timestamp from JSON \" + typeofJsonValue(json) + \".\");")
g.indent = "        "
g.p("let matches = json.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:Z|\\.([0-9]{3,9})Z|([+-][0-9][0-9]:[0-9][0-9]))$/);")
g.p("if (!matches)")
g.indent = "            "
g.p("throw new Error(\"Unable to parse Timestamp from JSON. Invalid format.\");")
g.indent = "        "
g.p("let ms = Date.parse(matches[1] + \"-\" + matches[2] + \"-\" + matches[3] + \"T\" + matches[4] + \":\" + matches[5] + \":\" + matches[6] + (matches[8] ? matches[8] : \"Z\"));")
g.p("if (Number.isNaN(ms))")
g.indent = "            "
g.p("throw new Error(\"Unable to parse Timestamp from JSON. Invalid value.\");")
g.indent = "        "
g.p("if (ms < Date.parse(\"0001-01-01T00:00:00Z\") || ms > Date.parse(\"9999-12-31T23:59:59Z\"))")
g.indent = "            "
g.p("throw new globalThis.Error(\"Unable to parse Timestamp from JSON. Must be from 0001-01-01T00:00:00Z to 9999-12-31T23:59:59Z inclusive.\");")
g.indent = "        "
g.p("if (!target)")
g.indent = "            "
g.p("target = this.create();")
g.indent = "        "
g.p("target.seconds = PbLong.from(ms / 1000).toString();")
g.p("target.nanos = 0;")
g.p("if (matches[7])")
g.indent = "            "
g.p("target.nanos = (parseInt(\"1\" + matches[7] + \"0\".repeat(9 - matches[7].length)) - 1000000000);")
g.indent = "        "
g.p("return target;")
g.indent = "    "
g.p("}")
}

func (g *generator) generateDurationMethods() {
g.indent = "    "

// internalJsonWrite() method
g.p("/**")
g.p(" * Encode `Duration` to JSON string like \"3.000001s\".")
g.p(" */")
g.p("internalJsonWrite(message: Duration, options: JsonWriteOptions): JsonValue {")
g.indent = "        "
g.p("let s = PbLong.from(message.seconds).toNumber();")
g.p("if (s > 315576000000 || s < -315576000000)")
g.indent = "            "
g.p("throw new Error(\"Duration value out of range.\");")
g.indent = "        "
g.p("let text = message.seconds.toString();")
g.p("if (s === 0 && message.nanos < 0)")
g.indent = "            "
g.p("text = \"-\" + text;")
g.indent = "        "
g.p("if (message.nanos !== 0) {")
g.indent = "            "
g.p("let nanosStr = Math.abs(message.nanos).toString();")
g.p("nanosStr = \"0\".repeat(9 - nanosStr.length) + nanosStr;")
g.p("if (nanosStr.substring(3) === \"000000\")")
g.indent = "                "
g.p("nanosStr = nanosStr.substring(0, 3);")
g.indent = "            "
g.p("else if (nanosStr.substring(6) === \"000\")")
g.indent = "                "
g.p("nanosStr = nanosStr.substring(0, 6);")
g.indent = "            "
g.p("text += \".\" + nanosStr;")
g.indent = "        "
g.p("}")
g.p("return text + \"s\";")
g.indent = "    "
g.p("}")

// internalJsonRead() method
g.p("/**")
g.p(" * Decode `Duration` from JSON string like \"3.000001s\"")
g.p(" */")
g.p("internalJsonRead(json: JsonValue, options: JsonReadOptions, target?: Duration): Duration {")
g.indent = "        "
g.p("if (typeof json !== \"string\")")
g.indent = "            "
g.p("throw new Error(\"Unable to parse Duration from JSON \" + typeofJsonValue(json) + \". Expected string.\");")
g.indent = "        "
g.p("let match = json.match(/^(-?)([0-9]+)(?:\\.([0-9]+))?s/);")
g.p("if (match === null)")
g.indent = "            "
g.p("throw new Error(\"Unable to parse Duration from JSON string. Invalid format.\");")
g.indent = "        "
g.p("if (!target)")
g.indent = "            "
g.p("target = this.create();")
g.indent = "        "
g.p("let [, sign, secs, nanos] = match;")
g.p("let longSeconds = PbLong.from(sign + secs);")
g.p("if (longSeconds.toNumber() > 315576000000 || longSeconds.toNumber() < -315576000000)")
g.indent = "            "
g.p("throw new Error(\"Unable to parse Duration from JSON string. Value out of range.\");")
g.indent = "        "
g.p("target.seconds = longSeconds.toString();")
g.p("if (typeof nanos == \"string\") {")
g.indent = "            "
g.p("let nanosStr = sign + nanos + \"0\".repeat(9 - nanos.length);")
g.p("target.nanos = parseInt(nanosStr);")
g.indent = "        "
g.p("}")
g.p("return target;")
g.indent = "    "
g.p("}")
}

func (g *generator) generateFieldMaskMethods() {
	g.indent = "    "
	
	// internalJsonWrite() method
	g.p("/**")
	g.p(" * Encode `FieldMask` to JSON object.")
	g.p(" */")
	g.p("internalJsonWrite(message: FieldMask, options: JsonWriteOptions): JsonValue {")
	g.indent = "        "
	g.p("const invalidFieldMaskJsonRegex = /[A-Z]|(_([.0-9_]|$))/g;")
	g.p("return message.paths.map(p => {")
	g.indent = "            "
	g.p("if (invalidFieldMaskJsonRegex.test(p))")
	g.indent = "                "
	g.p("%s", "throw new Error(\"Unable to encode FieldMask to JSON. lowerCamelCase of path name \\\"\" + p + \"\\\" is irreversible.\");")
	g.indent = "            "
	g.p("return lowerCamelCase(p);")
	g.indent = "        "
	g.p("}).join(\",\");")
	g.indent = "    "
	g.p("}")
	
	// internalJsonRead() method
	g.p("/**")
	g.p(" * Decode `FieldMask` from JSON object.")
	g.p(" */")
	g.p("internalJsonRead(json: JsonValue, options: JsonReadOptions, target?: FieldMask): FieldMask {")
	g.indent = "        "
	g.p("if (typeof json !== \"string\")")
	g.indent = "            "
	g.p("throw new Error(\"Unable to parse FieldMask from JSON \" + typeofJsonValue(json) + \". Expected string.\");")
	g.indent = "        "
	g.p("if (!target)")
	g.indent = "            "
	g.p("target = this.create();")
	g.indent = "        "
	g.p("if (json === \"\")")
	g.indent = "            "
	g.p("return target;")
	g.indent = "        "
	g.p("let camelToSnake = (str: string) => {")
	g.indent = "            "
	g.p("if (str.includes(\"_\"))")
	g.indent = "                "
	g.p("throw new Error(\"Unable to parse FieldMask from JSON. Path names must be lowerCamelCase.\");")
	g.indent = "            "
	g.p("%s", "let sc = str.replace(/[A-Z]/g, letter => \"_\" + letter.toLowerCase());")
	g.p("return sc;")
	g.indent = "        "
	g.p("};")
	g.p("target.paths = json.split(\",\").map(camelToSnake);")
	g.p("return target;")
	g.indent = "    "
	g.p("}")
}

func (g *generator) generateStructMethods(typeName string) {
	g.indent = "    "
	
	if typeName == "Struct" {
		// internalJsonWrite for Struct
		g.p("/**")
		g.p(" * Encode `Struct` to JSON object.")
		g.p(" */")
		g.p("internalJsonWrite(message: Struct, options: JsonWriteOptions): JsonValue {")
		g.indent = "        "
		g.p("let json: JsonObject = {};")
		g.p("for (let [k, v] of Object.entries(message.fields)) {")
		g.indent = "            "
		g.p("json[k] = Value.toJson(v);")
		g.indent = "        "
		g.p("}")
		g.p("return json;")
		g.indent = "    "
		g.p("}")
		
		// internalJsonRead for Struct
		g.p("/**")
		g.p(" * Decode `Struct` from JSON object.")
		g.p(" */")
		g.p("internalJsonRead(json: JsonValue, options: JsonReadOptions, target?: Struct): Struct {")
		g.indent = "        "
		g.p("if (!isJsonObject(json))")
		g.indent = "            "
		g.p("%s", "throw new globalThis.Error(\"Unable to parse message \" + this.typeName + \" from JSON \" + typeofJsonValue(json) + \".\");")
		g.indent = "        "
		g.p("if (!target)")
		g.indent = "            "
		g.p("target = this.create();")
		g.indent = "        "
		g.p("for (let [k, v] of globalThis.Object.entries(json)) {")
		g.indent = "            "
		g.p("target.fields[k] = Value.fromJson(v);")
		g.indent = "        "
		g.p("}")
		g.p("return target;")
		g.indent = "    "
		g.p("}")
	} else if typeName == "Value" {
		// internalJsonWrite for Value
		g.p("/**")
		g.p(" * Encode `Value` to JSON value.")
		g.p(" */")
		g.p("internalJsonWrite(message: Value, options: JsonWriteOptions): JsonValue {")
		g.indent = "        "
		g.p("if (message.kind.oneofKind === undefined)")
		g.indent = "            "
		g.p("%s", "throw new globalThis.Error();")
		g.indent = "        "
		g.p("switch (message.kind.oneofKind) {")
		g.indent = "            "
		g.p("case undefined: throw new globalThis.Error();")
		g.p("case \"boolValue\": return message.kind.boolValue;")
		g.p("case \"nullValue\": return null;")
		g.p("case \"numberValue\":")
		g.indent = "                "
		g.p("let numberValue = message.kind.numberValue;")
		g.p("if (typeof numberValue == \"number\" && !Number.isFinite(numberValue))")
		g.indent = "                    "
		g.p("%s", "throw new globalThis.Error();")
		g.indent = "                "
		g.p("return numberValue;")
		g.indent = "            "
		g.p("case \"stringValue\": return message.kind.stringValue;")
		g.p("case \"listValue\":")
		g.indent = "                "
		g.p("let listValueField = this.fields.find(f => f.no === 6);")
		g.p("if (listValueField?.kind !== \"message\")")
		g.indent = "                    "
		g.p("%s", "throw new globalThis.Error();")
		g.indent = "                "
		g.p("return listValueField.T().toJson(message.kind.listValue);")
		g.indent = "            "
		g.p("case \"structValue\":")
		g.indent = "                "
		g.p("let structValueField = this.fields.find(f => f.no === 5);")
		g.p("if (structValueField?.kind !== \"message\")")
		g.indent = "                    "
		g.p("%s", "throw new globalThis.Error();")
		g.indent = "                "
		g.p("return structValueField.T().toJson(message.kind.structValue);")
		g.indent = "        "
		g.p("}")
		g.indent = "    "
		g.p("}")
		
		// internalJsonRead for Value
		g.p("/**")
		g.p(" * Decode `Value` from JSON value.")
		g.p(" */")
		g.p("internalJsonRead(json: JsonValue, options: JsonReadOptions, target?: Value): Value {")
		g.indent = "        "
		g.p("if (!target)")
		g.indent = "            "
		g.p("target = this.create();")
		g.indent = "        "
		g.p("switch (typeof json) {")
		g.indent = "            "
		g.p("case \"number\":")
		g.indent = "                "
		g.p("target.kind = { oneofKind: \"numberValue\", numberValue: json };")
		g.p("break;")
		g.indent = "            "
		g.p("case \"string\":")
		g.indent = "                "
		g.p("target.kind = { oneofKind: \"stringValue\", stringValue: json };")
		g.p("break;")
		g.indent = "            "
		g.p("case \"boolean\":")
		g.indent = "                "
		g.p("target.kind = { oneofKind: \"boolValue\", boolValue: json };")
		g.p("break;")
		g.indent = "            "
		g.p("case \"object\":")
		g.indent = "                "
		g.p("if (json === null) {")
		g.indent = "                    "
		g.p("target.kind = { oneofKind: \"nullValue\", nullValue: NullValue.NULL_VALUE };")
		g.indent = "                "
		g.p("}")
		g.p("else if (globalThis.Array.isArray(json)) {")
		g.indent = "                    "
		g.p("target.kind = { oneofKind: \"listValue\", listValue: ListValue.fromJson(json) };")
		g.indent = "                "
		g.p("}")
		g.p("else {")
		g.indent = "                    "
		g.p("target.kind = { oneofKind: \"structValue\", structValue: Struct.fromJson(json) };")
		g.indent = "                "
		g.p("}")
		g.p("break;")
		g.indent = "            "
		g.p("default: throw new globalThis.Error(\"Unable to parse \" + this.typeName + \" from JSON \" + typeofJsonValue(json));")
		g.indent = "        "
		g.p("}")
		g.p("return target;")
		g.indent = "    "
		g.p("}")
	} else if typeName == "ListValue" {
		// internalJsonWrite for ListValue
		g.p("/**")
		g.p(" * Encode `ListValue` to JSON array.")
		g.p(" */")
		g.p("internalJsonWrite(message: ListValue, options: JsonWriteOptions): JsonValue {")
		g.indent = "        "
		g.p("return message.values.map(v => Value.toJson(v));")
		g.indent = "    "
		g.p("}")
		
		// internalJsonRead for ListValue
		g.p("/**")
		g.p(" * Decode `ListValue` from JSON array.")
		g.p(" */")
		g.p("internalJsonRead(json: JsonValue, options: JsonReadOptions, target?: ListValue): ListValue {")
		g.indent = "        "
		g.p("if (!globalThis.Array.isArray(json))")
		g.indent = "            "
		g.p("%s", "throw new globalThis.Error(\"Unable to parse \" + this.typeName + \" from JSON \" + typeofJsonValue(json));")
		g.indent = "        "
		g.p("if (!target)")
		g.indent = "            "
		g.p("target = this.create();")
		g.indent = "        "
		g.p("let values = json.map(v => Value.fromJson(v));")
		g.p("target.values.push(...values);")
		g.p("return target;")
		g.indent = "    "
		g.p("}")
	}
}

func (g *generator) generateWrapperMethods(typeName string) {
	g.indent = "    "
	
	// internalJsonWrite() method
	g.p("/**")
	switch typeName {
	case "DoubleValue":
		g.p(" * Encode `%s` to JSON number.", typeName)
	case "FloatValue":
		g.p(" * Encode `%s` to JSON number.", typeName)
	case "Int64Value":
		g.p(" * Encode `%s` to JSON string.", typeName)
	case "UInt64Value":
		g.p(" * Encode `%s` to JSON string.", typeName)
	case "Int32Value":
		g.p(" * Encode `%s` to JSON string.", typeName)
	case "UInt32Value":
		g.p(" * Encode `%s` to JSON string.", typeName)
	case "BoolValue":
		g.p(" * Encode `%s` to JSON bool.", typeName)
	case "StringValue":
		g.p(" * Encode `%s` to JSON string.", typeName)
	case "BytesValue":
		g.p(" * Encode `%s` to JSON string.", typeName)
	}
	g.p(" */")
	g.p("internalJsonWrite(message: %s, options: JsonWriteOptions): JsonValue {", typeName)
	g.indent = "        "
	
	// Handle write based on type
	switch typeName {
	case "DoubleValue":
		g.p("return this.refJsonWriter.scalar(2, message.value, \"value\", false, true);")
	case "FloatValue":
		g.p("return this.refJsonWriter.scalar(1, message.value, \"value\", false, true);")
	case "Int64Value":
		g.p("return this.refJsonWriter.scalar(ScalarType.INT64, message.value, \"value\", false, true);")
	case "UInt64Value":
		g.p("return this.refJsonWriter.scalar(ScalarType.UINT64, message.value, \"value\", false, true);")
	case "Int32Value":
		g.p("return this.refJsonWriter.scalar(5, message.value, \"value\", false, true);")
	case "UInt32Value":
		g.p("return this.refJsonWriter.scalar(13, message.value, \"value\", false, true);")
	case "BoolValue":
		g.p("return message.value;")
	case "StringValue":
		g.p("return message.value;")
	case "BytesValue":
		g.p("return this.refJsonWriter.scalar(12, message.value, \"value\", false, true);")
	}
	
	g.indent = "    "
	g.p("}")
	
	// internalJsonRead() method
	g.p("/**")
	switch typeName {
	case "DoubleValue":
		g.p(" * Decode `%s` from JSON number.", typeName)
	case "FloatValue":
		g.p(" * Decode `%s` from JSON number.", typeName)
	case "Int64Value":
		g.p(" * Decode `%s` from JSON string.", typeName)
	case "UInt64Value":
		g.p(" * Decode `%s` from JSON string.", typeName)
	case "Int32Value":
		g.p(" * Decode `%s` from JSON string.", typeName)
	case "UInt32Value":
		g.p(" * Decode `%s` from JSON string.", typeName)
	case "BoolValue":
		g.p(" * Decode `%s` from JSON bool.", typeName)
	case "StringValue":
		g.p(" * Decode `%s` from JSON string.", typeName)
	case "BytesValue":
		g.p(" * Decode `%s` from JSON string.", typeName)
	}
	g.p(" */")
	g.p("internalJsonRead(json: JsonValue, options: JsonReadOptions, target?: %s): %s {", typeName, typeName)
	g.indent = "        "
	g.p("if (!target)")
	g.indent = "            "
	g.p("target = this.create();")
	g.indent = "        "
	
	// Handle read based on type
	switch typeName {
	case "DoubleValue":
		g.p("target.value = this.refJsonReader.scalar(json, 1, undefined, \"value\") as number;")
	case "FloatValue":
		g.p("target.value = this.refJsonReader.scalar(json, 1, undefined, \"value\") as number;")
	case "Int64Value":
		g.p("target.value = this.refJsonReader.scalar(json, ScalarType.INT64, LongType.STRING, \"value\") as any;")
	case "UInt64Value":
		g.p("target.value = this.refJsonReader.scalar(json, ScalarType.UINT64, LongType.STRING, \"value\") as any;")
	case "Int32Value":
		g.p("target.value = this.refJsonReader.scalar(json, 5, undefined, \"value\") as number;")
	case "UInt32Value":
		g.p("target.value = this.refJsonReader.scalar(json, 13, undefined, \"value\") as number;")
	case "BoolValue":
		g.p("target.value = this.refJsonReader.scalar(json, 8, undefined, \"value\") as boolean;")
	case "StringValue":
		g.p("target.value = this.refJsonReader.scalar(json, 9, undefined, \"value\") as string;")
	case "BytesValue":
		g.p("target.value = this.refJsonReader.scalar(json, 12, undefined, \"value\") as Uint8Array;")
	}
	
	g.p("return target;")
	g.indent = "    "
	g.p("}")
}

func (g *generator) generateAnyMethods() {
	g.indent = "    "
	
	// pack() method
	g.p("/**")
	g.p(" * Pack the message into a new `Any`.")
	g.p(" *")
	g.p(" * Uses 'type.googleapis.com/full.type.name' as the type URL.")
	g.p(" */")
	g.p("pack<T extends object>(message: T, type: IMessageType<T>): Any {")
	g.indent = "        "
	g.p("return {")
	g.indent = "            "
	g.p("typeUrl: this.typeNameToUrl(type.typeName), value: type.toBinary(message),")
	g.indent = "        "
	g.p("};")
	g.indent = "    "
	g.p("}")
	
	// unpack() method
	g.p("/**")
	g.p(" * Unpack the message from the `Any`.")
	g.p(" */")
	g.p("unpack<T extends object>(any: Any, type: IMessageType<T>, options?: Partial<BinaryReadOptions>): T {")
	g.indent = "        "
	g.p("if (!this.contains(any, type))")
	g.indent = "            "
	g.p("throw new Error(\"Cannot unpack google.protobuf.Any with typeUrl '\" + any.typeUrl + \"' as \" + type.typeName + \".\");")
	g.indent = "        "
	g.p("return type.fromBinary(any.value, options);")
	g.indent = "    "
	g.p("}")
	
	// contains() method
	g.p("/**")
	g.p(" * Does the given `Any` contain a packed message of the given type?")
	g.p(" */")
	g.p("contains(any: Any, type: IMessageType<any> | string): boolean {")
	g.indent = "        "
	g.p("if (!any.typeUrl.length)")
	g.indent = "            "
	g.p("return false;")
	g.indent = "        "
	g.p("let wants = typeof type == \"string\" ? type : type.typeName;")
	g.p("let has = this.typeUrlToName(any.typeUrl);")
	g.p("return wants === has;")
	g.indent = "    "
	g.p("}")
	
	// internalJsonWrite() method
	g.p("/**")
	g.p(" * Convert the message to canonical JSON value.")
	g.p(" *")
	g.p(" * You have to provide the `typeRegistry` option so that the")
	g.p(" * packed message can be converted to JSON.")
	g.p(" *")
	g.p(" * The `typeRegistry` option is also required to read")
	g.p(" * `google.protobuf.Any` from JSON format.")
	g.p(" */")
	g.p("internalJsonWrite(any: Any, options: JsonWriteOptions): JsonValue {")
	g.indent = "        "
	g.p("if (any.typeUrl === \"\")")
	g.indent = "            "
	g.p("return {};")
	g.indent = "        "
	g.p("let typeName = this.typeUrlToName(any.typeUrl);")
	g.p("let opt = jsonWriteOptions(options);")
	g.p("let type = opt.typeRegistry?.find(t => t.typeName === typeName);")
	g.p("if (!type)")
	g.indent = "            "
	g.p("throw new globalThis.Error(\"Unable to convert google.protobuf.Any with typeUrl '\" + any.typeUrl + \"' to JSON. The specified type \" + typeName + \" is not available in the type registry.\");")
	g.indent = "        "
	g.p("let value = type.fromBinary(any.value, { readUnknownField: false });")
	g.p("let json = type.internalJsonWrite(value, opt);")
	g.p("if (typeName.startsWith(\"google.protobuf.\") || !isJsonObject(json))")
	g.indent = "            "
	g.p("json = { value: json };")
	g.indent = "        "
	g.p("json[\"@type\"] = any.typeUrl;")
	g.p("return json;")
	g.indent = "    "
	g.p("}")
	
	// internalJsonRead() method
	g.p("internalJsonRead(json: JsonValue, options: JsonReadOptions, target?: Any): Any {")
	g.indent = "        "
	g.p("if (!isJsonObject(json))")
	g.indent = "            "
	g.p("throw new globalThis.Error(\"Unable to parse google.protobuf.Any from JSON \" + typeofJsonValue(json) + \".\");")
	g.indent = "        "
	g.p("if (typeof json[\"@type\"] != \"string\" || json[\"@type\"] == \"\")")
	g.indent = "            "
	g.p("return this.create();")
	g.indent = "        "
	g.p("let typeName = this.typeUrlToName(json[\"@type\"]);")
	g.p("let type = options?.typeRegistry?.find(t => t.typeName == typeName);")
	g.p("if (!type)")
	g.indent = "            "
	g.p("throw new globalThis.Error(\"Unable to parse google.protobuf.Any from JSON. The specified type \" + typeName + \" is not available in the type registry.\");")
	g.indent = "        "
	g.p("let value;")
	g.p("if (typeName.startsWith(\"google.protobuf.\") && json.hasOwnProperty(\"value\"))")
	g.indent = "            "
	g.p("value = type.fromJson(json[\"value\"], options);")
	g.indent = "        "
	g.p("else {")
	g.indent = "            "
	g.p("let copy = Object.assign({}, json);")
	g.p("delete copy[\"@type\"];")
	g.p("value = type.fromJson(copy, options);")
	g.indent = "        "
	g.p("}")
	g.p("if (target === undefined)")
	g.indent = "            "
	g.p("target = this.create();")
	g.indent = "        "
	g.p("target.typeUrl = json[\"@type\"];")
	g.p("target.value = type.toBinary(value);")
	g.p("return target;")
	g.indent = "    "
	g.p("}")
	
	// typeNameToUrl() method
	g.p("typeNameToUrl(name: string): string {")
	g.indent = "        "
	g.p("if (!name.length)")
	g.indent = "            "
	g.p("throw new Error(\"invalid type name: \" + name);")
	g.indent = "        "
	g.p("return \"type.googleapis.com/\" + name;")
	g.indent = "    "
	g.p("}")
	
	// typeUrlToName() method
	g.p("typeUrlToName(url: string): string {")
	g.indent = "        "
	g.p("if (!url.length)")
	g.indent = "            "
	g.p("throw new Error(\"invalid type url: \" + url);")
	g.indent = "        "
	g.p("let slash = url.lastIndexOf(\"/\");")
	g.p("let name = slash > 0 ? url.substring(slash + 1) : url;")
	g.p("if (!name.length)")
	g.indent = "            "
	g.p("throw new Error(\"invalid type url: \" + url);")
	g.indent = "        "
	g.p("return name;")
	g.indent = "    "
	g.p("}")
}

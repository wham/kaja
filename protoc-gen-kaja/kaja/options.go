package kaja

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/types/descriptorpb"
)

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
	ext           *descriptorpb.FieldDescriptorProto
	pkg           string
	msgPrefix     string // parent message name(s) for nested extensions, e.g. "Extensions."
	registryOrder int    // order this extension was discovered (for matching TS plugin output order)
}

// buildExtensionMap builds a map of extension field number -> extension info for a given extendee type
func (g *generator) buildExtensionMap(extendeeName string) map[int32]extInfo {
	extensionMap := make(map[int32]extInfo)
	order := 0

	collectFromFile := func(f *descriptorpb.FileDescriptorProto) {
		pkg := ""
		if f.Package != nil {
			pkg = *f.Package
		}
		// Top-level extensions
		for _, ext := range f.Extension {
			if ext.GetExtendee() == extendeeName {
				extensionMap[ext.GetNumber()] = extInfo{ext: ext, pkg: pkg, registryOrder: order}
				order++
			}
		}
		// Extensions nested in messages (recursively)
		var scanMsg func(msg *descriptorpb.DescriptorProto, prefix string)
		scanMsg = func(msg *descriptorpb.DescriptorProto, prefix string) {
			msgPrefix := prefix + msg.GetName() + "."
			for _, ext := range msg.Extension {
				if ext.GetExtendee() == extendeeName {
					extensionMap[ext.GetNumber()] = extInfo{ext: ext, pkg: pkg, msgPrefix: msgPrefix, registryOrder: order}
					order++
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
				// Use the LAST value with matching number (JS object overwrite behavior for allow_alias)
				result := ""
				for _, val := range enum.Value {
					if val.GetNumber() == number {
						result = val.GetName()
					}
				}
				if result != "" {
					return result
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
	return g.findEnumInMessageWithPrefix(prefix, msg, typeName, number)
}

func (g *generator) findEnumInMessageWithPrefix(prefix string, msg *descriptorpb.DescriptorProto, typeName string, number int32) string {
	for _, enum := range msg.EnumType {
		fqn := prefix + "." + enum.GetName()
		if fqn == typeName {
			// Use the LAST value with matching number (JS object overwrite behavior for allow_alias)
			result := ""
			for _, val := range enum.Value {
				if val.GetNumber() == number {
					result = val.GetName()
				}
			}
			if result != "" {
				return result
			}
		}
	}
	for _, nested := range msg.NestedType {
		nestedPrefix := prefix + "." + nested.GetName()
		if name := g.findEnumInMessageWithPrefix(nestedPrefix, nested, typeName, number); name != "" {
			return name
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

		// Handle packed repeated encoding: when wire type is BytesType but field type
		// is a varint-based scalar (enum, bool, int32, etc.), protoc sends packed encoding
		if typ == protowire.BytesType && isVarintFieldType(ext.GetType()) {
			packedData, n := protowire.ConsumeBytes(unknown)
			unknown = unknown[n:]
			for len(packedData) > 0 {
				v, vn := protowire.ConsumeVarint(packedData)
				if vn < 0 {
					break
				}
				packedData = packedData[vn:]
				opt := g.parseVarintValue(ext, extName, v)
				result = append(result, opt)
			}
			continue
		}

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
			if ext.GetTypeName() == ".google.protobuf.NullValue" {
				result = append(result, customOption{key: extName, value: nil})
			} else {
				enumName := g.resolveEnumValueName(ext.GetTypeName(), int32(v))
				result = append(result, customOption{key: extName, value: enumName})
			}
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
				nested := g.parseMessageValue(v, msgDesc, ext.GetTypeName())
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

	// Ensure repeated (non-map) extension fields are always arrays, even with a single element.
	repeatedExts := make(map[string]bool)
	for _, ei := range extensionMap {
		if ei.ext.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
			if ei.ext.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
				nestedMsg := g.findMessageType(ei.ext.GetTypeName())
				if nestedMsg != nil && nestedMsg.Options != nil && nestedMsg.GetOptions().GetMapEntry() {
					continue
				}
			}
			pkg := ei.pkg
			if pkg != "" {
				pkg += "."
			}
			repeatedExts[pkg+ei.msgPrefix+ei.ext.GetName()] = true
		}
	}
	for i, opt := range result {
		if repeatedExts[opt.key] {
			if _, ok := opt.value.([]interface{}); !ok {
				result[i].value = []interface{}{opt.value}
			}
		}
	}

	// Sort by registry order (the order extensions were discovered across files)
	// to match the TS plugin's output order, which uses registration order not field number order.
	extOrder := make(map[string]int, len(extensionMap))
	for _, ei := range extensionMap {
		pkg := ei.pkg
		if pkg != "" {
			pkg += "."
		}
		extOrder[pkg+ei.msgPrefix+ei.ext.GetName()] = ei.registryOrder
	}
	sort.SliceStable(result, func(i, j int) bool {
		return extOrder[result[i].key] < extOrder[result[j].key]
	})

	return result
}

// isVarintFieldType returns true if the proto field type uses varint wire encoding
func isVarintFieldType(t descriptorpb.FieldDescriptorProto_Type) bool {
	switch t {
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL,
		descriptorpb.FieldDescriptorProto_TYPE_ENUM,
		descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return true
	}
	return false
}

// parseVarintValue interprets a varint value according to the extension's field type
func (g *generator) parseVarintValue(ext *descriptorpb.FieldDescriptorProto, extName string, v uint64) customOption {
	switch ext.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return customOption{key: extName, value: v != 0}
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		if ext.GetTypeName() == ".google.protobuf.NullValue" {
			return customOption{key: extName, value: nil}
		}
		enumName := g.resolveEnumValueName(ext.GetTypeName(), int32(v))
		return customOption{key: extName, value: enumName}
	case descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return customOption{key: extName, value: int(v)}
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return customOption{key: extName, value: fmt.Sprintf("%d", int64(v))}
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		return customOption{key: extName, value: fmt.Sprintf("%d", v)}
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return customOption{key: extName, value: int(protowire.DecodeZigZag(v))}
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return customOption{key: extName, value: fmt.Sprintf("%d", protowire.DecodeZigZag(v))}
	default:
		return customOption{key: extName, value: int(v)}
	}
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
	// Sort map entries to match JavaScript Object.keys() enumeration order:
	// integer-index keys (0..2^32-2) come first in ascending numeric order,
	// followed by non-integer keys in insertion order.
	for i, opt := range merged {
		if entries, ok := opt.value.([]customOption); ok {
			merged[i].value = sortMapEntriesJSOrder(entries)
		}
	}
	return merged
}

// sortMapEntriesJSOrder sorts []customOption entries the way JavaScript's
// Object.keys() would enumerate them: array-index keys first (ascending
// numeric), then everything else in insertion order.
func sortMapEntriesJSOrder(entries []customOption) []customOption {
	// Separate integer-index keys from non-integer keys
	type indexedEntry struct {
		idx   uint64
		entry customOption
	}
	var intEntries []indexedEntry
	var otherEntries []customOption

	for _, e := range entries {
		// Keys may be quoted like `"1"` — strip quotes for the check
		raw := e.key
		if len(raw) >= 2 && raw[0] == '"' && raw[len(raw)-1] == '"' {
			raw = raw[1 : len(raw)-1]
		}
		if isArrayIndex(raw) {
			v, _ := strconv.ParseUint(raw, 10, 64)
			intEntries = append(intEntries, indexedEntry{idx: v, entry: e})
		} else {
			otherEntries = append(otherEntries, e)
		}
	}

	if len(intEntries) <= 1 && len(otherEntries) == 0 {
		return entries // nothing to reorder
	}
	if len(intEntries) == 0 {
		return entries // nothing to reorder
	}

	sort.Slice(intEntries, func(i, j int) bool {
		return intEntries[i].idx < intEntries[j].idx
	})

	result := make([]customOption, 0, len(entries))
	for _, ie := range intEntries {
		result = append(result, ie.entry)
	}
	result = append(result, otherEntries...)
	return result
}

// parseMessageValue decodes a message's wire bytes into an ordered list of field name→value pairs
func (g *generator) parseMessageValue(data []byte, msgDesc *descriptorpb.DescriptorProto, msgTypeName string) []customOption {
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
						if fd.GetTypeName() == ".google.protobuf.NullValue" {
							result = append(result, customOption{key: fieldName, value: nil})
						} else {
							enumName := g.resolveEnumValueName(fd.GetTypeName(), int32(v))
							result = append(result, customOption{key: fieldName, value: enumName})
						}
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
			if fd.GetTypeName() == ".google.protobuf.NullValue" {
				result = append(result, customOption{key: fieldName, value: nil})
			} else {
				enumName := g.resolveEnumValueName(fd.GetTypeName(), int32(v))
				result = append(result, customOption{key: fieldName, value: enumName})
			}
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
					nested := g.parseMessageValue(v, nestedMsg, fd.GetTypeName())
					var mapKey string
					var mapVal interface{}
					for _, e := range nested {
						if e.key == "key" {
							mapKey = fmt.Sprintf("%v", e.value)
						} else if e.key == "value" {
							mapVal = e.value
						}
					}
					result = append(result, customOption{key: fieldName, value: mapEntryValue{key: mapKey, value: mapVal}})
				} else {
					nested := g.parseMessageValue(v, nestedMsg, fd.GetTypeName())
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
	merged := mergeRepeatedOptions(result)
	// Ensure repeated (non-map) fields are always arrays, even with a single element.
	// protobuf-ts toJson() always emits arrays for repeated fields.
	repeatedFields := make(map[string]bool)
	for _, fd := range msgDesc.Field {
		if fd.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
			// Skip map entries — they are handled as objects, not arrays
			if fd.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
				nestedMsg := g.findMessageType(fd.GetTypeName())
				if nestedMsg != nil && nestedMsg.Options != nil && nestedMsg.GetOptions().GetMapEntry() {
					continue
				}
			}
			repeatedFields[fd.GetJsonName()] = true
		}
	}
	for i, opt := range merged {
		if repeatedFields[opt.key] {
			if _, ok := opt.value.([]interface{}); !ok {
				merged[i].value = []interface{}{opt.value}
			}
		}
	}
	// Filter out fields with default values (protobuf-ts toJson() omits defaults).
	// Skip for map entry messages — key/value fields are always meaningful.
	// Skip for fields with explicit presence (proto2 optional, proto3 explicit optional) —
	// protobuf-ts sets field.opt=true for these, so toJson() always emits them.
	if !(msgDesc.Options != nil && msgDesc.GetOptions().GetMapEntry()) {
		syntax := g.findFileSyntaxForMessageType(msgTypeName)
		isProto2 := syntax == "proto2" || syntax == ""
		jsonNameToField := make(map[string]*descriptorpb.FieldDescriptorProto)
		for _, fd := range msgDesc.Field {
			jsonNameToField[fd.GetJsonName()] = fd
		}
		var filtered []customOption
		for _, opt := range merged {
			if fd, ok := jsonNameToField[opt.key]; ok && g.isDefaultValue(fd, opt.value) {
				// In proto2, optional fields have presence → keep defaults
				// In proto3, explicit optional fields have presence → keep defaults
				hasPresence := false
				if isProto2 {
					hasPresence = fd.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL
				} else {
					// proto3 explicit optional or oneof member (non-synthetic)
					hasPresence = fd.GetProto3Optional()
					if !hasPresence && fd.OneofIndex != nil {
						hasPresence = true
					}
				}
				if !hasPresence {
					continue
				}
			}
			filtered = append(filtered, opt)
		}
		merged = filtered
	}
	// Reorder fields to match the message descriptor's declaration order.
	// protoc serializes by field number, but protobuf-ts toJson() emits in declaration order.
	fieldOrder := make(map[string]int)
	for i, fd := range msgDesc.Field {
		fieldOrder[fd.GetJsonName()] = i
	}
	sort.SliceStable(merged, func(i, j int) bool {
		oi, oki := fieldOrder[merged[i].key]
		oj, okj := fieldOrder[merged[j].key]
		if oki && okj {
			return oi < oj
		}
		return false
	})
	return merged
}

func (g *generator) getCustomMethodOptions(opts *descriptorpb.MethodOptions) []customOption {
	if opts == nil {
		return nil
	}
	extensionMap := g.buildExtensionMap(".google.protobuf.MethodOptions")
	allOpts := g.parseCustomOptions(opts.ProtoReflect().GetUnknown(), extensionMap)
	return filterExcludedOptions(allOpts, g.getExcludeOptions())
}

func (g *generator) getCustomMessageOptions(opts *descriptorpb.MessageOptions) []customOption {
	if opts == nil {
		return nil
	}
	extensionMap := g.buildExtensionMap(".google.protobuf.MessageOptions")
	allOpts := g.parseCustomOptions(opts.ProtoReflect().GetUnknown(), extensionMap)
	return filterExcludedOptions(allOpts, g.getExcludeOptions())
}

func (g *generator) getCustomFieldOptions(opts *descriptorpb.FieldOptions) []customOption {
	if opts == nil {
		return nil
	}
	extensionMap := g.buildExtensionMap(".google.protobuf.FieldOptions")
	allOpts := g.parseCustomOptions(opts.ProtoReflect().GetUnknown(), extensionMap)
	return filterExcludedOptions(allOpts, g.getExcludeOptions())
}

func (g *generator) getCustomServiceOptions(opts *descriptorpb.ServiceOptions) []customOption {
	if opts == nil {
		return nil
	}
	extensionMap := g.buildExtensionMap(".google.protobuf.ServiceOptions")
	allOpts := g.parseCustomOptions(opts.ProtoReflect().GetUnknown(), extensionMap)
	// protobuf-ts only excludes ts.client from service options (not ts.server)
	var filtered []customOption
	for _, opt := range allOpts {
		if opt.key == "ts.client" {
			continue
		}
		filtered = append(filtered, opt)
	}
	return filterExcludedOptions(filtered, g.getExcludeOptions())
}

// getExcludeOptions reads ts.exclude_options from the current file's FileOptions.
// Field 777701 in google.protobuf.FileOptions from package ts, repeated string.
func (g *generator) getExcludeOptions() []string {
	if g.file.Options == nil {
		return nil
	}
	unknown := g.file.Options.ProtoReflect().GetUnknown()
	var patterns []string
	for len(unknown) > 0 {
		num, typ, n := protowire.ConsumeTag(unknown)
		if n < 0 {
			break
		}
		unknown = unknown[n:]
		switch typ {
		case protowire.BytesType:
			val, n := protowire.ConsumeBytes(unknown)
			if n < 0 {
				return patterns
			}
			unknown = unknown[n:]
			if num == 777701 {
				patterns = append(patterns, string(val))
			}
		case protowire.VarintType:
			_, n := protowire.ConsumeVarint(unknown)
			if n < 0 {
				return patterns
			}
			unknown = unknown[n:]
		case protowire.Fixed32Type:
			unknown = unknown[4:]
		case protowire.Fixed64Type:
			unknown = unknown[8:]
		default:
			return patterns
		}
	}
	return patterns
}

// filterExcludedOptions removes custom options whose keys match any exclude pattern.
// Matches protobuf-ts behavior: literal patterns (no *) use exact match (key === pattern),
// wildcard patterns are converted to regex (dots escaped, * → .*) and matched as substrings.
func filterExcludedOptions(opts []customOption, excludePatterns []string) []customOption {
	if len(excludePatterns) == 0 {
		return opts
	}
	var literals []string
	var regexes []*regexp.Regexp
	for _, pattern := range excludePatterns {
		if strings.Contains(pattern, "*") {
			escaped := strings.ReplaceAll(pattern, ".", "\\.")
			escaped = strings.ReplaceAll(escaped, "*", ".*")
			re, err := regexp.Compile(escaped)
			if err != nil {
				continue
			}
			regexes = append(regexes, re)
		} else {
			literals = append(literals, pattern)
		}
	}
	var filtered []customOption
	for _, opt := range opts {
		excluded := false
		for _, lit := range literals {
			if opt.key == lit {
				excluded = true
				break
			}
		}
		if !excluded {
			for _, re := range regexes {
				if re.MatchString(opt.key) {
					excluded = true
					break
				}
			}
		}
		if !excluded {
			filtered = append(filtered, opt)
		}
	}
	return filtered
}

// isArrayIndex is whether s is a canonical JS array index, which Object.keys()
// enumerates first, in ascending order.
func isArrayIndex(s string) bool {
	if len(s) == 0 || len(s) > 10 {
		return false
	}
	if s == "0" {
		return true
	}
	if s[0] < '1' || s[0] > '9' {
		return false
	}
	for i := 1; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	v, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return false
	}
	return v < (1<<32 - 1)
}

// isDefaultValue returns true if the value equals the proto3 JSON default for the field type.
// protobuf-ts toJson() omits fields with default values.
func (g *generator) isDefaultValue(fd *descriptorpb.FieldDescriptorProto, value interface{}) bool {
	// Repeated/map fields: present means non-default
	if fd.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		return false
	}
	switch fd.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		v, ok := value.(int)
		return ok && v == 0
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		v, ok := value.(string)
		return ok && v == "0"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		v, ok := value.(float64)
		return ok && v == 0
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		v, ok := value.(bool)
		return ok && !v
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		v, ok := value.(string)
		return ok && v == ""
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		v, ok := value.(string)
		return ok && v == ""
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		if fd.GetTypeName() == ".google.protobuf.NullValue" {
			return value == nil
		}
		// Default enum value has number 0; resolve its name and compare
		defaultName := g.resolveEnumValueName(fd.GetTypeName(), 0)
		v, ok := value.(string)
		return ok && v == defaultName
	}
	return false
}

// getLeadingDetachedComments retrieves leading detached comments for a given path in SourceCodeInfo

// optionsJSON writes options as the JSON object protobuf-ts would hand back, in the
// order they were read.
func optionsJSON(options []customOption) string {
	var b strings.Builder
	writeOptionValue(&b, options)
	return b.String()
}

func writeOptionValue(b *strings.Builder, value interface{}) {
	switch v := value.(type) {
	case nil:
		b.WriteString("null")
	case []customOption:
		b.WriteString("{")
		for i, option := range v {
			if i > 0 {
				b.WriteString(",")
			}
			writeJSONString(b, option.key)
			b.WriteString(":")
			writeOptionValue(b, option.value)
		}
		b.WriteString("}")
	case []interface{}:
		b.WriteString("[")
		for i, element := range v {
			if i > 0 {
				b.WriteString(",")
			}
			writeOptionValue(b, element)
		}
		b.WriteString("]")
	case float64:
		// JSON has no NaN or Infinity, and protobuf-ts writes them as these strings.
		switch {
		case math.IsNaN(v):
			writeJSONString(b, "NaN")
		case math.IsInf(v, 1):
			writeJSONString(b, "Infinity")
		case math.IsInf(v, -1):
			writeJSONString(b, "-Infinity")
		default:
			b.WriteString(strconv.FormatFloat(v, 'g', -1, 64))
		}
	default:
		encoded, err := json.Marshal(v)
		if err != nil {
			b.WriteString("null")
			return
		}
		b.Write(encoded)
	}
}

func writeJSONString(b *strings.Builder, s string) {
	encoded, _ := json.Marshal(s)
	b.Write(encoded)
}

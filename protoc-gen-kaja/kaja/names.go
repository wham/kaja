package kaja

import (
	"strings"

	"google.golang.org/protobuf/types/descriptorpb"
)

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

// The names a generated client already has a member under, so a method called one of
// them takes the "$".
var tsReservedMethodNames = map[string]bool{
	"name": true, "constructor": true, "close": true, "toString": true,
	"makeUnaryRequest": true, "makeClientStreamRequest": true,
	"makeServerStreamRequest": true, "makeBidiStreamRequest": true,
	"getChannel": true, "waitForReady": true,
	"methods": true, "typeName": true, "options": true,
}

func escapeTypescriptKeyword(name string) string {
	if tsReservedKeywords[name] || tsReservedTypeNames[name] {
		return name + "$"
	}
	return name
}

func escapeMethodName(name string) string {
	if tsReservedMethodNames[name] {
		return name + "$"
	}
	return name
}

// toCamelCase is protobuf-ts's property name: every letter after an underscore
// capitalized, and a lowercase letter after a digit too ("int32s" -> "int32S").
func toCamelCase(name string) string {
	parts := strings.Split(name, "_")
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	runes := []rune(strings.Join(parts, ""))
	for i := 1; i < len(runes); i++ {
		if runes[i] >= 'a' && runes[i] <= 'z' && runes[i-1] >= '0' && runes[i-1] <= '9' {
			runes[i] = runes[i] - 'a' + 'A'
		}
	}
	result := string(runes)
	if len(result) > 0 {
		if strings.HasPrefix(name, "_") {
			result = strings.ToUpper(result[:1]) + result[1:]
		} else {
			result = strings.ToLower(result[:1]) + result[1:]
		}
	}
	return result
}

// escapeProperty takes the "$" for the names an object can't hold as its own data, and
// for oneofKind, which is the discriminator of every oneof.
func escapeProperty(name string) string {
	if name == "__proto__" || name == "toString" || name == "oneofKind" {
		return name + "$"
	}
	return name
}

func propertyName(field *descriptorpb.FieldDescriptorProto) string {
	return escapeProperty(toCamelCase(field.GetName()))
}

// enumPrefix is the prefix every value of an enum shares with the enum's own name in
// UPPER_SNAKE_CASE, which the TypeScript names leave off when what is left of each is
// still a name.
func enumPrefix(enum *descriptorpb.EnumDescriptorProto) string {
	if len(enum.Value) == 0 {
		return ""
	}
	var b strings.Builder
	for _, r := range enum.GetName() {
		if r >= 'A' && r <= 'Z' {
			b.WriteRune('_')
		}
		b.WriteRune(r)
	}
	prefix := strings.ToUpper(strings.TrimPrefix(b.String(), "_")) + "_"
	for _, v := range enum.Value {
		stripped, ok := strings.CutPrefix(v.GetName(), prefix)
		if !ok || len(stripped) < 2 || stripped[0] < 'A' || stripped[0] > 'Z' {
			return ""
		}
	}
	return prefix
}

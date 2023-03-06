package model

import (
	"encoding/json"
	"reflect"
	"time"

	"google.golang.org/protobuf/reflect/protoreflect"
)

func FormatTime(Time time.Time) string {
	return Time.Format("2006-01-02") + "T00:00:00Z"
}

type Input string

const (
	CheckboxInput Input = "checkbox"
	SelectInput Input = "select"
	TextInput Input = "text"
	TextareaInput Input = "textarea"
)

type Parse string

const (
	ArrayParse Parse = "array"
	BoolParse Parse = "bool"
	IntParse Parse = "int"
	ObjectParse Parse = "object"
	TextParse Parse = "text"
)

func GetFormTreatment(field protoreflect.FieldDescriptor) (Input, Parse) {
	if field.Cardinality() == protoreflect.Repeated && !field.IsMap() {
		return TextareaInput, ArrayParse
	}

	if field.Kind() == protoreflect.EnumKind {
		return SelectInput, IntParse
	} else if field.Kind() == protoreflect.BoolKind {
		return CheckboxInput, BoolParse
	} else if field.Kind() == protoreflect.MessageKind {
		if field.Message().FullName() == "google.protobuf.Timestamp" {
			return TextInput, TextParse
		} else {
			return TextareaInput, ObjectParse
		}
	}

	return TextInput, TextParse
} 

// GetDefaultValue returns string that is used as a default value in the input field
// The main goal is provide helpful scaffolding for more complex message types.
func GetDefaultValue(field protoreflect.FieldDescriptor) string {
	v := getDefaultValue(field)

	// String value indicates scalar field, return as is
	if reflect.TypeOf(v).String() == "string" {
		return v.(string)
	}

	j, _ := json.MarshalIndent(v, "", "  ")
	return string(j)
}

func getDefaultValue(field protoreflect.FieldDescriptor) any {
	if field.Cardinality() == protoreflect.Repeated && !field.IsMap() {
		return []any{
			getSingleValue(field),
		}
	}

	return getSingleValue(field)
}

func getSingleValue(field protoreflect.FieldDescriptor) any {
	if field.Kind() == protoreflect.EnumKind || isNumericKind(field.Kind()) {
		return 0
	} else if field.Kind() == protoreflect.MessageKind {
		if field.Message().FullName() == "google.protobuf.Timestamp" {
			// This is replaced with a current date on every page load
			return  "google.protobuf.Timestamp"
		} else if field.IsMap() {
			k := field.MapKey()
			v := field.MapValue()

			if isStringKind(k.Kind()) {
				return map[string]any{
					"key": getDefaultValue(v),
				}
			}

			if isNumericKind(k.Kind()) {
				return map[int]any{
					0: getDefaultValue(v),
				}
			}
		} else {
			message := field.Message()
			m := map[string]any{}
	
			for i := 0; i < message.Fields().Len(); i++ {
				f := message.Fields().Get(i)
				m[string(f.Name())] = getDefaultValue(f)
			}
	
			return m
		}
	}

	return ""
}


func isNumericKind(kind protoreflect.Kind) bool {
	return kind == protoreflect.Int32Kind ||
		kind == protoreflect.Sint32Kind ||
		kind == protoreflect.Uint32Kind ||
		kind == protoreflect.Int64Kind ||
		kind == protoreflect.Sint64Kind ||
		kind == protoreflect.Uint64Kind ||
		kind == protoreflect.Sfixed32Kind ||
		kind == protoreflect.Fixed32Kind ||
		kind == protoreflect.FloatKind ||
		kind == protoreflect.Sfixed64Kind ||
		kind == protoreflect.Fixed64Kind ||
		kind == protoreflect.DoubleKind
}

func isStringKind(kind protoreflect.Kind) bool {
	return kind == protoreflect.StringKind
}
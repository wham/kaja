package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestFormatTime(t *testing.T) {
	p, _ := time.Parse(time.RFC3339, "2014-11-12T11:45:26.371Z")

	assert.Equal(t, "2014-11-12T00:00:00Z", FormatTime(p))
}

func TestGetFormTreatment(t *testing.T) {
	message := TestMessage1{}
	fields := message.ProtoReflect().Descriptor().Fields()
	
	input, parse := GetFormTreatment(fields.ByName("string"))
	assert.Equal(t, TextInput, input)
	assert.Equal(t, TextParse, parse)

	input, parse = GetFormTreatment(fields.ByName("int32"))
	assert.Equal(t, TextInput, input)
	assert.Equal(t, TextParse, parse)

	input, parse = GetFormTreatment(fields.ByName("bool"))
	assert.Equal(t, CheckboxInput, input)
	assert.Equal(t, BoolParse, parse)

	input, parse = GetFormTreatment(fields.ByName("repeated_string"))
	assert.Equal(t, TextareaInput, input)
	assert.Equal(t, ArrayParse, parse)

	input, parse = GetFormTreatment(fields.ByName("nested_message"))
	assert.Equal(t, TextareaInput, input)
	assert.Equal(t, ObjectParse, parse)

	input, parse = GetFormTreatment(fields.ByName("timestamp"))
	assert.Equal(t, TextInput, input)
	assert.Equal(t, TextParse, parse)
}

func TestGetDefaultValue(t *testing.T) {
	message := TestMessage1{}
	fields := message.ProtoReflect().Descriptor().Fields()

	assert.Equal(t, "", GetDefaultValue(fields.ByName("string")))
	assert.Equal(t, "0", GetDefaultValue(fields.ByName("int32")))
	assert.Equal(t, "", GetDefaultValue(fields.ByName("bool")))

	expected := `[
  ""
]`
	assert.Equal(t, expected, GetDefaultValue(fields.ByName("repeated_string")))

	expected = `{
  "another_nested_message": {
    "ids": [
      0
    ]
  },
  "name": ""
}`
	assert.Equal(t, expected, GetDefaultValue(fields.ByName("nested_message")))

	assert.Equal(t, "google.protobuf.Timestamp", GetDefaultValue(fields.ByName("timestamp")))
}
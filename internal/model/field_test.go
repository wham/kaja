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

func TestGetDefaultValue(t *testing.T) {
	message := TestMessage1{}
	fields := message.ProtoReflect().Descriptor().Fields()
	var expected string

	assert.Equal(t, "", GetDefaultValue(fields.ByName("string")))
	assert.Equal(t, "0", GetDefaultValue(fields.ByName("int32")))
	assert.Equal(t, "", GetDefaultValue(fields.ByName("bool")))

	expected = `[
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
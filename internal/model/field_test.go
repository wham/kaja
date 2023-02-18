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
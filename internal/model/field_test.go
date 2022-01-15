package model

import (
	"testing"
	"time"
)

func TestFormatTime(t *testing.T) {
	d, _ := time.Parse(time.RFC3339, "2014-11-12T11:45:26.371Z")
	
	e := "2014-11-12T00:00:00Z"
	a := FormatTime(d)

	if a != e {
		t.Fatalf("incorrect result: expected %s, go %s", e, a)
	}
}
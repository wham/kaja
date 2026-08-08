package grpc

import (
	"net/url"
	"testing"
)

func TestTLSOptionsUseTLS(t *testing.T) {
	tests := []struct {
		name     string
		mode     string
		target   string
		expected bool
	}{
		{"no mode reads the URL", "", "dns:example.com:443", true},
		{"no mode reads the URL", "", "dns:example.com:9000", false},
		{"on overrides a plaintext-looking URL", TLSOn, "dns:example.com:50051", true},
		{"off overrides port 443", TLSOff, "dns:example.com:443", false},
		{"off overrides the grpcs scheme", TLSOff, "grpcs://example.com:8443", false},
	}

	for _, test := range tests {
		t.Run(test.name+" "+test.target, func(t *testing.T) {
			parsed, err := url.Parse(test.target)
			if err != nil {
				t.Fatal(err)
			}
			if got := (TLSOptions{Mode: test.mode}).UseTLS(parsed); got != test.expected {
				t.Errorf("UseTLS(%q) with mode %q = %v, want %v", test.target, test.mode, got, test.expected)
			}
		})
	}
}

func TestTLSOptionsKey(t *testing.T) {
	// Two apps pointing at one host with different certificates must not share a
	// connection.
	plain := TLSOptions{}
	skipping := TLSOptions{SkipVerify: true}
	if plain.key() == skipping.key() {
		t.Error("options that connect differently produced the same cache key")
	}
	// The mode is not part of the key: it is already answered by the useTLS flag
	// the key is built alongside.
	if plain.key() != plain.WithMode(TLSOn).key() {
		t.Error("the mode changed the cache key")
	}
}

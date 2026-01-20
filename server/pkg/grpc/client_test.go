package grpc

import (
	"net/url"
	"testing"
)

func TestShouldUseTLS(t *testing.T) {
	tests := []struct {
		name     string
		target   string
		expected bool
	}{
		// TLS should be used
		{"https scheme", "https://example.com:8080", true},
		{"grpcs scheme", "grpcs://example.com:8080", true},
		{"port 443 explicit", "http://example.com:443", true},
		{"port 443 grpc", "grpc://example.com:443", true},
		{"dns with port 443", "dns:example.com:443", true},

		// TLS should not be used
		{"http scheme", "http://example.com:8080", false},
		{"grpc scheme non-443", "grpc://example.com:9000", false},
		{"dns with port 9000", "dns:example.com:9000", false},
		{"dns with port 50051", "dns:grpcb.in:50051", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed, err := url.Parse(tt.target)
			if err != nil {
				t.Fatalf("Failed to parse URL: %v", err)
			}
			result := ShouldUseTLS(parsed)
			if result != tt.expected {
				t.Errorf("ShouldUseTLS(%q) = %v, want %v", tt.target, result, tt.expected)
			}
		})
	}
}

func TestToGRPCTarget(t *testing.T) {
	tests := []struct {
		name     string
		target   string
		expected string
	}{
		// dns: scheme passthrough
		{"dns scheme", "dns:example.com:443", "dns:example.com:443"},
		{"dns scheme with port", "dns:grpcb.in:9000", "dns:grpcb.in:9000"},

		// grpc:// and grpcs:// conversion
		{"grpc scheme", "grpc://example.com:9000", "dns:example.com:9000"},
		{"grpcs scheme", "grpcs://example.com:443", "dns:example.com:443"},
		{"grpc with different port", "grpc://grpcb.in:9000", "dns:grpcb.in:9000"},

		// http:// and https:// conversion
		{"http scheme", "http://example.com:8080", "dns:example.com:8080"},
		{"https scheme", "https://example.com:443", "dns:example.com:443"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed, err := url.Parse(tt.target)
			if err != nil {
				t.Fatalf("Failed to parse URL: %v", err)
			}
			result := ToGRPCTarget(parsed)
			if result != tt.expected {
				t.Errorf("ToGRPCTarget(%q) = %q, want %q", tt.target, result, tt.expected)
			}
		})
	}
}

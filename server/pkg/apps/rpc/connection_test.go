package rpc

import (
	"testing"

	"github.com/wham/kaja/v2/pkg/grpc"
)

func TestMetadata(t *testing.T) {
	tests := []struct {
		name       string
		parameters map[string]string
		expected   map[string]string
	}{
		{"nothing configured", map[string]string{}, nil},
		{"none", map[string]string{"auth": AuthNone, "token": "ignored"}, nil},
		{"bearer", map[string]string{"auth": AuthBearer, "token": "abc"}, map[string]string{"authorization": "Bearer abc"}},
		{"bearer without a token", map[string]string{"auth": AuthBearer}, nil},
		{"basic", map[string]string{"auth": AuthBasic, "username": "ada", "password": "lovelace"}, map[string]string{"authorization": "Basic YWRhOmxvdmVsYWNl"}},
		{"basic with only a password", map[string]string{"auth": AuthBasic, "password": "x"}, map[string]string{"authorization": "Basic Ong="}},
		{"api key under its default name", map[string]string{"auth": AuthAPIKey, "token": "k"}, map[string]string{"x-api-key": "k"}},
		{"api key under a named key", map[string]string{"auth": AuthAPIKey, "token": "k", "api_key_name": "X-Tenant-Key"}, map[string]string{"x-tenant-key": "k"}},
		{"an unknown scheme sends nothing", map[string]string{"auth": "mtls", "token": "k"}, nil},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			metadata := Metadata(test.parameters)
			if len(metadata) != len(test.expected) {
				t.Fatalf("Metadata(%v) = %v, want %v", test.parameters, metadata, test.expected)
			}
			for name, value := range test.expected {
				if metadata[name] != value {
					t.Errorf("Metadata(%v)[%q] = %q, want %q", test.parameters, name, metadata[name], value)
				}
			}
		})
	}
}

func TestTLS(t *testing.T) {
	options := TLS(map[string]string{"tls": "on", "insecure_skip_verify": "true"})
	if options.Mode != grpc.TLSOn {
		t.Errorf("Mode = %q, want %q", options.Mode, grpc.TLSOn)
	}
	if !options.SkipVerify {
		t.Error("SkipVerify = false, want true")
	}

	options = TLS(map[string]string{})
	if options.Mode != "" || options.SkipVerify {
		t.Errorf("an app that says nothing = %+v, want the zero options", options)
	}

	options = TLS(map[string]string{"ca_file": "/etc/certs/ca.pem"})
	if options.CAFile != "/etc/certs/ca.pem" {
		t.Errorf("CAFile = %q, want the absolute path left alone", options.CAFile)
	}
}

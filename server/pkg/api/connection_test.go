package api

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wham/kaja/v2/pkg/grpc"
)

func writeConfiguration(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "kaja.json")
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAppConnection(t *testing.T) {
	// The password names a variable rather than carrying one, which is the whole
	// reason the credential is applied here: this is where the value is.
	path := writeConfiguration(t, `{
		"variables": { "DEMO_PASSWORD": "lovelace" },
		"apps": [
			{
				"name": "seating",
				"grpc": {
					"url": "dns:seating.example.com:443",
					"reflection": true,
					"tls": "on",
					"insecure_skip_verify": true,
					"auth": "basic",
					"username": "ada",
					"password": "${DEMO_PASSWORD}"
				}
			},
			{ "name": "quirks", "twirp": { "url": "https://quirks.example.com", "proto_dir": "quirks/proto" } }
		]
	}`)

	service := NewApiService(path, false, "", "", nil)

	connection := service.AppConnection("seating")
	if got := connection.Metadata["authorization"]; got != "Basic YWRhOmxvdmVsYWNl" {
		t.Errorf("authorization = %q, want the variable resolved and base64 encoded", got)
	}
	if connection.TLS.Mode != grpc.TLSOn || !connection.TLS.SkipVerify {
		t.Errorf("TLS = %+v, want the app's transport", connection.TLS)
	}

	// A twirp app has no credential of its own to apply, and neither has an app
	// that isn't there.
	if connection := service.AppConnection("quirks"); len(connection.Metadata) != 0 || connection.TLS.Mode != "" {
		t.Errorf("AppConnection(\"quirks\") = %+v, want nothing", connection)
	}
	if connection := service.AppConnection("nope"); len(connection.Metadata) != 0 {
		t.Errorf("AppConnection(\"nope\") = %+v, want nothing", connection)
	}
	if connection := service.AppConnection(""); len(connection.Metadata) != 0 {
		t.Errorf("AppConnection(\"\") = %+v, want nothing", connection)
	}
}

package rpc

import (
	"encoding/base64"
	"strings"

	"github.com/wham/kaja/v2/internal/workspace"
	"github.com/wham/kaja/v2/pkg/grpc"
)

// The credentials a gRPC app can hold. There is one per app, because one is what
// a service asks for; anything else an API wants alongside it is a header.
const (
	AuthNone   = "none"
	AuthBearer = "bearer"
	AuthBasic  = "basic"
	AuthAPIKey = "apikey"
)

// DefaultAPIKeyName is the metadata key an "apikey" credential travels under
// when the app doesn't name one.
const DefaultAPIKeyName = "x-api-key"

// Metadata is the credential an app sends with every call, in the shape its
// scheme asks for. The parameters are already expanded, so a "${secret}" token
// is the value itself here - which is the point: this runs where kaja holds the
// value, so the browser is never handed it and Basic's base64 is never something
// to work out by hand.
func Metadata(parameters map[string]string) map[string]string {
	token := strings.TrimSpace(parameters["token"])
	username := strings.TrimSpace(parameters["username"])
	password := parameters["password"]

	switch strings.TrimSpace(parameters["auth"]) {
	case AuthBearer:
		if token == "" {
			return nil
		}
		return map[string]string{"authorization": "Bearer " + token}
	case AuthBasic:
		if username == "" && password == "" {
			return nil
		}
		return map[string]string{"authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+password))}
	case AuthAPIKey:
		if token == "" {
			return nil
		}
		name := strings.TrimSpace(parameters["api_key_name"])
		if name == "" {
			name = DefaultAPIKeyName
		}
		return map[string]string{strings.ToLower(name): token}
	}
	return nil
}

// TLS reads the transport options off an app's parameters. Certificate paths are
// workspace-relative, like proto_dir.
func TLS(parameters map[string]string) grpc.TLSOptions {
	return grpc.TLSOptions{
		Mode:       strings.TrimSpace(parameters["tls"]),
		SkipVerify: strings.TrimSpace(parameters["insecure_skip_verify"]) == "true",
		CAFile:     workspace.Resolve(strings.TrimSpace(parameters["ca_file"])),
		CertFile:   workspace.Resolve(strings.TrimSpace(parameters["client_cert_file"])),
		KeyFile:    workspace.Resolve(strings.TrimSpace(parameters["client_key_file"])),
	}
}

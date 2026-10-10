package api

import (
	"path/filepath"
	"testing"
)

func TestResolveWorkspacePathsAreRelativeToTheConfigurationFile(t *testing.T) {
	dir := workspaceDir(filepath.Join("some", "repo", "kaja.json"))
	if !filepath.IsAbs(dir) {
		t.Fatalf("workspace dir %q is not absolute", dir)
	}

	parameters := map[string]string{
		"url":              "localhost:50051",
		"proto_dir":        "protos",
		"ca_file":          " certs/ca.pem ",
		"client_cert_file": "/etc/ssl/client.pem",
		"client_key_file":  "",
	}
	resolveWorkspacePaths(parameters, dir)

	if got, want := parameters["proto_dir"], filepath.Join(dir, "protos"); got != want {
		t.Errorf("proto_dir = %q, want %q", got, want)
	}
	if got, want := parameters["ca_file"], filepath.Join(dir, "certs", "ca.pem"); got != want {
		t.Errorf("ca_file = %q, want %q", got, want)
	}
	if got := parameters["client_cert_file"]; got != "/etc/ssl/client.pem" {
		t.Errorf("an absolute path was rewritten: %q", got)
	}
	if got := parameters["client_key_file"]; got != "" {
		t.Errorf("an empty path was filled in: %q", got)
	}
	if got := parameters["url"]; got != "localhost:50051" {
		t.Errorf("a parameter that is not a path was touched: %q", got)
	}
}

package grpcapptest

import (
	"strings"
	"testing"

	"github.com/wham/kaja/v2/pkg/api"
)

// TestReflectionMatchesProtoDir is the differential read: one surface, opened both
// ways. A server's descriptors are written back out as .proto and compiled, and the
// same files are compiled directly - so whatever the writer loses on the way through
// shows up as a difference in the TypeScript a script is written against.
func TestReflectionMatchesProtoDir(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"fidelity"}, Reflection: true, SourceInfo: true})

	_, reflected, _ := openAndCompile(t, &api.ConfigurationApp{
		Name: "reflected",
		App:  &api.ConfigurationApp_Grpc{Grpc: &api.GrpcApp{Url: up.URL, Reflection: true}},
	})
	_, direct, _ := openAndCompile(t, &api.ConfigurationApp{
		Name: "direct",
		App:  &api.ConfigurationApp_Grpc{Grpc: &api.GrpcApp{Url: up.URL, ProtoDir: absolute(t, "testdata/fidelity")}},
	})

	reflectedText := sourceOf(t, reflected, "fidelity.ts")
	directText := sourceOf(t, direct, "fidelity.ts")

	if reflectedText == directText {
		return
	}
	t.Errorf("reflection and the protos it came from generate different TypeScript")
	for _, line := range diffLines(directText, reflectedText) {
		t.Log(line)
	}
}

// TestReflectionKeepsWhatAMethodDeclares is what a script's author reads off the
// generated interface of a server that registers its descriptors the ordinary way,
// with the comments stripped. Everything the descriptors still carry has to arrive;
// the documentation is the one thing the server never sent.
func TestReflectionKeepsWhatAMethodDeclares(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"fidelity"}, Reflection: true})

	_, sources, _ := openAndCompile(t, &api.ConfigurationApp{
		Name: "reflected",
		App:  &api.ConfigurationApp_Grpc{Grpc: &api.GrpcApp{Url: up.URL, Reflection: true}},
	})
	generated := sourceText(sources)

	for _, one := range []struct {
		what string
		want string
	}{
		{"the deprecated method's mark", "@deprecated"},
		{"the optional field's presence", "note?: string"},
		{"the enum", "STATUS_VOID"},
		{"the map field", "labels"},
		{"the oneof", "voucher"},
		{"the server stream", "ListTickets"},
	} {
		if !strings.Contains(generated, one.want) {
			t.Errorf("%s is missing from what reflection generated (%q)", one.what, one.want)
		}
	}
}

func sourceOf(t *testing.T, sources []*api.Source, suffix string) string {
	t.Helper()
	for _, source := range sources {
		if strings.HasSuffix(source.GetPath(), suffix) {
			return source.GetContent()
		}
	}
	t.Fatalf("no generated source ending in %q, only %v", suffix, sourceNames(sources))
	return ""
}

// diffLines is the lines that differ, each said once, so a failure reads as what was
// lost rather than as two files.
func diffLines(want, got string) []string {
	present := map[string]bool{}
	for _, line := range strings.Split(got, "\n") {
		present[strings.TrimSpace(line)] = true
	}
	missing := []string{}
	for _, line := range strings.Split(want, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" && !present[trimmed] {
			missing = append(missing, "  - "+trimmed)
		}
	}
	if len(missing) > 40 {
		missing = append(missing[:40], "  … and more")
	}
	return missing
}

// TestReflectionOfProto2 is a server whose protos are proto2, which is what a service
// older than proto3 still declares. Every field there carries a label and a default,
// and a file that loses them is not the same API.
func TestReflectionOfProto2(t *testing.T) {
	up := startUpstream(t, upstreamOptions{Dirs: []string{"legacy"}, Reflection: true})

	_, reflected, _ := openAndCompile(t, &api.ConfigurationApp{
		Name: "reflected",
		App:  &api.ConfigurationApp_Grpc{Grpc: &api.GrpcApp{Url: up.URL, Reflection: true}},
	})
	_, direct, _ := openAndCompile(t, &api.ConfigurationApp{
		Name: "direct",
		App:  &api.ConfigurationApp_Grpc{Grpc: &api.GrpcApp{Url: up.URL, ProtoDir: absolute(t, "testdata/legacy")}},
	})

	if got, want := sourceOf(t, reflected, "legacy.ts"), sourceOf(t, direct, "legacy.ts"); got != want {
		t.Errorf("reflection and the protos it came from generate different TypeScript")
		for _, line := range diffLines(want, got) {
			t.Log(line)
		}
	}
}

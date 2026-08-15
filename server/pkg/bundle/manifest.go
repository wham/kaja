// Package bundle is a script as something that runs on its own.
//
// A run needs seven things: the script, the client stubs its imports resolve
// to, the configuration of the apps it calls, the names of the variables those
// apps read, a transport that can reach upstream, a canvas to draw on, and a
// host to start it. Kaja computes the first four every time it starts. A bundle
// is those four written down — frozen at export, so what runs them needs no
// compiler, no protoc, no esbuild and no network to boot.
//
// The format is a zip. It is read from a file, or from the end of the running
// executable: a runner with a bundle appended to it is one file that is both.
package bundle

// FormatVersion is the bundle format this build writes and reads. A runner
// refuses a bundle from a later format rather than guessing at it — the
// alternative is a canvas that draws half of what the script said.
const FormatVersion = 1

// Names of the entries every bundle carries. They are constants because the
// exporter writes them and the runner reads them, and a bundle that disagrees
// with itself about a filename is the one failure nothing would explain.
const (
	ManifestName = "manifest.json"
	ScriptName   = "script.js"
	StubName     = "stub.js"
	// AppsDir holds each app's frozen proto surface, under its own name.
	AppsDir = "apps"
)

// Manifest is everything the runner and the player need that isn't code.
type Manifest struct {
	FormatVersion int `json:"formatVersion"`
	// KajaVersion is the build that exported this, for the error message a
	// mismatch produces.
	KajaVersion string `json:"kajaVersion,omitempty"`
	// Name is the script's file name without its extension, which is what the
	// window is titled and what the bundle is named after.
	Name string `json:"name"`
	// Title is the name as a person reads it, derived from the script's own code
	// the way the sidebar derives it.
	Title string `json:"title,omitempty"`
	// Source is the script as it was written. It is not what runs — Script is —
	// but an exported app that can't show its own source is a black box, and the
	// text costs a few kilobytes.
	Source string `json:"source,omitempty"`
	// Apps are the apps the script imports, in the order it imports them.
	Apps []App `json:"apps"`
	// Imports are the script's import statements, resolved: which stub module
	// each name comes from. The player binds them and never parses anything.
	Imports []Import `json:"imports"`
	// Variables are the names the apps and the script read, never the values.
	// An exported app resolves them where it runs.
	Variables []Variable `json:"variables,omitempty"`
	// RunOnLoad starts the script as soon as the page opens. A script that only
	// reads is worth running on sight; one that writes should be pressed, so a
	// script holding a kaja.approve is exported with this off.
	RunOnLoad bool `json:"runOnLoad"`
}

// App is one app the script calls, as the runner opens it.
type App struct {
	Name string `json:"name"`
	// Type is the set oneof field on the configuration — "grpc", "openapi", …
	Type string `json:"type"`
	// Configuration is the app's ConfigurationApp as protojson, rewritten to read
	// what the bundle froze: an OpenAPI app's spec travels inline, a reflected
	// gRPC app's discovered protos become a proto_dir. What could not be frozen
	// is left pointing at the network, and Frozen says so.
	Configuration map[string]any `json:"configuration"`
	// ProtoDir is where in the bundle this app's proto surface lives, relative to
	// the bundle root. Empty for an app that re-reads its surface at startup.
	ProtoDir string `json:"protoDir,omitempty"`
	// Frozen reports whether opening this app at runtime needs the network. It is
	// stated rather than inferred so the export can say so at export time, which
	// is when it can still be acted on.
	Frozen bool `json:"frozen"`
}

// Import is one name a script imported, resolved to where it lives in the stub.
// Kind is decided by the player from what the stub actually exports, since a
// service and an enum are told apart by what they are rather than by what a
// manifest claims.
type Import struct {
	// Alias is the name the script's body uses.
	Alias string `json:"alias"`
	// Name is the export's own name in the stub module.
	Name string `json:"name"`
	// App is the app it belongs to, which is what a call's credential and
	// transport are looked up by.
	App string `json:"app"`
	// Module is the stub module id holding it, e.g. "Theatre$service".
	Module string `json:"module"`
	// ClientModule is the generated .client module beside it, which is where a
	// service's client class lives. Empty for an enum.
	ClientModule string `json:"clientModule,omitempty"`
}

// VariableSource says where a variable's value comes from, in the vocabulary
// kaja.json already uses. The value itself is never in a bundle.
type VariableSource string

const (
	// SourceFile is a value written in kaja.json, which travels with the bundle.
	SourceFile VariableSource = "file"
	// SourceSecret is "${secret}" — the keychain, else KAJA_<NAME>. An exported
	// app has no keychain, so it reads the environment.
	SourceSecret VariableSource = "secret"
	// SourceEnvironment is "${env:X}".
	SourceEnvironment VariableSource = "environment"
)

// Variable is a name the exported app needs, and where it will look for it.
type Variable struct {
	Name   string         `json:"name"`
	Source VariableSource `json:"source"`
	// Value is carried only for a file-backed variable, which is a value kaja.json
	// already writes in the clear.
	Value string `json:"value,omitempty"`
	// Env is the environment variable consulted, for the sentence a missing one
	// produces: "set KAJA_TOKEN".
	Env string `json:"env,omitempty"`
	// Used reports whether an app's configuration references it. A variable a
	// script reads through kaja.variables is needed too, and is not.
	Used bool `json:"used,omitempty"`
}

// EnvName is the environment variable a "${secret}" variable is read from when
// there is no keychain to hold it — which, in an exported app, is always.
func EnvName(name string) string {
	return "KAJA_" + name
}

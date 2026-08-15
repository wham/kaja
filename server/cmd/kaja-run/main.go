// Command kaja-run runs an exported script.
//
// It is the same bytes for every export, which is what makes exporting one a
// copy rather than a build: the script, its stubs and its apps are appended to
// this program as a zip, and everything platform-specific about producing an
// exported app is choosing which prebuilt copy of this to append to.
//
// What it does is what kaja does on every start, minus everything it can skip
// because the bundle already holds the answer: it puts the frozen proto surface
// back on disk, opens the apps, and serves one page that runs one script.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	assets "github.com/wham/kaja/v2"
	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/bundle"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:0", "address to listen on")
	open := flag.Bool("open", true, "open the app in a browser")
	flag.Parse()

	app, err := load(flag.Arg(0))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer app.bundle.Close()

	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot listen on %s: %v\n", *listen, err)
		os.Exit(1)
	}
	url := "http://" + listener.Addr().String()

	// Everything the script reads is resolved in this process and the values only
	// leave it as headers on the way out — unless nothing but this machine can
	// reach the page, which is the one case where the browser is the same trust
	// boundary as the process. It is the rule the web server already follows,
	// stated the other way round.
	app.local = isLoopback(listener.Addr())

	fmt.Printf("%s is running at %s\n", app.state.Manifest.Name, url)
	for _, warning := range app.warnings() {
		fmt.Println("  " + warning)
	}
	if *open {
		openBrowser(url)
	}

	if err := http.Serve(listener, app.handler()); err != nil {
		slog.Error("Failed to serve", "error", err)
		os.Exit(1)
	}
}

type runner struct {
	bundle *bundle.Bundle
	state  *state
	api    *api.ApiService
	local  bool
}

// state is what the player is handed: the manifest, plus what could only be
// known once the apps were opened here.
type state struct {
	Manifest         *bundle.Manifest  `json:"manifest"`
	Apps             []runnerApp       `json:"apps"`
	MissingVariables []string          `json:"missingVariables"`
	Variables        map[string]string `json:"variables"`
}

type runnerApp struct {
	Name     string `json:"name"`
	Target   string `json:"target"`
	Protocol string `json:"protocol"`
	Error    string `json:"error,omitempty"`
}

// load reads the bundle and puts back what it froze: a workspace on disk, with
// the apps' proto surface where their configuration says it is.
func load(path string) (*runner, error) {
	opened, err := openBundle(path)
	if err != nil {
		return nil, err
	}

	workspace, err := os.MkdirTemp("", "kaja-app-")
	if err != nil {
		return nil, err
	}
	if err := opened.Extract(bundle.AppsDir, filepath.Join(workspace, bundle.AppsDir)); err != nil {
		return nil, fmt.Errorf("unpacking the apps: %w", err)
	}

	configurationPath := filepath.Join(workspace, "kaja.json")
	if err := writeConfiguration(opened.Manifest, workspace, configurationPath); err != nil {
		return nil, err
	}

	// No variable store: an exported app has no keychain to read, so a "${secret}"
	// variable is read from KAJA_<NAME> in the environment. That is the same
	// fallback the web server has always used.
	service := api.NewApiService(configurationPath, false, opened.Manifest.KajaVersion, "", nil)

	app := &runner{bundle: opened, api: service, state: &state{Manifest: opened.Manifest}}
	app.openApps()
	app.readVariables()
	return app, nil
}

func openBundle(path string) (*bundle.Bundle, error) {
	if path != "" {
		return bundle.Open(path)
	}
	// Appended to this program, which is what an exported app is.
	appended, err := bundle.OpenSelf()
	if err != nil {
		return nil, err
	}
	if appended == nil {
		return nil, fmt.Errorf("usage: %s <app.kaja>", filepath.Base(os.Args[0]))
	}
	return appended, nil
}

// writeConfiguration turns the manifest's apps back into the kaja.json they came
// from, which is what lets everything downstream of it be unchanged: the same
// loader, the same variable resolution, the same credential and transport
// handling on the way out.
func writeConfiguration(manifest *bundle.Manifest, workspace string, path string) error {
	apps := make([]map[string]any, 0, len(manifest.Apps))
	for _, app := range manifest.Apps {
		configuration := app.Configuration
		// A bundle says where a proto directory is inside itself; this says where
		// that turned out to be. Absolute, because a workspace-relative path is
		// resolved against a workspace, and an exported app has no workspace — it
		// has a directory it just unpacked itself into.
		if app.ProtoDir != "" {
			if variant, ok := configuration[app.Type].(map[string]any); ok {
				if _, has := variant["protoDir"]; has {
					variant["protoDir"] = filepath.Join(workspace, filepath.FromSlash(app.ProtoDir))
				}
			}
		}
		apps = append(apps, configuration)
	}

	variables := map[string]string{}
	for _, variable := range manifest.Variables {
		switch variable.Source {
		case bundle.SourceSecret:
			variables[variable.Name] = "${secret}"
		case bundle.SourceEnvironment:
			variables[variable.Name] = "${env:" + variable.Env + "}"
		default:
			variables[variable.Name] = variable.Value
		}
	}

	configuration := map[string]any{"apps": apps}
	if len(variables) > 0 {
		configuration["variables"] = variables
	}

	content, err := json.MarshalIndent(configuration, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, content, 0o600)
}

// openApps opens every app once, at startup. An app that doesn't open is not
// fatal: the others still work, and the page says which one didn't and why —
// which is more useful than a program that refuses to start.
func (r *runner) openApps() {
	configuration := api.LoadGetConfigurationResponse(r.api.ConfigurationPath()).Configuration
	for _, app := range configuration.GetApps() {
		opened, err := r.api.OpenApp(context.Background(), &api.OpenAppRequest{App: app})
		entry := runnerApp{Name: app.Name}
		switch {
		case err != nil:
			entry.Error = err.Error()
		case opened.Status != api.OpenStatus_OPEN_STATUS_OK:
			entry.Error = lastError(opened.Logs)
		default:
			entry.Target = opened.Target
			entry.Protocol = opened.Protocol
		}
		r.state.Apps = append(r.state.Apps, entry)
	}
}

func lastError(logs []*api.Log) string {
	for i := len(logs) - 1; i >= 0; i-- {
		if logs[i].Level == api.LogLevel_LEVEL_ERROR {
			return logs[i].Message
		}
	}
	return "the app could not be opened"
}

// readVariables reports the ones with nowhere to read a value from. It is asked
// once, at startup, because that is when it can still be acted on — the
// alternative is every call failing with a 401 that explains nothing.
func (r *runner) readVariables() {
	for _, status := range r.api.Variables().Statuses() {
		if status.Source == api.VariableSource_VARIABLE_SOURCE_UNSET {
			r.state.MissingVariables = append(r.state.MissingVariables, status.Name)
		}
	}
}

func (r *runner) warnings() []string {
	var warnings []string
	for _, name := range r.state.MissingVariables {
		env := bundle.EnvName(name)
		for _, variable := range r.state.Manifest.Variables {
			if variable.Name == name && variable.Env != "" {
				env = variable.Env
			}
		}
		warnings = append(warnings, fmt.Sprintf("%s has no value here — set %s and start this again.", name, env))
	}
	for _, app := range r.state.Apps {
		if app.Error != "" {
			warnings = append(warnings, fmt.Sprintf("%s didn't open: %s", app.Name, app.Error))
		}
	}
	return warnings
}

func (r *runner) handler() http.Handler {
	mux := http.NewServeMux()

	player, err := assets.ReadPlayerBundle()
	if err != nil {
		slog.Error("Failed to read the player", "error", err)
		os.Exit(1)
	}

	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, req *http.Request) {
		http.ServeFileFS(w, req, assets.StaticFS, "static/player.html")
	})
	mux.HandleFunc("GET /player.js", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		w.Write(player.Js)
	})
	mux.HandleFunc("GET /player.css", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "text/css")
		w.Write(player.Css)
	})
	mux.HandleFunc("GET /static/{name...}", func(w http.ResponseWriter, req *http.Request) {
		http.ServeFileFS(w, req, assets.StaticFS, "static/"+req.PathValue("name"))
	})

	mux.HandleFunc("GET /bundle/state.json", func(w http.ResponseWriter, req *http.Request) {
		published := *r.state
		if r.local {
			published.Variables = r.api.Variables().Values()
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(&published)
	})
	mux.HandleFunc("GET /bundle/{name}", func(w http.ResponseWriter, req *http.Request) {
		name := req.PathValue("name")
		if name != bundle.ScriptName && name != bundle.StubName {
			http.NotFound(w, req)
			return
		}
		content, err := r.bundle.ReadFile(name)
		if err != nil {
			http.NotFound(w, req)
			return
		}
		w.Header().Set("Content-Type", "application/javascript")
		w.Write(content)
	})

	mux.HandleFunc("/target/{method...}", api.TargetHandler(r.api, func(req *http.Request) string {
		return req.PathValue("method")
	}))

	return mux
}

func isLoopback(addr net.Addr) bool {
	host, _, err := net.SplitHostPort(addr.String())
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func openBrowser(url string) {
	var command string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		command = "open"
	case "windows":
		command = "cmd"
		args = []string{"/c", "start"}
	default:
		command = "xdg-open"
	}
	if _, err := exec.LookPath(strings.Fields(command)[0]); err != nil {
		return
	}
	_ = exec.Command(command, append(args, url)...).Start()
}

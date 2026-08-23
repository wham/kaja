// Command kaja-run runs an exported script — on a laptop, and in a container.
//
// It is the same bytes for every export, which is what makes exporting one a
// copy rather than a build: the bundle is read from a path, or from the end of
// this program when one was appended to it.
//
// What it does is what kaja does on every start, minus everything it can skip
// because the bundle already holds the answer: it puts the frozen proto surface
// back on disk, opens the apps, and serves one page that runs one script.
//
// A deployed one is the same program with the address changed, so the two ways
// it can be reached are one decision and it is made where it is bound: on the
// loopback address the browser and this process are the same trust boundary,
// and anywhere else they are not.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	assets "github.com/wham/kaja/v2"
	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/bundle"
)

func main() {
	listen := flag.String("listen", "", "address to listen on (default $PORT on every interface, else a loopback port)")
	open := flag.Bool("open", true, "open the app in a browser, when it is one this machine can reach")
	flag.Parse()

	app, err := load(flag.Arg(0))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer app.bundle.Close()

	address := listenAddress(*listen)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot listen on %s: %v\n", address, err)
		os.Exit(1)
	}

	// Everything the script reads is resolved in this process and the values only
	// leave it as headers on the way out — unless nothing but this machine can
	// reach the page, which is the one case where the browser is the same trust
	// boundary as the process.
	app.local = isLoopback(listener.Addr())
	app.token = strings.TrimSpace(os.Getenv(TokenEnv))

	if err := app.checkReachable(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	url := "http://" + listener.Addr().String()
	fmt.Printf("%s is running at %s\n", app.state.Manifest.Name, url)
	for _, warning := range app.warnings() {
		fmt.Println("  " + warning)
	}
	if *open && app.local {
		openBrowser(url)
	}

	serve(listener, app.handler())
}

// serve runs until the process is asked to stop. A container stops by being
// signalled, so a runner that ignored one would be killed rather than closed,
// and the run in flight would end as a connection that went quiet.
func serve(listener net.Listener, handler http.Handler) {
	server := &http.Server{Handler: handler}

	stopping := make(chan os.Signal, 1)
	signal.Notify(stopping, os.Interrupt, syscall.SIGTERM)
	done := make(chan struct{})
	go func() {
		<-stopping
		context, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(context)
		close(done)
	}()

	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		slog.Error("Failed to serve", "error", err)
		os.Exit(1)
	}
	<-done
}

// listenAddress is where to bind. A container is told by its platform which
// port to answer on and nothing else, so $PORT means "be reachable"; with
// neither a flag nor a variable this is somebody's own machine, and a port
// nobody else can reach is the right default there.
func listenAddress(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	if port := strings.TrimSpace(os.Getenv("PORT")); port != "" {
		return ":" + port
	}
	return "127.0.0.1:0"
}

// The two environment variables a deployed app is configured by. They are read
// rather than baked, because whether a copy of an app should be reachable is a
// fact about where it was put, not about the script it was made from.
const (
	// TokenEnv holds the secret a request must carry. Setting it is what makes a
	// deployed app somebody's rather than everybody's.
	TokenEnv = "KAJA_APP_TOKEN"
	// PublicEnv is the way to say the app is meant to be open, which is a real
	// thing to mean — a script that reads a public API and draws a table is a web
	// page. It has to be said, because the alternative is meaning it by accident.
	PublicEnv = "KAJA_APP_PUBLIC"
)

type runner struct {
	bundle *bundle.Bundle
	state  *state
	api    *api.ApiService
	// local is whether nothing but this machine can reach the page.
	local bool
	// token is what a request must carry when it can be reached from elsewhere.
	token string
}

// checkReachable refuses to start an app that can be reached from outside this
// machine and has not been told who may reach it.
//
// A run makes calls with credentials this process holds, so an address anybody
// can reach is an address anybody can spend them from. That is a deployment
// decision rather than a defect, and both ways of making it are one line in the
// environment — so the one thing not to allow is making it silently.
func (r *runner) checkReachable() error {
	if r.local || r.token != "" || os.Getenv(PublicEnv) == "1" {
		return nil
	}
	return fmt.Errorf(`%s can be reached from outside this machine, so it needs to know who may run it.

A run makes calls with the credentials this process holds, and %s is bound to an address that is not the loopback one.

  Set %s to a secret, and reach it as ?token=<secret> — or
  set %s=1 if this app is meant to be open to anyone who finds it.`,
		r.state.Manifest.Name, r.state.Manifest.Name, TokenEnv, PublicEnv)
}

// guard is the token check, in front of everything but the health endpoint. The
// token may arrive as a bearer header, which is what a script calling this uses,
// or in the query, which is what a person pasting a link has — and that one is
// put in a cookie and taken back out of the URL, so it is not left in a history
// or a screenshot.
func (r *runner) guard(next http.Handler) http.Handler {
	if r.token == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/status" {
			next.ServeHTTP(w, req)
			return
		}
		if given := req.URL.Query().Get("token"); given != "" {
			if !matches(given, r.token) {
				http.Error(w, "Not this app's token.", http.StatusUnauthorized)
				return
			}
			http.SetCookie(w, &http.Cookie{
				Name:     tokenCookie,
				Value:    given,
				Path:     "/",
				HttpOnly: true,
				SameSite: http.SameSiteLaxMode,
				Secure:   req.TLS != nil || req.Header.Get("X-Forwarded-Proto") == "https",
			})
			// Back to the same page without the secret in it.
			away := *req.URL
			query := away.Query()
			query.Del("token")
			away.RawQuery = query.Encode()
			http.Redirect(w, req, away.RequestURI(), http.StatusSeeOther)
			return
		}
		if r.authorized(req) {
			next.ServeHTTP(w, req)
			return
		}
		http.Error(w, "This app needs its token: open it as ?token=<secret>.", http.StatusUnauthorized)
	})
}

func (r *runner) authorized(req *http.Request) bool {
	if bearer := strings.TrimPrefix(req.Header.Get("Authorization"), "Bearer "); matches(bearer, r.token) {
		return true
	}
	cookie, err := req.Cookie(tokenCookie)
	return err == nil && matches(cookie.Value, r.token)
}

const tokenCookie = "kaja_app_token"

// matches compares in constant time, so the answer says whether the token was
// right and not how much of it was.
func matches(given string, want string) bool {
	return want != "" && subtle.ConstantTimeCompare([]byte(given), []byte(want)) == 1
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

	// Unauthenticated, because it is the one request that must be answerable by
	// something that has no business running the app: the platform asking whether
	// this container came up.
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, req *http.Request) {
		w.Write([]byte("OK"))
	})

	return r.guard(mux)
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

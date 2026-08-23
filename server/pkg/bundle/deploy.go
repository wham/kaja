package bundle

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// A deployment is the same bundle with somewhere to run it.
//
// The single file an export makes is for handing to a person; this is for
// handing to a host. It is a directory rather than an image because that is
// what every Docker host already takes — `docker build`, `fly deploy`, a
// registry's own builder — and because building the image is the one step
// nobody deploying anything minds doing.
//
// Nothing here is compiled either: the runner is cross-built once and copied,
// and on Linux that is free — a pure Go program, no toolchain in the image, and
// no signature to invalidate by putting it somewhere.
const (
	DockerfileName = "Dockerfile"
	FlyConfigName  = "fly.toml"
	ReadmeName     = "README.md"
	RunnerName     = "kaja-run"
	// Where the app answers inside the container. It is stated in three places
	// that have to agree — the Dockerfile, the Fly config and the runner's own
	// $PORT — so it is written down once.
	ContainerPort = 8080
)

// WriteDeployment writes the directory a bundle is deployed from: the bundle,
// the runner for the platform the image runs on, and the three files that say
// how to build, run and configure it.
func WriteDeployment(dir string, manifest *Manifest, bundlePath string, runnerPath string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	name := manifest.Name + ".kaja"
	if err := copyFile(bundlePath, filepath.Join(dir, name), 0o644); err != nil {
		return fmt.Errorf("copying the bundle: %w", err)
	}
	if err := copyFile(runnerPath, filepath.Join(dir, RunnerName), 0o755); err != nil {
		return fmt.Errorf("copying the runner: %w", err)
	}

	for file, content := range map[string]string{
		DockerfileName: dockerfile(name),
		FlyConfigName:  flyConfig(manifest),
		ReadmeName:     readme(manifest, name),
	} {
		if err := os.WriteFile(filepath.Join(dir, file), []byte(content), 0o644); err != nil {
			return err
		}
	}
	return nil
}

// dockerfile is four instructions because there is nothing else to do: the
// runner is already built and the bundle is already frozen. Alpine rather than
// scratch for one reason — the certificates. A script calls somebody's HTTPS
// API, and an image with no root certificates fails every call with an error
// about none of it.
func dockerfile(bundleName string) string {
	return fmt.Sprintf(`# The app is the runner plus the bundle. Nothing is compiled here: the runner
# beside this file was built for linux when the app was exported, and the
# bundle holds a script whose apps were frozen then too.
FROM alpine:3

# A script calls an HTTPS API, so the image needs the roots to check it against.
RUN apk add --no-cache ca-certificates

COPY kaja-run /usr/local/bin/kaja-run
COPY %s /app/%s

# The runner binds $PORT on every interface when it is set, which is what a
# container is for, and a loopback port when it isn't.
ENV PORT=%d
EXPOSE %d

ENTRYPOINT ["/usr/local/bin/kaja-run", "/app/%s"]
`, bundleName, bundleName, ContainerPort, ContainerPort, bundleName)
}

// flyConfig is enough to `fly deploy` and no more. The health check is the one
// opinion in it: a deploy whose app never answered should fail rather than
// replace a working one.
func flyConfig(manifest *Manifest) string {
	config := &strings.Builder{}
	fmt.Fprintf(config, `# Deploy this directory:
#   fly launch --no-deploy   # once, to make the app and take a name
#   fly deploy
#
# The app makes calls with the credentials this process holds, so it refuses to
# start on a public address until it has been told who may run it:
%s#
app = "%s"

[build]

[http_service]
  internal_port = %d
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [[http_service.checks]]
    path = "/status"
    interval = "30s"
    timeout = "5s"
    grace_period = "10s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
`, tokenInstructions("#   "), flyName(manifest.Name), ContainerPort)
	return config.String()
}

func tokenInstructions(prefix string) string {
	return prefix + "fly secrets set KAJA_APP_TOKEN=$(openssl rand -hex 16)  # then open it as ?token=…\n" +
		prefix + "fly secrets set KAJA_APP_PUBLIC=1                       # or say it is meant to be open\n"
}

// readme is what the person deploying this has to know and could not work out
// from the files: which variables the script's apps read, and that the app will
// not come up until it knows who may run it.
func readme(manifest *Manifest, bundleName string) string {
	out := &strings.Builder{}
	fmt.Fprintf(out, "# %s\n\n", manifest.Name)
	fmt.Fprintf(out, "A Kaja script and everything it calls, frozen into `%s`. The image is that bundle\nand the runner beside it; nothing is compiled to build it.\n\n", bundleName)

	fmt.Fprintf(out, "## Run it\n\n```\ndocker build -t %s .\ndocker run -p %d:%d -e KAJA_APP_PUBLIC=1 %s\n```\n\n",
		manifest.Name, ContainerPort, ContainerPort, manifest.Name)
	fmt.Fprintf(out, "Or `fly launch --no-deploy && fly deploy`, with `fly.toml` beside this file.\n\n")

	fmt.Fprintf(out, "## Who may run it\n\n")
	fmt.Fprintf(out, "A run makes calls with the credentials this process holds, so the app refuses to\nstart on an address other than the loopback one until it has been told one of two\nthings:\n\n")
	fmt.Fprintf(out, "- `KAJA_APP_TOKEN=<secret>` — reach it as `?token=<secret>`, which is remembered\n  in a cookie and taken back out of the URL.\n")
	fmt.Fprintf(out, "- `KAJA_APP_PUBLIC=1` — this app is meant to be open to anyone who finds it.\n\n")

	if len(manifest.Variables) == 0 {
		fmt.Fprintf(out, "## Variables\n\nThis app reads none.\n")
		return out.String()
	}

	fmt.Fprintf(out, "## Variables\n\nThe script's apps read these where the app runs. A value is never in the bundle.\n\n")
	for _, variable := range manifest.Variables {
		switch variable.Source {
		case SourceFile:
			fmt.Fprintf(out, "- `%s` — travels with the bundle; set `%s` to override it.\n", variable.Name, EnvName(variable.Name))
		default:
			fmt.Fprintf(out, "- `%s` — **set `%s`**, or every call it is part of fails without saying why.\n", variable.Name, variable.Env)
		}
	}
	fmt.Fprintf(out, "\n```\nfly secrets set %s\n```\n", strings.Join(secretAssignments(manifest), " \\\n  "))
	return out.String()
}

func secretAssignments(manifest *Manifest) []string {
	var assignments []string
	for _, variable := range manifest.Variables {
		if variable.Source == SourceFile {
			continue
		}
		assignments = append(assignments, variable.Env+"=…")
	}
	if len(assignments) == 0 {
		assignments = append(assignments, "KAJA_APP_TOKEN=…")
	}
	return assignments
}

// flyName is the manifest's name as Fly will take it: lowercase, and hyphens
// where a name has anything else.
func flyName(name string) string {
	lowered := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			return r
		case r >= 'A' && r <= 'Z':
			return r + ('a' - 'A')
		}
		return '-'
	}, name)
	trimmed := strings.Trim(lowered, "-")
	if trimmed == "" {
		return "kaja-app"
	}
	return trimmed
}

func copyFile(from string, to string, mode os.FileMode) error {
	source, err := os.Open(from)
	if err != nil {
		return err
	}
	defer source.Close()

	target, err := os.OpenFile(to, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer target.Close()

	if _, err := io.Copy(target, source); err != nil {
		return err
	}
	return target.Sync()
}

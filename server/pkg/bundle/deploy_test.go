package bundle

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteDeployment(t *testing.T) {
	work := t.TempDir()
	bundlePath := filepath.Join(work, "movies.kaja")
	runnerPath := filepath.Join(work, "kaja-run")
	if err := os.WriteFile(bundlePath, []byte("a bundle"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(runnerPath, []byte("a runner"), 0o755); err != nil {
		t.Fatal(err)
	}

	manifest := &Manifest{
		Name: "movies",
		Variables: []Variable{
			{Name: "TOKEN", Source: SourceSecret, Env: "KAJA_TOKEN"},
			{Name: "GREETING", Source: SourceFile, Value: "hello"},
		},
	}

	dir := filepath.Join(t.TempDir(), "deployment")
	if err := WriteDeployment(dir, manifest, bundlePath, runnerPath); err != nil {
		t.Fatalf("WriteDeployment: %v", err)
	}

	for _, name := range []string{DockerfileName, FlyConfigName, ReadmeName, RunnerName, "movies.kaja"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s was not written: %v", name, err)
		}
	}

	// The runner has to be executable in the image, and a COPY keeps the mode it
	// was written with.
	info, err := os.Stat(filepath.Join(dir, RunnerName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Errorf("the runner is not executable: %v", info.Mode())
	}

	dockerfile := readFile(t, filepath.Join(dir, DockerfileName))
	// Nothing is compiled in the image: the runner is copied in, and the roots
	// are the one thing a script's HTTPS call needs that alpine hasn't got.
	if strings.Contains(dockerfile, "go build") {
		t.Errorf("the image should compile nothing:\n%s", dockerfile)
	}
	for _, line := range []string{"ca-certificates", "COPY kaja-run", "COPY movies.kaja", "ENV PORT=8080", "/app/movies.kaja"} {
		if !strings.Contains(dockerfile, line) {
			t.Errorf("the Dockerfile is missing %q:\n%s", line, dockerfile)
		}
	}

	fly := readFile(t, filepath.Join(dir, FlyConfigName))
	for _, line := range []string{`app = "movies"`, "internal_port = 8080", `path = "/status"`, "KAJA_APP_TOKEN", "KAJA_APP_PUBLIC"} {
		if !strings.Contains(fly, line) {
			t.Errorf("the Fly config is missing %q:\n%s", line, fly)
		}
	}

	readme := readFile(t, filepath.Join(dir, ReadmeName))
	// The one thing the person deploying this cannot work out from the files.
	if !strings.Contains(readme, "KAJA_TOKEN") {
		t.Errorf("the readme should name the variable to set:\n%s", readme)
	}
	// And a value that travels in the bundle is not one of those.
	if strings.Contains(readme, "hello") {
		t.Errorf("a variable's value should not be in the readme:\n%s", readme)
	}
}

// Fly names are lowercase and hyphenated, and a script's name is whatever
// somebody called a file.
func TestFlyName(t *testing.T) {
	for name, want := range map[string]string{
		"movies":        "movies",
		"A Night Out":   "a-night-out",
		"whats_on":      "whats-on",
		"Report.2024":   "report-2024",
		"...":           "kaja-app",
		"":              "kaja-app",
		"a-night-out":   "a-night-out",
		"BillingReport": "billingreport",
	} {
		if got := flyName(name); got != want {
			t.Errorf("flyName(%q) = %q, want %q", name, got, want)
		}
	}
}

func readFile(t *testing.T, name string) string {
	t.Helper()
	content, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}

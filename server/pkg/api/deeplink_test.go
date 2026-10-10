package api

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLinkedScriptNameReadsTheLinkGrammar(t *testing.T) {
	cases := map[string]string{
		"kaja://run/churn":                "churn",
		"kaja://run/churn.ts?id=1":        "churn",
		"kaja://run/reports/churn?x=y":    "reports/churn",
		"kaja://RUN/a%20b":                "a b",
		"kaja://open/churn":               "",
		"https://kaja.example.com/#run/x": "",
		"not a link":                      "",
		"kaja://run/":                     "",
	}
	for link, want := range cases {
		if got := LinkedScriptName(link); got != want {
			t.Errorf("LinkedScriptName(%q) = %q, want %q", link, got, want)
		}
	}
}

func TestWorkspaceHasScriptLooksInsideTheScriptsFolder(t *testing.T) {
	dir := t.TempDir()
	configurationPath := filepath.Join(dir, "kaja.json")
	if err := os.WriteFile(configurationPath, []byte(`{}`), 0644); err != nil {
		t.Fatal(err)
	}
	scripts := filepath.Join(dir, "reports")
	if err := os.MkdirAll(scripts, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(scripts, "churn.ts"), []byte(""), 0644); err != nil {
		t.Fatal(err)
	}

	for named, want := range map[string]bool{
		"churn":         true,
		"churn.ts":      true,
		"reports/churn": true,
		"other/churn":   false,
		"revenue":       false,
	} {
		if got := WorkspaceHasScript(configurationPath, named); got != want {
			t.Errorf("WorkspaceHasScript(%q) = %v, want %v", named, got, want)
		}
	}
	if WorkspaceHasScript(filepath.Join(t.TempDir(), "kaja.json"), "churn") {
		t.Error("a workspace with no file has no scripts")
	}
}

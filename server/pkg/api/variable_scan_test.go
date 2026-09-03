package api

import (
	"context"
	"path/filepath"
	"testing"
)

func scan(t *testing.T, scripts map[string]string, names ...string) *ScanScriptVariablesResponse {
	t.Helper()
	service := NewApiService(workspaceWithScripts(t, scripts), true, "", "", nil)
	response, err := service.ScanScriptVariables(context.Background(), &ScanScriptVariablesRequest{Names: names})
	if err != nil {
		t.Fatalf("ScanScriptVariables failed: %v", err)
	}
	return response
}

func references(t *testing.T, response *ScanScriptVariablesResponse, name string) []*ScriptReference {
	t.Helper()
	for _, entry := range response.Variables {
		if entry.Name == name {
			return entry.Scripts
		}
	}
	t.Fatalf("no entry for %s", name)
	return nil
}

func TestScanCountsBothSpellings(t *testing.T) {
	response := scan(t, map[string]string{
		"one.ts": `const key = kaja.variables.TOKEN;
const other = kaja.variables["TOKEN"];
await Shows.ListShows({}, { headers: { Authorization: "Bearer ${TOKEN}" } });`,
	}, "TOKEN")

	found := references(t, response, "TOKEN")
	if len(found) != 1 {
		t.Fatalf("expected one script, got %d", len(found))
	}
	if found[0].Count != 3 {
		t.Errorf("expected 3 references, got %d", found[0].Count)
	}
}

func TestScanReportsTheAbsolutePathListScriptsWouldReport(t *testing.T) {
	configurationPath := workspaceWithScripts(t, map[string]string{"reports/churn.ts": "kaja.variables.HOST"})
	service := NewApiService(configurationPath, true, "", "", nil)
	response, err := service.ScanScriptVariables(context.Background(), &ScanScriptVariablesRequest{Names: []string{"HOST"}})
	if err != nil {
		t.Fatalf("ScanScriptVariables failed: %v", err)
	}

	found := references(t, response, "HOST")
	if len(found) != 1 {
		t.Fatalf("expected one script, got %d", len(found))
	}
	want := filepath.Join(service.scriptsDir(), "reports", "churn.ts")
	if found[0].Path != want {
		t.Errorf("expected %s, got %s", want, found[0].Path)
	}
}

func TestScanCountsOnlyTheNamesAsked(t *testing.T) {
	response := scan(t, map[string]string{
		"one.ts": "const label = `${count} of ${total}`;\nkaja.variables.HOST;",
	}, "HOST")

	if len(response.Variables) != 1 {
		t.Fatalf("expected one entry, got %d", len(response.Variables))
	}
	if len(references(t, response, "HOST")) != 1 {
		t.Error("expected HOST to be found once")
	}
}

// An environment reference is the configuration's own spelling, so a script that
// happens to contain one is not using the variable named after the colon.
func TestScanIgnoresEnvironmentReferences(t *testing.T) {
	response := scan(t, map[string]string{"one.ts": `const url = "${env:HOST}";`}, "HOST")

	if found := references(t, response, "HOST"); len(found) != 0 {
		t.Errorf("expected no references, got %d", len(found))
	}
}

// "Scanned and found nothing" is drawn differently from "not scanned", so a name
// nothing mentions still comes back.
func TestScanAnswersForEveryNameAsked(t *testing.T) {
	response := scan(t, map[string]string{"one.ts": "kaja.variables.HOST"}, "HOST", "UNUSED")

	if len(response.Variables) != 2 {
		t.Fatalf("expected two entries, got %d", len(response.Variables))
	}
	if found := references(t, response, "UNUSED"); len(found) != 0 {
		t.Errorf("expected UNUSED to have no references, got %d", len(found))
	}
}

func TestScanOfAWorkspaceWithNoScriptsFolder(t *testing.T) {
	response := scan(t, nil, "HOST")

	if len(response.Variables) != 1 || len(response.Variables[0].Scripts) != 0 {
		t.Errorf("expected one empty entry, got %v", response.Variables)
	}
	if response.Truncated {
		t.Error("expected the scan not to report truncation")
	}
}

package bundle

import (
	"strings"
	"testing"
)

func TestScanImports(t *testing.T) {
	source := `import { kaja } from "kaja";
import { Shows, Houses as Screens } from "Theatre/service";
import { Status } from "Theatre/service";

const shows = await Shows.ListShows({});
kaja.table(["Title"], shows.items.map((show) => [show.title]));
`

	statements, body, err := ScanImports(source)
	if err != nil {
		t.Fatalf("ScanImports: %v", err)
	}

	if len(statements) != 3 {
		t.Fatalf("got %d imports, want 3: %+v", len(statements), statements)
	}
	if statements[0].Path != "kaja" || statements[0].Specifiers[0].Alias != "kaja" {
		t.Errorf("first import = %+v", statements[0])
	}
	if got := statements[1].Specifiers; len(got) != 2 || got[1].Name != "Houses" || got[1].Alias != "Screens" {
		t.Errorf("aliased specifier not read: %+v", got)
	}
	if statements[2].Line != 3 {
		t.Errorf("line = %d, want 3", statements[2].Line)
	}

	if strings.Contains(body, "import") {
		t.Errorf("body still holds an import:\n%s", body)
	}
	if !strings.Contains(body, "const shows = await Shows.ListShows({});") {
		t.Errorf("body lost its statements:\n%s", body)
	}
	// The blanked imports keep their newlines, so a line number in the body is
	// still the line the author wrote it on.
	if got, want := lineOf(body, strings.Index(body, "const shows")), 5; got != want {
		t.Errorf("body line = %d, want %d", got, want)
	}
}

func TestScanImportsLeavesTheWordAlone(t *testing.T) {
	source := "const note = \"import { Shows } from 'Theatre/service'\";\n" +
		"// import { Houses } from \"Theatre/service\";\n" +
		"/* import { Seats } from \"Theatre/service\"; */\n" +
		"const template = `\nimport { Rows } from \"Theatre/service\";\n`;\n" +
		"const imported = 1;\n"

	statements, body, err := ScanImports(source)
	if err != nil {
		t.Fatalf("ScanImports: %v", err)
	}
	if len(statements) != 0 {
		t.Fatalf("got %d imports, want 0: %+v", len(statements), statements)
	}
	if body != source {
		t.Errorf("body was rewritten:\n%s", body)
	}
}

func TestScanImportsMultiLine(t *testing.T) {
	source := `import {
  Shows,
  Houses,
} from "Theatre/service";

Shows.ListShows({});
`
	statements, body, err := ScanImports(source)
	if err != nil {
		t.Fatalf("ScanImports: %v", err)
	}
	if len(statements) != 1 || len(statements[0].Specifiers) != 2 {
		t.Fatalf("got %+v", statements)
	}
	if strings.Contains(body, "Houses,") {
		t.Errorf("body still holds the import:\n%s", body)
	}
	if got, want := lineOf(body, strings.Index(body, "Shows.ListShows")), 6; got != want {
		t.Errorf("body line = %d, want %d", got, want)
	}
}

func TestScanImportsTypeOnly(t *testing.T) {
	source := `import type { Show } from "Theatre/service";
import { Shows, type Show as ShowType } from "Theatre/service";
Shows.ListShows({});
`
	statements, _, err := ScanImports(source)
	if err != nil {
		t.Fatalf("ScanImports: %v", err)
	}
	if !statements[0].TypeOnly {
		t.Errorf("type-only import not marked: %+v", statements[0])
	}
	if got := statements[1].Specifiers; len(got) != 1 || got[0].Name != "Shows" {
		t.Errorf("per-specifier type not dropped: %+v", got)
	}
}

func TestScanImportsRefusesUnnamedForms(t *testing.T) {
	for _, source := range []string{
		`import Theatre from "Theatre/service";`,
		`import * as Theatre from "Theatre/service";`,
		`import "Theatre/service";`,
	} {
		if _, _, err := ScanImports(source); err == nil {
			t.Errorf("%s: want an error naming the form", source)
		} else if !strings.Contains(err.Error(), "Theatre/service") {
			t.Errorf("%s: error should name the path, got %v", source, err)
		}
	}
}

func TestScanImportsAfterCode(t *testing.T) {
	// Not a form anything generates, but a script is a file somebody edits.
	source := "const a = 1;\nimport { Shows } from \"Theatre/service\";\nShows.ListShows({});\n"
	statements, body, err := ScanImports(source)
	if err != nil {
		t.Fatalf("ScanImports: %v", err)
	}
	if len(statements) != 1 {
		t.Fatalf("got %+v", statements)
	}
	if strings.Contains(body, "import") {
		t.Errorf("body still holds the import:\n%s", body)
	}
}

package api

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"sort"
)

// The scan behind the Variables screen's "Used by". An app's references are in the
// configuration the UI already holds, so it answers those itself; a script's cost a
// read of the file, and reading a folder one file at a time over the wire is what
// would make the column expensive. So it is one walk here: the names go down, the
// references come back, and the screen has nothing to pace.

const (
	// A workspace of scripts is a folder somebody writes by hand, so these are a
	// ceiling on a pathological one rather than a budget the common case spends.
	maxScannedFiles = 2000
	maxScannedBytes = 1 << 20
)

// Both spellings of a reference in one pass: what a script reads, and what it sends
// for the request hop to expand. `${env:X}` is not one of them - the colon keeps it
// out - because that form is the configuration's own.
var scriptVariableReference = regexp.MustCompile(
	`\$\{([A-Za-z_][A-Za-z0-9_]*)\}` +
		`|kaja\.variables\.([A-Za-z_][A-Za-z0-9_]*)` +
		`|kaja\.variables\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]`,
)

// ScanScriptVariables reads every script under the workspace's scripts folder and
// reports which of the named variables each one mentions. A name nothing mentions
// still gets an entry, because "scanned and found nothing" is an answer the caller
// draws differently from "not scanned".
func (s *ApiService) ScanScriptVariables(ctx context.Context, req *ScanScriptVariablesRequest) (*ScanScriptVariablesResponse, error) {
	wanted := make(map[string]bool, len(req.Names))
	for _, name := range req.Names {
		wanted[name] = true
	}

	dir := s.scriptsDir()
	found := make(map[string][]*ScriptReference)
	truncated := false
	scanned := 0

	var relatives []string
	if err := walkScripts(dir, func(relative string) { relatives = append(relatives, relative) }, nil); err != nil {
		return nil, fmt.Errorf("failed to scan scripts: %w", err)
	}
	sort.Strings(relatives)

	root, err := os.OpenRoot(dir)
	if err != nil {
		// A workspace with no scripts folder references nothing, which is the same
		// answer as a folder holding no scripts.
		if os.IsNotExist(err) {
			return &ScanScriptVariablesResponse{Variables: emptyReferences(req.Names)}, nil
		}
		return nil, fmt.Errorf("failed to open the scripts folder: %w", err)
	}
	defer root.Close()

	for _, relative := range relatives {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if scanned >= maxScannedFiles {
			truncated = true
			break
		}
		scanned++

		content, err := root.ReadFile(relative)
		if err != nil {
			// A script that went away between the walk and the read is one fewer
			// place a variable is used, not a failed scan.
			continue
		}
		if len(content) > maxScannedBytes {
			content = content[:maxScannedBytes]
			truncated = true
		}

		for name, count := range countReferences(content, wanted) {
			found[name] = append(found[name], &ScriptReference{Path: s.ScriptPath(relative), Count: int32(count)})
		}
	}

	variables := make([]*VariableReferences, 0, len(req.Names))
	for _, name := range req.Names {
		variables = append(variables, &VariableReferences{Name: name, Scripts: found[name]})
	}
	return &ScanScriptVariablesResponse{Variables: variables, Truncated: truncated}, nil
}

func countReferences(content []byte, wanted map[string]bool) map[string]int {
	counts := map[string]int{}
	for _, match := range scriptVariableReference.FindAllSubmatch(content, -1) {
		for _, group := range match[1:] {
			if len(group) == 0 {
				continue
			}
			if name := string(group); wanted[name] {
				counts[name]++
			}
			break
		}
	}
	return counts
}

func emptyReferences(names []string) []*VariableReferences {
	variables := make([]*VariableReferences, 0, len(names))
	for _, name := range names {
		variables = append(variables, &VariableReferences{Name: name})
	}
	return variables
}

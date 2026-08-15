package bundle

import (
	"fmt"
	"strings"
)

// ImportStatement is one `import { … } from "…"` a script wrote.
type ImportStatement struct {
	Path       string
	Specifiers []ImportSpecifier
	// TypeOnly imports nothing that exists at run time, so it is read and
	// dropped rather than resolved against an app.
	TypeOnly bool
	Line     int
}

// ImportSpecifier is one name in the braces. Name is the export's own name,
// Alias what the body calls it — `{ Shows as Theatre }` is both.
type ImportSpecifier struct {
	Name  string
	Alias string
}

// ScanImports splits a script into its import statements and its body, with the
// imports blanked out of the body in place so every remaining line keeps its
// number — an error in an exported script still points at the line the author
// wrote it on.
//
// Kaja resolves imports at run time by walking the TypeScript AST. An export
// resolves them once, here, so the thing that runs the script needs no compiler
// to know what `Shows` is. Only named imports are recognised, which is the same
// rule the editor and the MCP guide already state; anything else is refused by
// name rather than dropped, since a binding that silently isn't there surfaces
// later as `Shows is not defined`.
func ScanImports(source string) ([]ImportStatement, string, error) {
	var statements []ImportStatement
	body := []byte(source)

	scanner := &scanner{source: source}
	for {
		start, ok := scanner.nextImport()
		if !ok {
			break
		}
		statement, end, err := parseImport(source, start)
		if err != nil {
			return nil, "", err
		}
		statement.Line = lineOf(source, start)
		if err := checkSpecifiers(statement); err != nil {
			return nil, "", err
		}
		statements = append(statements, statement)
		blank(body, start, end)
		scanner.skipTo(end)
	}

	return statements, string(body), nil
}

func checkSpecifiers(statement ImportStatement) error {
	if statement.TypeOnly || len(statement.Specifiers) > 0 {
		return nil
	}
	return fmt.Errorf(
		"line %d: `import … from %q` is not a form kaja can export — a script imports named bindings, as in `import { Shows } from %q`",
		statement.Line, statement.Path, statement.Path,
	)
}

// blank replaces a range with spaces, leaving its newlines where they were.
func blank(body []byte, start, end int) {
	for i := start; i < end && i < len(body); i++ {
		if body[i] != '\n' && body[i] != '\r' {
			body[i] = ' '
		}
	}
}

func lineOf(source string, offset int) int {
	return strings.Count(source[:offset], "\n") + 1
}

// scanner walks a script looking for the `import` keyword where it is really a
// keyword: at the start of a statement, and not inside a string, a template or
// a comment. A script that prints the word import is otherwise an export that
// mangles it.
type scanner struct {
	source string
	offset int
}

func (s *scanner) skipTo(offset int) {
	if offset > s.offset {
		s.offset = offset
	}
}

func (s *scanner) nextImport() (int, bool) {
	source := s.source
	statementStart := true

	for s.offset < len(source) {
		i := s.offset
		switch {
		case strings.HasPrefix(source[i:], "//"):
			s.offset = indexAfter(source, i, "\n")
			continue
		case strings.HasPrefix(source[i:], "/*"):
			s.offset = indexAfter(source, i+2, "*/")
			continue
		case source[i] == '"' || source[i] == '\'' || source[i] == '`':
			s.offset = skipString(source, i)
			statementStart = false
			continue
		}

		c := source[i]
		if c == '\n' || c == ';' || c == '{' || c == '}' {
			statementStart = true
			s.offset++
			continue
		}
		if c == ' ' || c == '\t' || c == '\r' {
			s.offset++
			continue
		}

		if statementStart && strings.HasPrefix(source[i:], "import") && isImportKeyword(source, i) {
			return i, true
		}

		statementStart = false
		s.offset++
	}

	return 0, false
}

// isImportKeyword rules out `imported` and `x.import`, and `import(` — a dynamic
// import is an expression, not a statement this resolves.
func isImportKeyword(source string, i int) bool {
	if i > 0 {
		previous := source[i-1]
		if isIdentifierByte(previous) || previous == '.' {
			return false
		}
	}
	rest := source[i+len("import"):]
	rest = strings.TrimLeft(rest, " \t\r\n")
	return strings.HasPrefix(rest, "{") || strings.HasPrefix(rest, "type") ||
		strings.HasPrefix(rest, "\"") || strings.HasPrefix(rest, "'") ||
		strings.HasPrefix(rest, "*") || isIdentifierStart(rest)
}

func isIdentifierStart(rest string) bool {
	if rest == "" {
		return false
	}
	c := rest[0]
	return c == '_' || c == '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func isIdentifierByte(c byte) bool {
	return c == '_' || c == '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
}

// parseImport reads one import statement starting at start, returning it and
// the offset just past it.
func parseImport(source string, start int) (ImportStatement, int, error) {
	statement := ImportStatement{}
	i := start + len("import")
	i = skipSpace(source, i)

	if strings.HasPrefix(source[i:], "type") && !isIdentifierByte(at(source, i+4)) {
		statement.TypeOnly = true
		i = skipSpace(source, i+4)
	}

	// `import "…"` — a side-effect import, which binds nothing.
	if at(source, i) == '"' || at(source, i) == '\'' {
		path, end, err := readString(source, i)
		if err != nil {
			return statement, 0, err
		}
		statement.Path = path
		return statement, skipSemicolon(source, end), nil
	}

	if at(source, i) == '{' {
		closing := strings.IndexByte(source[i:], '}')
		if closing < 0 {
			return statement, 0, fmt.Errorf("line %d: unterminated import", lineOf(source, start))
		}
		specifiers, err := parseSpecifiers(source[i+1 : i+closing])
		if err != nil {
			return statement, 0, fmt.Errorf("line %d: %w", lineOf(source, start), err)
		}
		statement.Specifiers = specifiers
		i = skipSpace(source, i+closing+1)
	} else {
		// A default or namespace import. Read to the module specifier so the error
		// can name the path, then let checkSpecifiers refuse it.
		for i < len(source) && at(source, i) != '"' && at(source, i) != '\'' {
			i++
		}
	}

	if strings.HasPrefix(source[i:], "from") {
		i = skipSpace(source, i+4)
	}

	path, end, err := readString(source, i)
	if err != nil {
		return statement, 0, fmt.Errorf("line %d: %w", lineOf(source, start), err)
	}
	statement.Path = path

	return statement, skipSemicolon(source, end), nil
}

func parseSpecifiers(text string) ([]ImportSpecifier, error) {
	var specifiers []ImportSpecifier
	for _, part := range strings.Split(text, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		// A per-specifier `type` marks one name as type-only; it binds nothing at
		// run time, so it is left out rather than resolved.
		if strings.HasPrefix(part, "type ") {
			continue
		}
		name, alias, found := strings.Cut(part, " as ")
		name = strings.TrimSpace(name)
		if !found {
			alias = name
		}
		alias = strings.TrimSpace(alias)
		if name == "" || alias == "" {
			return nil, fmt.Errorf("cannot read import specifier %q", part)
		}
		specifiers = append(specifiers, ImportSpecifier{Name: name, Alias: alias})
	}
	return specifiers, nil
}

func readString(source string, i int) (string, int, error) {
	i = skipSpace(source, i)
	quote := at(source, i)
	if quote != '"' && quote != '\'' {
		return "", 0, fmt.Errorf("expected a module path in quotes")
	}
	end := skipString(source, i)
	if end > len(source) {
		return "", 0, fmt.Errorf("unterminated module path")
	}
	return source[i+1 : end-1], end, nil
}

func skipString(source string, i int) int {
	quote := source[i]
	i++
	for i < len(source) {
		switch source[i] {
		case '\\':
			i += 2
			continue
		case quote:
			return i + 1
		}
		i++
	}
	return len(source)
}

func skipSpace(source string, i int) int {
	for i < len(source) {
		switch source[i] {
		case ' ', '\t', '\r', '\n':
			i++
		default:
			return i
		}
	}
	return i
}

func skipSemicolon(source string, i int) int {
	j := i
	for j < len(source) && (source[j] == ' ' || source[j] == '\t') {
		j++
	}
	if j < len(source) && source[j] == ';' {
		return j + 1
	}
	return i
}

func indexAfter(source string, from int, sep string) int {
	index := strings.Index(source[from:], sep)
	if index < 0 {
		return len(source)
	}
	return from + index + len(sep)
}

func at(source string, i int) byte {
	if i < 0 || i >= len(source) {
		return 0
	}
	return source[i]
}

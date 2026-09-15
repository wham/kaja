package mcp

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// headerAnnotation is the JSON Schema extension keyword a server marks a tool
// parameter with to have its value mirrored into an HTTP header.
const headerAnnotation = "x-mcp-header"

// headerParamPrefix is what a mirrored parameter's header name is built from:
// the annotation's value is the `{Name}` of `Mcp-Param-{Name}`.
const headerParamPrefix = "Mcp-Param-"

// HeaderParam is one `x-mcp-header` annotation: the name portion of the header
// the value travels under, and the chain of `properties` keys that reaches the
// value in a call's arguments.
type HeaderParam struct {
	Name string
	Path []string
}

// readHeaderParams reads a tool's `x-mcp-header` annotations, or says why the
// tool definition is invalid. An annotation is only ever valid on a primitive
// property reachable from the schema root through `properties` keys alone, so a
// walk of the whole document is what finds one that isn't: the transport mirrors
// what the annotation names, and a name an intermediary would route on that the
// client cannot extract is worse than a tool that is not offered at all.
func readHeaderParams(inputSchema json.RawMessage) ([]HeaderParam, error) {
	if len(inputSchema) == 0 {
		return nil, nil
	}
	var root any
	if json.Unmarshal(inputSchema, &root) != nil {
		return nil, nil
	}

	var found []HeaderParam
	var walk func(node any, path []string, onPath bool) error
	walk = func(node any, path []string, onPath bool) error {
		object, ok := node.(map[string]any)
		if !ok {
			return nil
		}
		if annotation, ok := object[headerAnnotation]; ok {
			param, err := readAnnotation(annotation, object, path, onPath)
			if err != nil {
				return err
			}
			found = append(found, param)
		}
		for key, child := range object {
			switch key {
			case headerAnnotation, "default", "const", "enum", "examples":
				// Values the document states, rather than schemas it nests.
			case "properties":
				for name, property := range mapOfSchemas(child) {
					if err := walk(property, append(append([]string{}, path...), name), onPath); err != nil {
						return err
					}
				}
			case "$defs", "definitions", "patternProperties", "dependentSchemas":
				for _, nested := range mapOfSchemas(child) {
					if err := walk(nested, nil, false); err != nil {
						return err
					}
				}
			default:
				for _, nested := range schemasUnder(child) {
					if err := walk(nested, nil, false); err != nil {
						return err
					}
				}
			}
		}
		return nil
	}
	if err := walk(root, nil, true); err != nil {
		return nil, err
	}

	sort.Slice(found, func(i, j int) bool { return found[i].Name < found[j].Name })
	seen := map[string]bool{}
	for _, param := range found {
		key := strings.ToLower(param.Name)
		if seen[key] {
			return nil, fmt.Errorf("two parameters are annotated %s %q", headerAnnotation, param.Name)
		}
		seen[key] = true
	}
	return found, nil
}

// mapOfSchemas reads a keyword whose value is an object of schemas rather than a
// schema of its own, which is what keeps a property called "x-mcp-header" from
// reading as an annotation on the object holding it.
func mapOfSchemas(node any) map[string]any {
	object, ok := node.(map[string]any)
	if !ok {
		return nil
	}
	return object
}

// schemasUnder is the schema or schemas a keyword's value holds, which is one
// for `items` and a list for `allOf` and its kin.
func schemasUnder(node any) []any {
	if list, ok := node.([]any); ok {
		return list
	}
	return []any{node}
}

// readAnnotation checks one `x-mcp-header` against everything the specification
// insists on, and reports the first thing that is wrong with it.
func readAnnotation(annotation any, property map[string]any, path []string, onPath bool) (HeaderParam, error) {
	name, ok := annotation.(string)
	if !ok {
		return HeaderParam{}, fmt.Errorf("%s is not a string", headerAnnotation)
	}
	if !onPath || len(path) == 0 {
		return HeaderParam{}, fmt.Errorf("%s %q is not on a property reachable from the schema root through properties alone", headerAnnotation, name)
	}
	if name == "" {
		return HeaderParam{}, fmt.Errorf("%s is empty", headerAnnotation)
	}
	if !isHeaderToken(name) {
		return HeaderParam{}, fmt.Errorf("%s %q is not a header name", headerAnnotation, name)
	}
	if typeName, ok := primitiveType(property["type"]); !ok {
		return HeaderParam{}, fmt.Errorf("%s %q is on a %s parameter, which is not a string, an integer or a boolean", headerAnnotation, name, typeName)
	}
	return HeaderParam{Name: name, Path: path}, nil
}

// isHeaderToken reports whether a name is an HTTP field-name token, which rules
// out the empty string, whitespace and every control character with it.
func isHeaderToken(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			continue
		}
		if !strings.ContainsRune("!#$%&'*+-.^_`|~", r) {
			return false
		}
	}
	return true
}

// primitiveType reads the `type` a mirrored parameter is allowed to declare. A
// union with "null" is the type itself, the way every other schema here reads
// one; `number` is excluded by the specification, so that a value's decimal
// form is never something the header and the body could disagree about.
func primitiveType(declared any) (string, bool) {
	switch value := declared.(type) {
	case string:
		switch value {
		case "string", "integer", "boolean":
			return value, true
		case "":
			return "untyped", false
		}
		return value, false
	case []any:
		named := ""
		for _, entry := range value {
			name, ok := entry.(string)
			if !ok || name == "null" {
				continue
			}
			if named != "" {
				return "union", false
			}
			named = name
		}
		if named == "" {
			return "untyped", false
		}
		return primitiveType(named)
	}
	return "untyped", false
}

// mirroredValues reads the values a call's arguments hold at each annotated
// property's exact path. A path nothing is written at is a header that is not
// sent, which is what a server validating the two against each other expects.
func mirroredValues(params []HeaderParam, arguments map[string]json.RawMessage) map[string]string {
	if len(params) == 0 {
		return nil
	}
	values := map[string]string{}
	for _, param := range params {
		if value, ok := valueAtPath(arguments, param.Path); ok {
			values[param.Name] = value
		}
	}
	if len(values) == 0 {
		return nil
	}
	return values
}

func valueAtPath(arguments map[string]json.RawMessage, path []string) (string, bool) {
	if len(path) == 0 {
		return "", false
	}
	raw, ok := arguments[path[0]]
	if !ok {
		return "", false
	}
	for _, segment := range path[1:] {
		nested := map[string]json.RawMessage{}
		if json.Unmarshal(raw, &nested) != nil {
			return "", false
		}
		if raw, ok = nested[segment]; !ok {
			return "", false
		}
	}
	return headerText(raw)
}

// headerText renders one JSON value as the text its header carries. Only the
// three primitive types an annotation is allowed on have one; anything else -
// including the null that says a value was not given - is a header omitted.
func headerText(raw json.RawMessage) (string, bool) {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return "", false
	}
	switch typed := value.(type) {
	case string:
		return typed, true
	case bool:
		return strconv.FormatBool(typed), true
	case float64:
		if typed != float64(int64(typed)) {
			return "", false
		}
		return strconv.FormatInt(int64(typed), 10), true
	}
	return "", false
}

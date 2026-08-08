package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// The runtime contract every tool description leans on. It is repeated in the
// guide, but a tool description is the one channel a client cannot drop, so the
// facts a script would otherwise be discovered by probing live here too.
const runtimeNote = "Scripts are TypeScript run inside Kaja: top-level await works, and imports resolve as `<app>/<path>` " +
	"(named imports only - `import * as ns` does not resolve). " +
	"A script is a body of statements, not a function: it has NO return value, and a top-level `return` is an error the app refuses to run. " +
	"It says what it produced instead - `console.log(...)` writes the transcript, and `kaja.text(...)`, `kaja.code(...)` and " +
	"`kaja.table(columns).row(...)` draw on the run's canvas, which is how a script renders a table (never build one out of Markdown). " +
	"A table can also be handed its rows - `kaja.table(columns, rows)` for an array, or an async generator that yields rows, " +
	"which the table pulls a page at a time as the reader pages through it (declare a `search` parameter and it is restarted for each search). " +
	"Your run draws its first page and reports `more: true`; nobody is there to page it, so read the rest with an ordinary loop if you need it. " +
	"Get the runtime's full declaration with describe_type \"kaja\"; it comes from `import { kaja } from \"kaja\";`. " +
	"There is no interactive input: `prompt`/`alert`/`confirm` do nothing. Use `kaja.ask()` only when a person is at the app."

// toolDefinitions is the static tools/list payload. Schemas are hand-written
// JSON Schema; keep them in sync with handleToolCall below.
func toolDefinitions() []map[string]interface{} {
	str := func(desc string) map[string]interface{} {
		return map[string]interface{}{"type": "string", "description": desc}
	}
	obj := func(props map[string]interface{}, required ...string) map[string]interface{} {
		schema := map[string]interface{}{"type": "object", "properties": props}
		if len(required) > 0 {
			schema["required"] = required
		}
		return schema
	}
	return []map[string]interface{}{
		{
			"name": "list_services",
			"description": "Index of everything a script can call: every app, service and method, each method's request and response type, " +
				"and whether calling it reads or writes. Start here, then use describe_method for the one you want. " +
				"Filter with app, service or search to keep the answer small on a large API.",
			"inputSchema": obj(map[string]interface{}{
				"app":     str("Only this app."),
				"service": str("Only this service."),
				"search":  str("Only methods whose app, service, method name, HTTP request or description contains this text."),
			}),
		},
		{
			"name": "describe_method",
			"description": "Everything needed to call one method: its TypeScript signature, the declarations of every type that signature " +
				"names (transitively), whether the call reads or writes, and a call to start from. " +
				"This is the generated code a script is checked against, so it is the whole answer - there is nothing else to read.",
			"inputSchema": obj(map[string]interface{}{
				"method": str("\"<Service>.<Method>\", e.g. \"Shows.ListShows\". Prefix with \"<app>/\" when two apps share a service name."),
			}, "method"),
		},
		{
			"name": "describe_type",
			"description": "The TypeScript declaration of one type, with everything it references. " +
				"Use it when describe_method had to cut a large type short, or to look a type up on its own. " +
				"Ask for \"kaja\" to get the runtime object a script writes its output with - the canvas verbs " +
				"(text, code, table), the user's variables, ask, and the JSON builders.",
			"inputSchema": obj(map[string]interface{}{
				"name": str("The type's name, e.g. \"Show\" - or \"kaja\" for the runtime object."),
				"app":  str("Which app declares it, when two apps declare the same name."),
			}, "name"),
		},
		{
			"name":        "list_scripts",
			"description": "List the saved Kaja scripts (name and path).",
			"inputSchema": obj(map[string]interface{}{}),
		},
		{
			"name":        "read_script",
			"description": "Read the full contents of a script by its path.",
			"inputSchema": obj(map[string]interface{}{"path": str("Absolute path of the script, as returned by list_scripts.")}, "path"),
		},
		{
			"name":        "write_script",
			"description": "Overwrite the contents of an existing script identified by its path.",
			"inputSchema": obj(map[string]interface{}{
				"path":    str("Absolute path of the script to overwrite."),
				"content": str("New TypeScript contents."),
			}, "path", "content"),
		},
		{
			"name":        "create_script",
			"description": "Create a new script. Fails if one with the same name already exists.",
			"inputSchema": obj(map[string]interface{}{
				"name":    str("File name, e.g. \"sync-users\". A .ts extension is added if missing."),
				"content": str("Initial TypeScript contents."),
			}, "name", "content"),
		},
		{
			"name":        "rename_script",
			"description": "Rename a script.",
			"inputSchema": obj(map[string]interface{}{
				"path":     str("Absolute path of the script to rename."),
				"new_name": str("New file name. A .ts extension is added if missing."),
			}, "path", "new_name"),
		},
		{
			"name":        "delete_script",
			"description": "Delete a script by its path.",
			"inputSchema": obj(map[string]interface{}{"path": str("Absolute path of the script to delete.")}, "path"),
		},
		{
			"name": "run_script",
			"description": "Run a script and return its console output, what it drew on the run's canvas, and every RPC it made with a typed verdict on each. " +
				"Provide either path (a saved script) or code (an inline snippet). " +
				"Inline code is not hidden: it runs in a scratch buffer in the user's own sidebar, titled from your code, and every run lands in " +
				"that buffer's console beside the user's own runs. You get the same buffer each time. A rejected call does not throw - it is " +
				"reported and the script keeps going, with undefined in place of the response. " +
				runtimeNote,
			"inputSchema": obj(map[string]interface{}{
				"path": str("Absolute path of a saved script to run."),
				"code": str("Inline TypeScript to run instead of a saved script."),
			}),
		},
	}
}

type toolCallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

func (s *Server) handleToolCall(ctx context.Context, params json.RawMessage) (interface{}, *rpcError) {
	var p toolCallParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &rpcError{Code: codeInvalidParams, Message: "invalid params"}
	}
	args := map[string]string{}
	if len(p.Arguments) > 0 {
		// Tolerate non-string values by decoding loosely.
		var raw map[string]interface{}
		if err := json.Unmarshal(p.Arguments, &raw); err != nil {
			return nil, &rpcError{Code: codeInvalidParams, Message: "invalid arguments"}
		}
		for k, v := range raw {
			if sv, ok := v.(string); ok {
				args[k] = sv
			}
		}
	}

	switch p.Name {
	case "list_services":
		return textToolResult(s.bridge.Catalog().listServices(args["app"], args["service"], args["search"])), nil
	case "describe_method":
		return s.describeMethod(args["method"]), nil
	case "describe_type":
		return s.describeType(args["name"], args["app"]), nil
	case "list_scripts":
		scripts, err := s.bridge.ListScripts()
		if err != nil {
			return errorToolResult(err), nil
		}
		return jsonToolResult(scripts)
	case "read_script":
		content, err := s.bridge.ReadScript(args["path"])
		if err != nil {
			return errorToolResult(err), nil
		}
		return textToolResult(content), nil
	case "write_script":
		if err := s.bridge.WriteScript(args["path"], args["content"]); err != nil {
			return errorToolResult(err), nil
		}
		return textToolResult("Saved " + args["path"]), nil
	case "create_script":
		info, err := s.bridge.CreateScript(args["name"], args["content"])
		if err != nil {
			return errorToolResult(err), nil
		}
		return jsonToolResult(info)
	case "rename_script":
		info, err := s.bridge.RenameScript(args["path"], args["new_name"])
		if err != nil {
			return errorToolResult(err), nil
		}
		return jsonToolResult(info)
	case "delete_script":
		if err := s.bridge.DeleteScript(args["path"]); err != nil {
			return errorToolResult(err), nil
		}
		return textToolResult("Deleted " + args["path"]), nil
	case "run_script":
		return s.runScript(ctx, args["path"], args["code"]), nil
	default:
		return nil, &rpcError{Code: codeInvalidParams, Message: fmt.Sprintf("unknown tool %q", p.Name)}
	}
}

// describeMethod answers for one method, and when it can't, says what to ask for
// instead: an ambiguous name lists its candidates, an unknown one lists the
// nearest matches. A miss that only says no costs a whole extra round trip.
func (s *Server) describeMethod(name string) map[string]interface{} {
	if strings.TrimSpace(name) == "" {
		return errorToolResult(fmt.Errorf("provide method, e.g. \"Shows.ListShows\""))
	}
	catalog := s.bridge.Catalog()
	resolved, ambiguous, ok := catalog.findMethod(name)
	if ok {
		return textToolResult(catalog.describeMethod(resolved))
	}
	if len(ambiguous) > 0 {
		return errorToolResult(fmt.Errorf("%q is exposed by more than one app; ask for one of: %s", name, strings.Join(ambiguous, ", ")))
	}
	if suggestions := catalog.suggest(name); len(suggestions) > 0 {
		return errorToolResult(fmt.Errorf("no method %q. Closest: %s", name, strings.Join(suggestions, ", ")))
	}
	return errorToolResult(fmt.Errorf("no method %q. Call list_services to see what is callable", name))
}

// describeType answers for one type by name. Types live per app, so a name two
// apps both declare is reported rather than guessed at. "kaja" is the exception:
// it belongs to no app, and it is what a script writes its output with.
func (s *Server) describeType(name, appName string) map[string]interface{} {
	if strings.TrimSpace(name) == "" {
		return errorToolResult(fmt.Errorf("provide name, e.g. \"Show\""))
	}
	catalog := s.bridge.Catalog()

	if isRuntimeName(name) && catalog.Runtime != "" {
		return textToolResult(catalog.Runtime)
	}

	var found []CatalogApp
	for _, app := range catalog.Apps {
		if appName != "" && !strings.EqualFold(app.Name, appName) {
			continue
		}
		if _, ok := app.Declarations[name]; ok {
			found = append(found, app)
		}
	}

	switch len(found) {
	case 0:
		if near := catalog.suggestTypes(name); len(near) > 0 {
			return errorToolResult(fmt.Errorf("no type %q. Closest: %s", name, strings.Join(near, ", ")))
		}
		return errorToolResult(fmt.Errorf("no type %q. Call list_services to see what is callable", name))
	case 1:
		return textToolResult(fmt.Sprintf("%s · %s\n\n%s", found[0].Name, name, found[0].renderDeclarations(name)))
	}
	names := make([]string, 0, len(found))
	for _, app := range found {
		names = append(names, app.Name)
	}
	return errorToolResult(fmt.Errorf("%q is declared by more than one app (%s); pass app to choose", name, strings.Join(names, ", ")))
}

func (s *Server) runScript(ctx context.Context, path, code string) map[string]interface{} {
	if path == "" && code == "" {
		return errorToolResult(fmt.Errorf("provide either path or code"))
	}
	result, err := s.bridge.RunScript(ctx, path, code)
	if err != nil {
		return errorToolResult(err)
	}
	label := path
	if label == "" {
		label = "inline script"
	}
	for i := range result.MethodCalls {
		result.MethodCalls[i].Input = compactJSON(result.MethodCalls[i].Input)
		result.MethodCalls[i].Output = compactJSON(result.MethodCalls[i].Output)
	}
	return textToolResult(renderRun(label, result))
}

// textToolResult wraps plain text in the MCP tool-result shape.
func textToolResult(text string) map[string]interface{} {
	return map[string]interface{}{
		"content": []map[string]interface{}{{"type": "text", "text": text}},
	}
}

// errorToolResult reports a tool failure to the model (isError=true) rather than
// a protocol error, so the agent can read and react to it.
func errorToolResult(err error) map[string]interface{} {
	return map[string]interface{}{
		"content": []map[string]interface{}{{"type": "text", "text": err.Error()}},
		"isError": true,
	}
}

// jsonToolResult renders any value as pretty JSON text content.
func jsonToolResult(v interface{}) (interface{}, *rpcError) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, &rpcError{Code: codeInternal, Message: err.Error()}
	}
	return textToolResult(string(b)), nil
}

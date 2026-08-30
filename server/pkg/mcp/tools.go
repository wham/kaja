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
const runtimeNote = "Scripts are TypeScript run inside Kaja: top-level await works, and an import names an app - " +
	"write the `importPath` from `list_services` verbatim, which is the app's name unless it declares one name in two modules " +
	"(named imports only - `import * as ns` does not resolve). " +
	"A script is a body of statements, not a function: it has NO return value, and a top-level `return` is an error the app refuses to run. " +
	"A run reports the script's type errors, checked against the same declarations describe_method prints: a script is transpiled rather than compiled, " +
	"so a type error does not stop a run - but it is red in the file the person whose Kaja this is opens. " +
	"It draws what it produced instead: `kaja.text(...)`, `kaja.code(...)` and `kaja.table(columns).row(...)` draw on the run's canvas, " +
	"which is the output the person who opens the script sees, and is how a script renders a table (never build one out of Markdown). " +
	"`console.log(...)` writes the log back to you - use it to probe while you work, and leave it out of a script " +
	"you keep; every call's request and response is reported to you without it. Every level is recorded as itself (debug/log/info/warn/error), " +
	"every other console method goes to devtools only, and there is no `kaja.log` - the standard console is the logging API. " +
	commentsNote + " " +
	"A table can also be handed its rows - `kaja.table(columns, rows)` for an array, or an async generator that yields rows, " +
	"which the table pulls a page at a time as the reader pages through it (declare a `search` parameter and it is restarted for each search). " +
	"Your run draws its first page and reports `more: true`; nobody is there to page it, so read the rest with an ordinary loop if you need it. " +
	"Get the runtime's full declaration with describe_type \"kaja\"; it comes from `import { kaja } from \"kaja\";`. " +
	"A method hands back a `Call`, not a promise: it is sent when you await it, and `await Service.Method({…})` is unchanged by that. " +
	"The call is where headers are said, either way round: `Service.Method(request, { headers: { \"Idempotency-Key\": id } })` sends one for that call alone, " +
	"over the app's own, and `const { response, headers } = await Service.Method(request).withHeaders()` is how the answer's headers are read " +
	"(lowercase names; awaiting a call without it still hands back the response alone). " +
	"The app's configured headers and credential are sent without a script saying anything, so add one only where the call itself needs it. " +
	"A request is an `Input<T>` - every field optional - and a field you leave out is sent as its zero value, so write the fields you mean and no others: " +
	"spelling out the whole shape as `\"\"` and `0` sends those values and buries the ones that carry meaning. " +
	"describe_method prints the declarations, so the request shape is never something a call has to restate. " +
	"An API that is not one of the apps is reached with `fetch(url, init)` - the standard global, and the only spelling of it: " +
	"inside a script the bare name is bound to Kaja's own, and there is no `kaja.fetch` beside it. " +
	"So it is a call in the run's log like any other and works with `kaja.approve` and `kaja.rateLimit(\"api.example.com\")`. " +
	"It is made by the browser, so an API that sends no CORS headers needs an app instead; it throws what fetch throws, " +
	"and an HTTP status is a response rather than a throw. Prefer an app's method where there is one - it is typed and its credential is already configured. " +
	"Globals a script cannot use are refused with a sentence naming what to reach for instead, rather than failing where they are written: " +
	"`prompt`/`alert`/`confirm` (nobody may be watching the window), `XMLHttpRequest`/`WebSocket`/`EventSource`, " +
	"`localStorage`/`sessionStorage`/`indexedDB` and `document`/`window` (they are Kaja's own), and `require`/`process` (a script is not Node). " +
	"`crypto.randomUUID()` works, which it does not in every page Kaja runs in. " +
	"`kaja.askStr(q)`, `kaja.askInt(q)`, `kaja.askSelect(q, options)` and `kaja.approve(Service.Method({…}))`, which holds a call back " +
	"until it is approved, all park the run on a human, so use them only when a person is at the app."

// Writing a file checks nothing, so a script that is kept has to be run at least
// once. Said where a file is written, because that is where nothing else says it.
const writtenNote = "A file is saved as given - nothing checks it on the way to disk. run_script is what reports its type errors."

// What a comment in a script is worth saying. A script's calls name their own
// methods and its declarations state their own fields, so the comments an agent
// writes are mostly a second copy of the code beside it.
const commentsNote = "Keep comments sparse: the calls and the declarations already say what a script does, so comment only what the code cannot say - " +
	"a magic value the API insists on, a workaround, an ordering that matters. No header block over the file, no banner over a section, " +
	"and no line above a call restating which call it is."

// writeTools are the tools that put a file on disk. They are listed only where
// there is a disk to put one on (Bridge.CanWriteScripts).
var writeTools = map[string]bool{"write_script": true, "create_script": true, "rename_script": true, "delete_script": true}

// toolDefinitions is the tools/list payload. Schemas are hand-written JSON
// Schema; keep them in sync with handleToolCall below. canWrite drops the tools
// that write a file, which is the whole of what a read-only workspace changes.
func toolDefinitions(canWrite bool) []map[string]interface{} {
	all := allToolDefinitions()
	if canWrite {
		return all
	}
	kept := make([]map[string]interface{}, 0, len(all))
	for _, tool := range all {
		if name, _ := tool["name"].(string); writeTools[name] {
			continue
		}
		kept = append(kept, tool)
	}
	return kept
}

func allToolDefinitions() []map[string]interface{} {
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
			"description": "List the saved Kaja scripts: each one's name, the folder it is filed in, and its path.",
			"inputSchema": obj(map[string]interface{}{}),
		},
		{
			"name":        "read_script",
			"description": "Read the full contents of a script by its path.",
			"inputSchema": obj(map[string]interface{}{"path": str("Absolute path of the script, as returned by list_scripts.")}, "path"),
		},
		{
			"name":        "write_script",
			"description": "Overwrite the contents of an existing script identified by its path. " + writtenNote + " " + commentsNote,
			"inputSchema": obj(map[string]interface{}{
				"path":    str("Absolute path of the script to overwrite."),
				"content": str("New TypeScript contents."),
			}, "path", "content"),
		},
		{
			"name": "create_script",
			"description": "Create a new script. Fails if one with the same name already exists. " +
				"Scripts live in folders: name a folder in the path to file it there, and the folder is created if it doesn't exist. " +
				writtenNote + " " + commentsNote,
			"inputSchema": obj(map[string]interface{}{
				"name":    str("File name, e.g. \"sync-users\" or \"reports/weekly-usage\". A .ts extension is added if missing."),
				"content": str("Initial TypeScript contents."),
			}, "name", "content"),
		},
		{
			"name":        "rename_script",
			"description": "Rename a script, or move it into another folder — on disk those are one operation, because a file's path is its name.",
			"inputSchema": obj(map[string]interface{}{
				"path":     str("Absolute path of the script to rename."),
				"new_name": str("New name, optionally with a folder (\"reports/churn\"). A .ts extension is added if missing."),
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
				"Inline code is not hidden: it runs in a draft in the user's own sidebar, pinned at the top of Drafts and labelled with your name, " +
				"and every run lands in that draft's console beside the user's own runs. You get the same draft each time; if the user clears it, " +
				"the next run makes another. A rejected call does not throw - it is " +
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

	if writeTools[p.Name] && !s.bridge.CanWriteScripts() {
		return errorToolResult(fmt.Errorf("this Kaja serves a workspace it does not own, so %s is not available. Scripts here can be read and run, not written", p.Name)), nil
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
	result, err := s.bridge.RunScript(ctx, path, code, s.clientName())
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

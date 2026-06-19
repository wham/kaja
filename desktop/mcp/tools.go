package mcp

import (
	"context"
	"encoding/json"
	"fmt"
)

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
			"name":        "list_services",
			"description": "List every project, service, method, and request/response type a script can currently call. Start here.",
			"inputSchema": obj(map[string]interface{}{}),
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
			"name":        "run_script",
			"description": "Run a script and return its console output, return value, and the RPCs it made. Provide either path (a saved script) or code (an inline snippet).",
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
		return jsonToolResult(s.bridge.Catalog())
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
		path, code := args["path"], args["code"]
		if path == "" && code == "" {
			return errorToolResult(fmt.Errorf("provide either path or code")), nil
		}
		result, err := s.bridge.RunScript(ctx, path, code)
		if err != nil {
			return errorToolResult(err), nil
		}
		return jsonToolResult(result)
	default:
		return nil, &rpcError{Code: codeInvalidParams, Message: fmt.Sprintf("unknown tool %q", p.Name)}
	}
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

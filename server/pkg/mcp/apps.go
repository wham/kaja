package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// What an agent is told about describing an app, on both tools that take one.
const appDraftNote = "An app is the kaja.json shape said as strings: `type` is the kind of API and `parameters` its fields under that key. " +
	"A `${NAME}` in any value names one of the workspace's variables and is resolved where the app opens, so a credential the user already keeps " +
	"as a variable is written as `${NAME}` and never as its value."

const appTypeNote = "grpc, twirp, openapi, openai (a chat model, OpenAI or Claude shaped), mcp (somebody else's MCP server) or folder (files on this machine)."

const appParametersNote = "grpc: url (dns:host:443), reflection (\"true\" to read the surface off the server), proto_dir (a folder of .proto files inside the workspace), " +
	"tls, auth (bearer, basic, apikey, none), token, username, password, api_key_name. twirp: url, proto_dir. " +
	"openapi: spec_url or spec_content, base_url (which server, where the document names several), security_scheme (a key from the document's securitySchemes, or none), " +
	"token, username, password, spec_header_name and spec_header_value (for a document behind a login). " +
	"openai: endpoint, api (openai or anthropic), auth, token, api_key_name. mcp: url, auth (bearer, apikey, oauth, none), token, api_key_name, client_id, scope. folder: path."

func appDraft(arguments toolArguments) AppDraft {
	return AppDraft{
		Name:       strings.TrimSpace(arguments.strings["name"]),
		Type:       strings.TrimSpace(arguments.strings["type"]),
		Parameters: arguments.maps["parameters"],
		Headers:    arguments.maps["headers"],
	}
}

// inspectApi probes and reports, writing nothing. What is missing is said as the list
// add_app would act on, so the agent reads the same sentences either way.
func (s *Server) inspectApi(ctx context.Context, draft AppDraft) map[string]interface{} {
	inspection, err := s.bridge.InspectApp(ctx, draft)
	if err != nil {
		return errorToolResult(err)
	}
	if inspection.Problem != "" {
		return errorToolResult(errors.New(inspection.Problem))
	}
	var text strings.Builder
	text.WriteString(inspection.Summary)
	if len(inspection.Missing) > 0 {
		text.WriteString("\n\nAdding it needs:\n" + bullets(inspection.Missing))
		text.WriteString("\nadd_app opens Kaja's own New app form for the user to fill these in.")
	} else {
		text.WriteString("\n\nNothing is missing: add_app adds it as it is.")
	}
	return textToolResult(text.String())
}

// addApp is the one tool that asks something of the person, and it does so in Kaja
// itself: the window on duty opens the New app form prefilled with the draft, and the
// call waits for the person to save or close it. A token typed there never passes
// through the agent, and no client has to support anything for it.
func (s *Server) addApp(ctx context.Context, draft AppDraft, token json.RawMessage) map[string]interface{} {
	if draft.Name == "" {
		return errorToolResult(errors.New("provide name: it is what a script imports the app as"))
	}
	inspection, err := s.bridge.InspectApp(ctx, draft)
	if err != nil {
		return errorToolResult(err)
	}
	if inspection.Problem != "" {
		return errorToolResult(errors.New(inspection.Problem))
	}
	if len(inspection.Missing) == 0 {
		if err := s.bridge.AddApp(ctx, inspection.Settled); err != nil {
			return errorToolResult(err)
		}
		return s.appAdded(ctx, draft.Name, inspection.Summary)
	}

	if notify := notifierFrom(ctx); notify != nil && token != nil {
		notify("notifications/progress", map[string]interface{}{
			"progressToken": token,
			"progress":      0,
			"message":       fmt.Sprintf("Waiting for the user to finish adding %s in Kaja", draft.Name),
		})
	}
	outcome, err := s.bridge.AskAppForm(ctx, inspection.Settled)
	if err != nil {
		return errorToolResult(fmt.Errorf("%s was not added: %w. It still needs:\n%s", draft.Name, err, bullets(inspection.Missing)))
	}
	if !outcome.Saved {
		return textToolResult(fmt.Sprintf("The user closed Kaja's New app form without adding %s.", draft.Name))
	}
	return s.appAdded(ctx, outcome.Name, "")
}

// appAdded answers with what the app exposes, which is the thing the agent came for:
// the next call is a method call. The window compiles the app after the write, so the
// answer waits for it to be callable rather than sending the agent back to ask.
func (s *Server) appAdded(ctx context.Context, name string, summary string) map[string]interface{} {
	var text strings.Builder
	fmt.Fprintf(&text, "Added %s.", name)
	if summary != "" {
		text.WriteString(" " + summary)
	}
	if s.bridge.AwaitApp(ctx, name) {
		text.WriteString("\n\n" + s.bridge.Catalog().listServices(name, "", ""))
	} else {
		text.WriteString("\n\nKaja is still compiling it; call list_services in a moment to see what it exposes.")
	}
	return textToolResult(text.String())
}

func bullets(lines []string) string {
	var text strings.Builder
	for _, line := range lines {
		text.WriteString("- " + line + "\n")
	}
	return text.String()
}

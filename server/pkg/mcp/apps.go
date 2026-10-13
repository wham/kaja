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

// appFormKey is what the one request add_app makes is filed under in the result, and
// what the client's answer comes back under on the retry.
const appFormKey = "app"

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
		text.WriteString("\nadd_app asks the user for these in Kaja's own form.")
	} else {
		text.WriteString("\n\nNothing is missing: add_app adds it as it is.")
	}
	return textToolResult(text.String())
}

// addApp is the one tool that asks something of the person, and it does so by handing
// the client a page rather than a question: Kaja's own form, prefilled. A client that
// can open one is answered with input_required and asked to call again once it has;
// the retry waits for the form to be saved. A client that cannot is told what is
// missing and where the form is, and the agent relays it.
func (s *Server) addApp(ctx context.Context, draft AppDraft, params json.RawMessage) map[string]interface{} {
	if back := readRetry(params); back.State != "" {
		return s.finishAppForm(ctx, back)
	}
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

	prompt, err := s.bridge.OpenAppForm(inspection.Settled)
	if err != nil {
		return errorToolResult(err)
	}
	message := fmt.Sprintf("Kaja needs more to add %s:\n%sOpen Kaja to finish adding it.", draft.Name, bullets(inspection.Missing))
	if clientOpensURLs(params) {
		return inputRequired(appFormKey, urlElicitation(prompt.URL, message), prompt.RequestID)
	}
	// Nothing waits on this prompt, so it is let go rather than left for the sweep.
	s.bridge.DropAppForm(prompt.RequestID)
	return textToolResult(fmt.Sprintf("%s was not added yet. It still needs:\n%s\nAsk the user to finish it in Kaja's New app form - this link opens it prefilled: %s\n"+
		"Once they have saved it, call list_services to see what it exposes.", draft.Name, bullets(inspection.Missing), prompt.URL))
}

// finishAppForm is the retry: the client has asked the person to open the form, and
// says whether they agreed. Agreeing is not finishing, so the call then waits for the
// form itself to say what happened.
func (s *Server) finishAppForm(ctx context.Context, back retry) map[string]interface{} {
	if response, ok := back.Responses[appFormKey]; ok && response.Action != "accept" {
		s.bridge.DropAppForm(back.State)
		return textToolResult("The user declined to open Kaja, so no app was added.")
	}
	outcome, err := s.bridge.AwaitAppForm(ctx, back.State)
	if err != nil {
		return errorToolResult(err)
	}
	if !outcome.Saved {
		return textToolResult("The user closed the form without adding the app.")
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

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
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

// formWait is how long add_app waits on a form before answering that it is still
// open. A person takes longer than an agent's client will hold a call, so the call
// does not wait for them: it covers someone already looking at Kaja and hands the
// turn back otherwise.
var formWait = 25 * time.Second

// formBeat is how often a call waiting on a form says so, for a client that restarts
// its timeout on progress.
var formBeat = 10 * time.Second

// addApp is the one tool that asks something of the person, and it does so in Kaja
// itself: the window on duty opens the New app form prefilled with the draft. A token
// typed there never passes through the agent, and no client has to support anything
// for it. The form outlives the call, so calling again with the same name picks up
// what the person did with it rather than opening a second one.
func (s *Server) addApp(ctx context.Context, draft AppDraft, token json.RawMessage) map[string]interface{} {
	if draft.Name == "" {
		return errorToolResult(errors.New("provide name: it is what a script imports the app as"))
	}
	if result, found := s.awaitAppForm(ctx, draft.Name, nil, token, false); found {
		return result
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
	if err := s.bridge.OpenAppForm(ctx, inspection.Settled); err != nil {
		return errorToolResult(fmt.Errorf("%s was not added: %w. It still needs:\n%s", draft.Name, err, bullets(inspection.Missing)))
	}
	result, _ := s.awaitAppForm(ctx, draft.Name, inspection.Missing, token, true)
	return result
}

// awaitAppForm answers for the form open under a name, waiting up to formWait for the
// person to finish it. found is false where there is no such form. opened says the form
// was opened by this call, which is said at once; a call that only might find one says
// nothing until the first beat, so a name with no form costs no notification.
func (s *Server) awaitAppForm(ctx context.Context, name string, missing []string, token json.RawMessage, opened bool) (result map[string]interface{}, found bool) {
	wait, cancel := context.WithTimeout(ctx, formWait)
	defer cancel()
	stop := beatWhileWaiting(wait, token, fmt.Sprintf("Waiting for the user to finish adding %s in Kaja", name), opened)
	outcome, found, err := s.bridge.AwaitAppForm(wait, name)
	stop()
	if !found {
		return nil, false
	}
	if err != nil {
		if ctx.Err() == nil && errors.Is(err, context.DeadlineExceeded) {
			return textToolResult(formStillOpen(name, missing)), true
		}
		return errorToolResult(fmt.Errorf("%s was not added: %w", name, err)), true
	}
	if !outcome.Saved {
		return textToolResult(fmt.Sprintf("The user closed Kaja's New app form without adding %s. Call add_app again to open it again.", name)), true
	}
	return s.appAdded(ctx, outcome.Name, ""), true
}

func formStillOpen(name string, missing []string) string {
	var text strings.Builder
	fmt.Fprintf(&text, "Kaja's New app form for %s is open in front of the user, and %s is added when they save it.", name, name)
	if len(missing) > 0 {
		text.WriteString(" It still needs:\n" + bullets(missing))
	} else {
		text.WriteString("\n")
	}
	fmt.Fprintf(&text, "Tell the user to finish it in Kaja, and end your turn rather than waiting. "+
		"Once they say it is done, call add_app again with the name %q: it answers with what the user did, without opening a second form.", name)
	return text.String()
}

// beatWhileWaiting reports progress until stopped, where the caller asked to hear it.
// stop returns once the last beat is written, so none follows the answer.
func beatWhileWaiting(ctx context.Context, token json.RawMessage, message string, now bool) (stop func()) {
	notify := notifierFrom(ctx)
	if notify == nil || token == nil {
		return func() {}
	}
	started := time.Now()
	beat := func() {
		notify("notifications/progress", map[string]interface{}{
			"progressToken": token,
			"progress":      time.Since(started).Seconds(),
			"message":       message,
		})
	}
	if now {
		beat()
	}
	done := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(formBeat)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				beat()
			case <-done:
				return
			}
		}
	}()
	return func() {
		close(done)
		<-stopped
	}
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

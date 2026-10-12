# An agent adds an app

A proposal. Today an agent on Kaja's own MCP server can read, write and run scripts, and that is all: an app is added by a person in the window, and the blank slate says so. The aim is "let's explore this API" being enough, with the agent adding the app itself and asking the person only for what nothing else can say.

## What is missing is one of three things

Everything an app needs is in its `WorkspaceApp` message, and `Inspect*` already reads most of it off the server or the document. What a probe cannot settle falls in three groups, and each has its own door.

1. **The agent has it or can find out.** The address, the spec URL, the type. Where the type is unstated, probing the URL settles it: a reflection response is gRPC, a document is OpenAPI, `server/discover` or `initialize` is MCP.
2. **A choice only the person can make, and it is not a secret.** Which of several `servers` in a document, a server variable, which security scheme when the document declares several, the app's name where the derived one collides. These are **form-mode elicitation**: a flat schema of strings and enums, which the protocol built for exactly this. The options come from the `Inspect*` result, so the form is the OpenApiForm's choices asked in the agent's client instead.
3. **A secret.** A token, a password, an API key. The specification forbids asking for these through form mode and says URL mode is for them; and Kaja's own invariant says a value not written in kaja.json never travels to anything but the keychain. So a secret is **never asked for over MCP at all**. The tool writes the app with `"token": "${API_TOKEN}"` and the variable `API_TOKEN: "${secret}"`, and the person types the value into Kaja's own Variables screen, which is where it already goes. What travels over MCP is the *attention*: a URL-mode elicitation whose URL is Kaja's own address for that row (`kaja://` on the desktop, the page with a fragment on the web), so the client asks "open Kaja?" and the window lands on the field. When the client has no URL mode, the tool's text says the same thing and the agent relays it.

The result is that nothing an agent can do leaks a credential into a transcript, and the flow still finishes in one tool call where the client can prompt.

## The tools

- `inspect_api` (read): takes a URL, optionally a type, and answers with what `InspectGrpc`/`InspectOpenApi`/`InspectMcp` report, classified problems included. It writes nothing. This is the one that makes exploring cheap: the agent learns what the API is and what adding it will need before asking anyone anything.
- `add_app` (write): takes the type, the name and the non-secret parameters, plus the names of the secrets as `${NAME}` references. It probes, elicits what is missing from groups 2 and 3, writes the workspace through `UpdateWorkspace`, and answers once the window has compiled the app, with the new app's `list_services` index so the next call is a method call. It is absent from `tools/list` where the workspace is read-only, the rule the script-writing tools are already under.

`add_app` is written against `UpdateWorkspace`, not a new RPC: the window's `WatchWorkspace` stream is what makes an external write appear in the sidebar and compile, and the catalog the window pushes afterwards is what tells the agent the app is open. Duplicate names are refused server-side, which today only the UI checks.

## Elicitation across the eras this server speaks

Kaja's server reads the era off each request and holds nothing, and elicitation differs completely between the two.

**2026-07-28, which Claude Code's v2 runtime speaks.** There is no server-to-client request any more. The tool call answers with `resultType: "input_required"`, an `inputRequests` map holding the `elicitation/create` requests, and an opaque `requestState`; the client prompts, then **retries the call with a new id**, carrying `inputResponses` and the echoed `requestState`. The client's modes arrive on every request in `_meta["io.modelcontextprotocol/clientCapabilities"]` as `elicitation: { form: {}, url: {} }`, and a server must not send a mode the client did not declare. For Kaja the state is small, the app being assembled, and tampering can cause nothing worse than a failed add, so it can ride unprotected or be a key into a bounded map on the `Server`, which already exists per browser token. Two things in the code stand in the way: `complete()` stamps `resultType: "complete"` over every modern result, and `handleToolCall` drops every non-string argument, so `inputResponses` and a `headers` map never reach a tool.

**2025-06-18 and 2025-11-25, which Cursor, VS Code and Claude Code's v1 runtime speak.** The server sends a JSON-RPC *request* `elicitation/create` on the SSE stream of the POST it is answering, the client prompts, and POSTs the *response* back to the endpoint, which must answer 202 with no body. The client's modes are declared once, at `initialize`, so they have to be pinned beside the client's name the way the session id is. Three things are missing: a request with an id on the stream (today only id-less notifications go out, over a channel that drops when full), a pending map the handler waits on, and routing for a POSTed response, which today falls through `handlerFor("")` to a 404. On the desktop a `tools/call` is also only streamed when it carries a progress token, and an elicitation has to be able to stream the call on its own account.

**A client with neither.** The tool answers in text: what it added, what it could not settle, and where the person fills the token. The agent asks in chat for the choices and relays the pointer for the secret. This is the floor every other path is an upgrade on, and it is what makes the tool worth shipping before either elicitation path is.

Claude Code supports both modes and declares them on the new revision; Cursor and VS Code list elicitation on the handshake eras; the Claude desktop app has neither. So the modern path and the floor cover the agents the MCP page lists, and the handshake path is what reaches the rest.

## Order of work

1. `inspect_api` and `add_app` on the floor: no elicitation, text answers, the `${secret}` variable written and pointed at. Fix `handleToolCall`'s argument decoding on the way. Change the blank slate's sentence.
2. The modern path: read client capabilities off `_meta`, let a tool return `input_required`, take `inputResponses` and `requestState` on the retry.
3. The handshake path: pin capabilities at `initialize`, an id-bearing request on the stream, a pending map, 202 for a POSTed response, and streaming a call that needs it.

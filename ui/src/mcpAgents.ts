// The agents that can be pointed at Kaja's MCP server, and the snippet each one takes.
// An agent is a name, where its snippet goes, and the text of it — nothing here knows
// what the page looks like.
//
// "Agent" is the word throughout: the map, the section heading and this list all say
// the same one. "Client" is the MCP protocol's term for the end of the wire that
// connects, and it stays where the protocol is spoken.

/** The endpoint a snippet is written against. */
export interface McpEndpoint {
  url: string;
  token: string;
}

// What connecting costs, which is what the pane's shape varies on: a one-click install
// adds a button, a config file adds Reveal, a terminal command adds neither.
export type McpAgentKind = "one-click install" | "config file" | "terminal command";

export interface McpAgent {
  name: string;
  kind: McpAgentKind;
  /** Where the snippet goes, in the agent's own words. */
  path: string;
  lead: string;
  /** The one thing that bites after the snippet is in place, where there is one. */
  foot?: string;
  /**
   * The key the desktop resolves this agent's configuration file under. An agent
   * whose snippet goes into a file it names has one — a one-click agent included,
   * since the hand-edit under the button goes into that same file; one told to run a
   * command doesn't.
   */
  configurationKey?: string;
  install?: { label: string; link: (endpoint: McpEndpoint) => string };
  snippet: (endpoint: McpEndpoint) => string;
}

// Cursor and VS Code both register a URL scheme, so Kaja can hand the server straight
// over: the agent opens, and writes its own configuration once you accept.
function cursorLink({ url, token }: McpEndpoint): string {
  const server = { url, headers: { Authorization: `Bearer ${token}` } };
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=kaja&config=${encodeURIComponent(btoa(JSON.stringify(server)))}`;
}

function vsCodeLink({ url, token }: McpEndpoint): string {
  const server = { name: "kaja", type: "http", url, headers: { Authorization: `Bearer ${token}` } };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(server))}`;
}

function mcpServers(body: string): string {
  return `{\n  "mcpServers": {\n    "kaja": {\n${body}\n    }\n  }\n}`;
}

export const mcpAgents: McpAgent[] = [
  {
    name: "Claude Code",
    kind: "terminal command",
    path: "run in your project directory",
    lead: "Scoped to the project you run it in. Use --scope user to register it for every project.",
    foot: "/mcp inside Claude Code lists it and says whether it connected.",
    snippet: ({ url, token }) => `claude mcp add --transport http kaja \\\n  ${url} \\\n  --header "Authorization: Bearer ${token}"`,
  },
  {
    name: "VS Code / Copilot",
    kind: "one-click install",
    path: "run in a terminal",
    lead: "Opens VS Code's install prompt through its vscode: handler; VS Code writes the server into its own settings. The command below does the same thing without the handler.",
    install: { label: "Add to VS Code", link: vsCodeLink },
    snippet: ({ url, token }) => `code --add-mcp '{"name":"kaja","type":"http",\n  "url":"${url}",\n  "headers":{"Authorization":"Bearer ${token}"}}'`,
  },
  {
    name: "Cursor",
    kind: "one-click install",
    path: "~/.cursor/mcp.json",
    lead: "Opens Cursor through its deeplink handler and prefills the server; Cursor writes mcp.json once you accept. Below is the equivalent hand-edit.",
    configurationKey: "cursor",
    install: { label: "Add to Cursor", link: cursorLink },
    snippet: ({ url, token }) => mcpServers(`      "url": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }`),
  },
  {
    // The connector UI connects from Anthropic's servers, which can't reach localhost,
    // so Desktop goes through the mcp-remote stdio bridge instead. The header is passed
    // via an env var because Claude Desktop splits args on spaces, which would otherwise
    // mangle "Bearer <token>".
    name: "Claude Desktop",
    kind: "config file",
    path: "…/Claude/claude_desktop_config.json",
    lead: "No HTTP transport, so it bridges through mcp-remote over stdio.",
    foot: "Needs Node on PATH. Claude Desktop reads this file only at launch — quit it fully and reopen.",
    configurationKey: "claudeDesktop",
    snippet: ({ url, token }) =>
      JSON.stringify(
        {
          mcpServers: {
            kaja: {
              command: "npx",
              args: ["mcp-remote", url, "--header", "Authorization:${AUTH_HEADER}"],
              env: { AUTH_HEADER: `Bearer ${token}` },
            },
          },
        },
        null,
        2,
      ),
  },
  {
    name: "Windsurf",
    kind: "config file",
    path: "~/.codeium/windsurf/mcp_config.json",
    lead: "The URL field is serverUrl here, not url.",
    foot: "Windsurf rereads the file on Refresh in the Cascade MCP panel.",
    configurationKey: "windsurf",
    snippet: ({ url, token }) => mcpServers(`      "serverUrl": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }`),
  },
  {
    name: "Zed",
    kind: "config file",
    path: "~/.config/zed/settings.json",
    lead: "Zed calls these context servers and has no HTTP transport, so it goes through mcp-remote.",
    foot: "Merge into the existing top-level object; settings.json is one object, not a stream of them.",
    configurationKey: "zed",
    snippet: ({ url, token }) =>
      `"context_servers": {\n  "kaja": {\n    "source": "custom",\n    "command": "npx",\n    "args": ["mcp-remote", "${url}",\n      "--header", "Authorization: Bearer ${token}"]\n  }\n}`,
  },
  {
    name: "Cline",
    kind: "config file",
    path: "…/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    lead: "Cline's settings file lives inside its VS Code extension storage folder, not in your home config.",
    configurationKey: "cline",
    snippet: ({ url, token }) => mcpServers(`      "type": "streamableHttp",\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }`),
  },
  {
    name: "Goose",
    kind: "config file",
    path: "~/.config/goose/config.yaml",
    lead: "YAML. Merge under the existing extensions key rather than adding a second one.",
    foot: "Two spaces per level; tabs are a parse error.",
    configurationKey: "goose",
    snippet: ({ url, token }) =>
      `extensions:\n  kaja:\n    type: streamable_http\n    uri: ${url}\n    headers:\n      Authorization: "Bearer ${token}"\n    enabled: true`,
  },
  {
    name: "OpenAI Codex CLI",
    kind: "config file",
    path: "~/.codex/config.toml",
    lead: "TOML. Append both tables at the end of the file.",
    foot: "The headers table has to come after its parent table.",
    configurationKey: "codex",
    snippet: ({ url, token }) => `[mcp_servers.kaja]\nurl = "${url}"\n\n[mcp_servers.kaja.headers]\nAuthorization = "Bearer ${token}"`,
  },
  {
    name: "Gemini CLI",
    kind: "config file",
    path: "~/.gemini/settings.json",
    lead: "The URL field is httpUrl here, not url.",
    configurationKey: "gemini",
    snippet: ({ url, token }) => mcpServers(`      "httpUrl": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }`),
  },
];

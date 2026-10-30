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
  /** The file the snippet is pasted into; an agent without one is given a command to run. */
  file?: string;
  /** The one thing worth knowing beyond where the snippet goes, where there is one. */
  note?: string;
  /**
   * The key the desktop resolves this agent's configuration file under. An agent
   * whose snippet goes into a file it names has one — a one-click agent included,
   * since the hand-edit under the button goes into that same file; one told to run a
   * command doesn't.
   */
  configurationKey?: string;
  install?: { label: string; link: (endpoint: McpEndpoint) => string };
  /** Whether the agent can run its MCP client inside a dev container. */
  container?: boolean;
  snippet: (endpoint: McpEndpoint) => string;
}

// Cursor and VS Code both register a URL scheme, so Kaja can hand the server straight
// over: the agent opens, and writes its own configuration once you accept.
function cursorLink({ url, token }: McpEndpoint): string {
  const server = { url, headers: { Authorization: `Bearer ${token}` } };
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=kaja&config=${encodeURIComponent(btoa(JSON.stringify(server)))}`;
}

// Goose opens its extension settings prefilled from the link rather than installing it
// outright, because the link carries a header.
function gooseLink({ url, token }: McpEndpoint): string {
  const query = new URLSearchParams({ url, type: "streamable_http", name: "kaja", header: `Authorization=Bearer ${token}` });
  return `goose://extension?${query.toString().replaceAll("+", "%20")}`;
}

function vsCodeLink({ url, token }: McpEndpoint): string {
  const server = { name: "kaja", type: "http", url, headers: { Authorization: `Bearer ${token}` } };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(server))}`;
}

// Inside a container the loopback address is the container's own, and Docker Desktop
// and OrbStack answer host.docker.internal with the host's loopback, which is where the
// listener is. A URL that isn't loopback reaches the container as it is.
export function containerUrl(url: string): string | undefined {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return undefined;
  parsed.hostname = "host.docker.internal";
  return parsed.toString();
}

function mcpServers(body: string): string {
  return `{\n  "mcpServers": {\n    "kaja": {\n${body}\n    }\n  }\n}`;
}

export const mcpAgents: McpAgent[] = [
  {
    name: "Claude Code",
    kind: "terminal command",
    note: "Adds it to this project only. Add --scope user for every project.",
    snippet: ({ url, token }) => `claude mcp add --transport http kaja \\\n  ${url} \\\n  --header "Authorization: Bearer ${token}"`,
  },
  {
    // The connector UI connects from Anthropic's servers, which can't reach localhost,
    // so Desktop goes through the mcp-remote stdio bridge instead. The header is passed
    // via an env var because Claude Desktop splits args on spaces, which would otherwise
    // mangle "Bearer <token>".
    name: "Claude Desktop",
    kind: "config file",
    file: "…/Claude/claude_desktop_config.json",
    note: "Needs Node. Quit and reopen Claude Desktop after saving.",
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
    name: "Cursor",
    kind: "one-click install",
    file: "~/.cursor/mcp.json",
    configurationKey: "cursor",
    install: { label: "Add to Cursor", link: cursorLink },
    container: true,
    snippet: ({ url, token }) => mcpServers(`      "url": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }`),
  },
  {
    name: "VS Code",
    kind: "one-click install",
    install: { label: "Add to VS Code", link: vsCodeLink },
    container: true,
    snippet: ({ url, token }) => `code --add-mcp '{"name":"kaja","type":"http",\n  "url":"${url}",\n  "headers":{"Authorization":"Bearer ${token}"}}'`,
  },
  {
    name: "GitHub Copilot CLI",
    kind: "terminal command",
    snippet: ({ url, token }) => `copilot mcp add --transport http kaja \\\n  ${url} \\\n  --header "Authorization: Bearer ${token}"`,
  },
  {
    name: "OpenAI Codex CLI",
    kind: "config file",
    file: "~/.codex/config.toml",
    configurationKey: "codex",
    snippet: ({ url, token }) => `[mcp_servers.kaja]\nurl = "${url}"\n\n[mcp_servers.kaja.headers]\nAuthorization = "Bearer ${token}"`,
  },
  {
    name: "Windsurf",
    kind: "config file",
    file: "~/.codeium/windsurf/mcp_config.json",
    note: "Then press Refresh in the Cascade MCP panel.",
    configurationKey: "windsurf",
    snippet: ({ url, token }) => mcpServers(`      "serverUrl": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }`),
  },
  {
    name: "Zed",
    kind: "config file",
    file: "~/.config/zed/settings.json",
    note: "Add it inside the top-level object.",
    configurationKey: "zed",
    snippet: ({ url, token }) => `"context_servers": {\n  "kaja": {\n    "url": "${url}",\n    "headers": { "Authorization": "Bearer ${token}" }\n  }\n}`,
  },
  {
    name: "Cline",
    kind: "config file",
    file: "…/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    configurationKey: "cline",
    snippet: ({ url, token }) => mcpServers(`      "type": "streamableHttp",\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }`),
  },
  {
    name: "Goose",
    kind: "one-click install",
    file: "~/.config/goose/config.yaml",
    note: "Add it under the existing extensions key.",
    configurationKey: "goose",
    install: { label: "Add to Goose", link: gooseLink },
    snippet: ({ url, token }) =>
      `extensions:\n  kaja:\n    type: streamable_http\n    uri: ${url}\n    headers:\n      Authorization: "Bearer ${token}"\n    enabled: true`,
  },
  {
    name: "Gemini CLI",
    kind: "terminal command",
    note: "Leave out --scope user to add it to this project only.",
    snippet: ({ url, token }) => `gemini mcp add --scope user --transport http \\\n  --header "Authorization: Bearer ${token}" \\\n  kaja ${url}`,
  },
];

// The clients an agent can be connected through, and the snippet each one takes. A
// client is a name, where its snippet goes, and the text of it — nothing here knows
// what the popover looks like.

/** The endpoint a snippet is written against. */
export interface McpEndpoint {
  url: string;
  token: string;
}

// What connecting costs, which is what the pane's shape varies on: a one-click install
// adds a button, a config file adds Reveal, a terminal command adds neither.
export type McpClientKind = "one-click install" | "config file" | "terminal command";

export interface McpClient {
  name: string;
  kind: McpClientKind;
  /** Where the snippet goes, in the client's own words. */
  path: string;
  lead: string;
  /**
   * The key the desktop resolves this client's configuration file under. A client
   * whose snippet goes into a file it names has one; one told to run a command
   * doesn't, and neither does one that writes its own configuration.
   */
  configurationKey?: string;
  install?: { label: string; link: (endpoint: McpEndpoint) => string };
  snippet: (endpoint: McpEndpoint) => string;
}

// Cursor and VS Code both register a URL scheme, so Kaja can hand the server straight
// over: the client opens, and writes its own configuration once you accept.
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

export const mcpClients: McpClient[] = [
  {
    name: "Claude Code",
    kind: "terminal command",
    path: "run in your project directory",
    lead: "One command, no file to edit. Registers the server for the current project.",
    snippet: ({ url, token }) => `claude mcp add --transport http kaja \\\n  ${url} \\\n  --header "Authorization: Bearer ${token}"`,
  },
  {
    name: "VS Code / Copilot",
    kind: "one-click install",
    path: "or run it in a terminal",
    lead: "Opens VS Code's install prompt through its vscode: handler; VS Code stores the server itself.",
    install: { label: "Add to VS Code", link: vsCodeLink },
    snippet: ({ url, token }) => `code --add-mcp '{"name":"kaja","type":"http",\n  "url":"${url}",\n  "headers":{"Authorization":"Bearer ${token}"}}'`,
  },
  {
    name: "Cursor",
    kind: "one-click install",
    path: "or merge into ~/.cursor/mcp.json",
    lead: "Opens Cursor through its deeplink handler and prefills the server; Cursor writes its own configuration once you accept.",
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
    lead: "No remote transport yet, so this bridges through mcp-remote.",
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
    lead: "Windsurf calls the field serverUrl rather than url.",
    configurationKey: "windsurf",
    snippet: ({ url, token }) => mcpServers(`      "serverUrl": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }`),
  },
  {
    name: "Zed",
    kind: "config file",
    path: "~/.config/zed/settings.json",
    lead: "Zed calls these context servers and has no HTTP transport, so it goes through mcp-remote.",
    configurationKey: "zed",
    snippet: ({ url, token }) =>
      `"context_servers": {\n  "kaja": {\n    "source": "custom",\n    "command": "npx",\n    "args": ["mcp-remote", "${url}",\n      "--header", "Authorization: Bearer ${token}"]\n  }\n}`,
  },
  {
    name: "Cline",
    kind: "config file",
    path: "…/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    lead: "Cline's settings file lives inside its VS Code extension folder.",
    configurationKey: "cline",
    snippet: ({ url, token }) => mcpServers(`      "type": "streamableHttp",\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }`),
  },
  {
    name: "Goose",
    kind: "config file",
    path: "~/.config/goose/config.yaml",
    lead: "Goose reads YAML. Add this under the existing extensions key.",
    configurationKey: "goose",
    snippet: ({ url, token }) =>
      `extensions:\n  kaja:\n    type: streamable_http\n    uri: ${url}\n    headers:\n      Authorization: "Bearer ${token}"\n    enabled: true`,
  },
  {
    name: "OpenAI Codex CLI",
    kind: "config file",
    path: "~/.codex/config.toml",
    lead: "Codex reads TOML. Append both tables to the end of the file.",
    configurationKey: "codex",
    snippet: ({ url, token }) => `[mcp_servers.kaja]\nurl = "${url}"\n\n[mcp_servers.kaja.headers]\nAuthorization = "Bearer ${token}"`,
  },
  {
    name: "Gemini CLI",
    kind: "config file",
    path: "~/.gemini/settings.json",
    lead: "Gemini CLI calls the field httpUrl rather than url.",
    configurationKey: "gemini",
    snippet: ({ url, token }) => mcpServers(`      "httpUrl": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }`),
  },
];

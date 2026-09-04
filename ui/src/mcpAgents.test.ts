import { describe, expect, test } from "bun:test";
import { mcpAgents, type McpAgent } from "./mcpAgents";

const endpoint = { url: "http://127.0.0.1:41521/mcp", token: "170e16de0d09011feb6b7fddfff0813a7007000f8f31935d" };

const agent = (name: string): McpAgent => {
  const found = mcpAgents.find((a) => a.name === name);
  if (!found) throw new Error(`no agent named ${name}`);
  return found;
};

describe("mcpAgents", () => {
  test("every snippet carries the endpoint and the token", () => {
    for (const a of mcpAgents) {
      const snippet = a.snippet(endpoint);
      expect(snippet).toContain(endpoint.url);
      expect(snippet).toContain(endpoint.token);
    }
  });

  test("only a one-click agent installs, and only a filed one reveals", () => {
    for (const a of mcpAgents) {
      expect(!!a.install).toBe(a.kind === "one-click install");
      if (a.kind === "config file") expect(a.configurationKey).toBeDefined();
    }
  });

  test("the JSON snippets parse", () => {
    for (const name of ["Cursor", "Claude Desktop", "Windsurf", "Cline", "Gemini CLI"]) {
      expect(() => JSON.parse(agent(name).snippet(endpoint))).not.toThrow();
    }
  });

  test("Cursor's deeplink carries the server it prefills", () => {
    const link = agent("Cursor").install!.link(endpoint);
    const config = new URL(link).searchParams.get("config");
    expect(JSON.parse(atob(config!))).toEqual({ url: endpoint.url, headers: { Authorization: `Bearer ${endpoint.token}` } });
  });

  test("VS Code's deeplink carries the same, as its own handler wants it", () => {
    const link = agent("VS Code").install!.link(endpoint);
    expect(JSON.parse(decodeURIComponent(link.slice("vscode:mcp/install?".length)))).toEqual({
      name: "kaja",
      type: "http",
      url: endpoint.url,
      headers: { Authorization: `Bearer ${endpoint.token}` },
    });
  });
});

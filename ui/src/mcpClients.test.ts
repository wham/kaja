import { describe, expect, test } from "bun:test";
import { elideToken, mcpClients, type McpClient } from "./mcpClients";

const endpoint = { url: "http://127.0.0.1:41521/mcp", token: "170e16de0d09011feb6b7fddfff0813a7007000f8f31935d" };

const client = (name: string): McpClient => {
  const found = mcpClients.find((c) => c.name === name);
  if (!found) throw new Error(`no client named ${name}`);
  return found;
};

describe("elideToken", () => {
  test("keeps the last four digits", () => {
    expect(elideToken(endpoint.token)).toBe("····935d");
  });

  test("says nothing about a token that isn't there yet", () => {
    expect(elideToken("")).toBe("····");
  });
});

describe("mcpClients", () => {
  test("every snippet carries the endpoint and the token", () => {
    for (const c of mcpClients) {
      const snippet = c.snippet(endpoint);
      expect(snippet).toContain(endpoint.url);
      expect(snippet).toContain(endpoint.token);
    }
  });

  test("a snippet written against the elided token holds no secret", () => {
    for (const c of mcpClients) {
      expect(c.snippet({ url: endpoint.url, token: elideToken(endpoint.token) })).not.toContain(endpoint.token);
    }
  });

  test("only a one-click client installs, and only a filed one reveals", () => {
    for (const c of mcpClients) {
      expect(!!c.install).toBe(c.kind === "one-click install");
      if (c.kind === "config file") expect(c.configurationKey).toBeDefined();
    }
  });

  test("the JSON snippets parse", () => {
    for (const name of ["Cursor", "Claude Desktop", "Windsurf", "Cline", "Gemini CLI"]) {
      expect(() => JSON.parse(client(name).snippet(endpoint))).not.toThrow();
    }
  });

  test("Cursor's deeplink carries the server it prefills", () => {
    const link = client("Cursor").install!.link(endpoint);
    const config = new URL(link).searchParams.get("config");
    expect(JSON.parse(atob(config!))).toEqual({ url: endpoint.url, headers: { Authorization: `Bearer ${endpoint.token}` } });
  });

  test("VS Code's deeplink carries the same, as its own handler wants it", () => {
    const link = client("VS Code / Copilot").install!.link(endpoint);
    expect(JSON.parse(decodeURIComponent(link.slice("vscode:mcp/install?".length)))).toEqual({
      name: "kaja",
      type: "http",
      url: endpoint.url,
      headers: { Authorization: `Bearer ${endpoint.token}` },
    });
  });
});

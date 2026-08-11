import { describe, expect, test } from "bun:test";
import { AUTH_APIKEY, AUTH_BEARER, AUTH_NONE, authNote, count, deriveAppName, eraLabel, isReadableEndpoint, uniqueAppName } from "./mcpServer";

describe("isReadableEndpoint", () => {
  test("takes an absolute HTTP endpoint", () => {
    expect(isReadableEndpoint("https://mcp.example.com/mcp")).toBe(true);
    expect(isReadableEndpoint("http://localhost:3000/mcp")).toBe(true);
  });

  test("refuses anything that isn't one", () => {
    expect(isReadableEndpoint("")).toBe(false);
    expect(isReadableEndpoint("mcp.example.com/mcp")).toBe(false);
    expect(isReadableEndpoint("file:///tmp/server")).toBe(false);
  });

  test("takes a value that reads a variable on trust", () => {
    // The browser is never handed what a variable expands to, so the server is
    // the one that finds out whether it is a URL.
    expect(isReadableEndpoint("${MCP_URL}")).toBe(true);
    expect(isReadableEndpoint("https://${HOST}/mcp")).toBe(true);
  });
});

describe("deriveAppName", () => {
  test("keeps a server name that is already a handle", () => {
    expect(deriveAppName("https://mcp.deepwiki.com/mcp", "deepwiki")).toBe("deepwiki");
  });

  test("drops the words that say it is an MCP server", () => {
    expect(deriveAppName("https://api.githubcopilot.com/mcp/", "GitHub MCP Server")).toBe("GitHub");
    expect(deriveAppName("https://example.com/mcp", "Sentry MCP")).toBe("Sentry");
    expect(deriveAppName("https://example.com/mcp", "linear-mcp-server")).toBe("linear");
  });

  test("drops the namespace a registry identifier carries", () => {
    expect(deriveAppName("https://example.com/mcp", "io.github.owner/notion")).toBe("notion");
  });

  test("keeps the words when they are all it has", () => {
    expect(deriveAppName("https://mcp.example.com/mcp", "MCP Server")).toBe("MCPServer");
  });

  test("falls back to the host when the server names itself nothing", () => {
    expect(deriveAppName("https://mcp.deepwiki.com/mcp", "")).toBe("deepwiki");
    expect(deriveAppName("https://api.example.com/mcp", "")).toBe("example");
    expect(deriveAppName("https://grpcb.in/mcp", "")).toBe("grpcb.in");
  });

  test("trims what an import path can't start or end on", () => {
    expect(deriveAppName("https://example.com/mcp", "--weather--")).toBe("weather");
    expect(deriveAppName("https://example.com/mcp", "...")).toBe("example.com");
  });

  test("takes only the front of a name a server padded out", () => {
    expect(deriveAppName("https://example.com/mcp", "a".repeat(5000))).toBe("a".repeat(200));
  });

  test("says nothing when the host names the machine", () => {
    expect(deriveAppName("http://localhost:3000/mcp", "")).toBe("");
    expect(deriveAppName("http://127.0.0.1:3000/mcp", "")).toBe("");
  });
});

describe("uniqueAppName", () => {
  test("numbers a name that is taken", () => {
    expect(uniqueAppName("GitHub", [])).toBe("GitHub");
    expect(uniqueAppName("GitHub", ["GitHub"])).toBe("GitHub2");
    expect(uniqueAppName("GitHub", ["GitHub", "GitHub2"])).toBe("GitHub3");
  });
});

describe("authNote", () => {
  test("states the header the credential becomes", () => {
    expect(authNote(AUTH_BEARER, "")).toEqual({ text: "Authorization: Bearer ‹token›", mono: true });
    expect(authNote(AUTH_APIKEY, "")).toEqual({ text: "X-API-Key: ‹key›", mono: true });
    expect(authNote(AUTH_APIKEY, "X-Tenant-Key")).toEqual({ text: "X-Tenant-Key: ‹key›", mono: true });
    expect(authNote(AUTH_NONE, "")).toEqual({ text: "", mono: false });
  });
});

describe("eraLabel", () => {
  test("tells the two shapes of the protocol apart", () => {
    expect(eraLabel("2026-07-28", false)).toBe("MCP 2026-07-28");
    expect(eraLabel("2025-06-18", true)).toBe("MCP 2025-06-18 · handshake");
  });
});

describe("count", () => {
  test("pluralizes", () => {
    expect(count(1, "tool")).toBe("1 tool");
    expect(count(0, "tool")).toBe("0 tools");
  });
});

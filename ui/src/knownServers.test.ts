import { describe, expect, it } from "bun:test";
import { canonicalEndpoint, endpointLabel, knownServerFor, knownServers, matchingServers } from "./knownServers";

describe("knownServerFor", () => {
  it("matches the endpoint as it is bundled", () => {
    expect(knownServerFor("https://api.githubcopilot.com/mcp/")?.name).toBe("GitHub");
    expect(knownServerFor("https://mcp.sentry.dev/mcp")?.name).toBe("Sentry");
    expect(knownServerFor("https://mcp.atlassian.com/v1/mcp")?.name).toBe("Atlassian");
  });

  it("matches the same address written differently", () => {
    expect(knownServerFor("  HTTPS://API.githubcopilot.com/mcp  ")?.name).toBe("GitHub");
    expect(knownServerFor("https://api.githubcopilot.com:443/mcp/#top")?.name).toBe("GitHub");
  });

  it("says nothing about another path on the same host", () => {
    expect(knownServerFor("https://api.githubcopilot.com/mcp/x")).toBeUndefined();
  });

  it("says nothing about a name, only an address", () => {
    expect(knownServerFor("GitHub")).toBeUndefined();
  });

  it("says nothing about a variable or a localhost endpoint", () => {
    expect(knownServerFor("${GITHUB_MCP}")).toBeUndefined();
    expect(knownServerFor("https://${HOST}/mcp")).toBeUndefined();
    expect(knownServerFor("http://localhost:3000/mcp")).toBeUndefined();
  });
});

describe("canonicalEndpoint", () => {
  it("refuses what isn't an http address", () => {
    expect(canonicalEndpoint("")).toBe("");
    expect(canonicalEndpoint("api.example.com/mcp")).toBe("");
    expect(canonicalEndpoint("ftp://example.com/mcp")).toBe("");
  });

  it("keeps a query, which is part of the address", () => {
    expect(canonicalEndpoint("https://example.com/mcp/?v=2")).toBe("https://example.com/mcp?v=2");
  });
});

describe("matchingServers", () => {
  it("offers every server until something is typed", () => {
    expect(matchingServers("  ")).toEqual(knownServers);
  });

  it("matches a name or an address", () => {
    expect(matchingServers("git").map((server) => server.name)).toEqual(["GitHub"]);
    expect(matchingServers("githubcopilot.com").map((server) => server.name)).toEqual(["GitHub"]);
    expect(matchingServers("sentry.dev").map((server) => server.name)).toEqual(["Sentry"]);
    expect(matchingServers("atlas").map((server) => server.name)).toEqual(["Atlassian"]);
    expect(matchingServers("linear")).toEqual([]);
  });
});

describe("endpointLabel", () => {
  it("drops the scheme and nothing else", () => {
    expect(endpointLabel("https://api.githubcopilot.com/mcp/")).toBe("api.githubcopilot.com/mcp/");
  });
});

import { describe, expect, test } from "bun:test";
import { withEndpoint } from "./McpForm";

describe("withEndpoint", () => {
  const signedIn = { url: "https://mcp.sentry.dev/mcp", auth: "oauth", clientId: "abc", scope: "org:read", token: "t", apiKeyName: "X-Key", headers: "" };

  test("another host drops the credential with the server it was for", () => {
    expect(withEndpoint(signedIn, "https://mcp.context7.com/mcp")).toEqual({ url: "https://mcp.context7.com/mcp", headers: "" });
  });

  test("a path corrected on the same host keeps it", () => {
    expect(withEndpoint(signedIn, "https://mcp.sentry.dev/mcp/")).toEqual({ ...signedIn, url: "https://mcp.sentry.dev/mcp/" });
    expect(withEndpoint(signedIn, "https://MCP.sentry.dev/v2")).toEqual({ ...signedIn, url: "https://MCP.sentry.dev/v2" });
  });

  test("clearing the field, or replacing it with a variable, drops it too", () => {
    expect(withEndpoint(signedIn, "")).toEqual({ url: "", headers: "" });
    expect(withEndpoint(signedIn, "${MCP_URL}")).toEqual({ url: "${MCP_URL}", headers: "" });
  });

  test("nothing settles while no host has been typed", () => {
    expect(withEndpoint({ url: "${MCP_URL}", auth: "bearer", token: "t" }, "${OTHER}")).toEqual({ url: "${OTHER}", auth: "bearer", token: "t" });
    expect(withEndpoint({ auth: "bearer", token: "t" }, "https://")).toEqual({ url: "https://", auth: "bearer", token: "t" });
  });
});

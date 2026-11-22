import { describe, expect, it } from "bun:test";
import { APP_HEADER, appAddress, appTypes, isAppHeader, mergeHeaders, transportHeaders } from "./appTypes";
import { WorkspaceApp } from "./server/api";

const app = { name: "github" } as WorkspaceApp;

describe("mergeHeaders", () => {
  it("keeps the app's headers when a call adds to them", () => {
    expect(mergeHeaders({ "X-Tenant": "acme" }, { "Idempotency-Key": "1" })).toEqual({
      "X-Tenant": "acme",
      "Idempotency-Key": "1",
    });
  });

  it("replaces a header the call writes, whatever case either wrote it in", () => {
    expect(mergeHeaders({ Authorization: "Bearer ${TOKEN}" }, { authorization: "Bearer other" })).toEqual({
      authorization: "Bearer other",
    });
  });

  it("copies the app's headers when a call says nothing", () => {
    const configured = { "X-Tenant": "acme" };
    const merged = mergeHeaders(configured);
    merged["X-Tenant"] = "other";
    expect(configured["X-Tenant"]).toBe("acme");
  });
});

describe("transportHeaders", () => {
  it("names the app the call belongs to alongside what it sends", () => {
    expect(transportHeaders(app, { "X-Tenant": "acme" })).toEqual({
      "X-Tenant": "acme",
      [APP_HEADER]: "github",
    });
  });
});

describe("isAppHeader", () => {
  it("recognises the reserved name however a transport cased it", () => {
    expect(isAppHeader("x-kaja-app")).toBe(true);
    expect(isAppHeader("X-Kaja-App")).toBe(true);
    expect(isAppHeader("X-Kaja-Application")).toBe(false);
  });
});

describe("appTypes", () => {
  // In the tree and the finder the mark is the only thing saying what kind of app a
  // method belongs to, so two types sharing one says nothing at all — which is what
  // Server / Globe / Plug / Blocks were doing across four protocols.
  it("gives every type a mark of its own", () => {
    const marks = appTypes.map((type) => type.icon);
    expect(new Set(marks).size).toBe(appTypes.length);
  });
});

describe("appAddress", () => {
  const app = (variant: WorkspaceApp["app"]) => WorkspaceApp.create({ name: "a", app: variant });

  it("drops the scheme and a trailing slash", () => {
    expect(appAddress(app({ oneofKind: "mcp", mcp: { url: "https://example.com/mcp/" } as never }))).toBe("example.com/mcp");
    expect(appAddress(app({ oneofKind: "grpc", grpc: { url: "dns:example.com:443" } as never }))).toBe("example.com:443");
  });

  it("prefers the server an OpenAPI app calls over its document", () => {
    const openapi = { specUrl: "https://example.com/openapi.json", baseUrl: "https://api.example.com" };
    expect(appAddress(app({ oneofKind: "openapi", openapi: openapi as never }))).toBe("api.example.com");
    expect(appAddress(app({ oneofKind: "openapi", openapi: { specUrl: openapi.specUrl } as never }))).toBe("example.com/openapi.json");
  });

  it("is empty where an app points nowhere", () => {
    expect(appAddress(app({ oneofKind: "openapi", openapi: { specContent: "{}" } as never }))).toBe("");
  });
});

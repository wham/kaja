import { describe, expect, it } from "bun:test";
import { APP_HEADER, isAppHeader, mergeHeaders, transportHeaders } from "./appTypes";
import { ConfigurationApp } from "./server/api";

const app = { name: "theatre" } as ConfigurationApp;

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
      [APP_HEADER]: "theatre",
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

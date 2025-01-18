import { expect, test, vi } from "vitest";
import { getBaseUrlForApi, getBaseUrlForTarget } from "./connection";

test("getBaseUrlForApi", () => {
  vi.stubGlobal("window", {
    location: {
      href: "http://example.com/path/",
    },
  });
  const baseUrl = getBaseUrlForApi();

  expect(baseUrl).toBe("http://example.com/path/twirp");

  vi.unstubAllGlobals();
});

test("getBaseUrlForTarget", () => {
  vi.stubGlobal("window", {
    location: {
      href: "http://example.com/path/",
    },
  });
  const baseUrl = getBaseUrlForTarget();
  expect(baseUrl).toBe("http://example.com/path/target");

  vi.unstubAllGlobals();
});

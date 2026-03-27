import { afterEach, expect, test } from "bun:test";
import { getBaseUrlForAi, getBaseUrlForApi, getBaseUrlForTarget } from "./connection";

const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

test("getBaseUrlForApi", () => {
  globalThis.window = {
    location: {
      href: "http://example.com/path/",
    },
  } as any;
  const baseUrl = getBaseUrlForApi();

  expect(baseUrl).toBe("http://example.com/path/twirp");
});

test("getBaseUrlForTarget", () => {
  globalThis.window = {
    location: {
      href: "http://example.com/path/",
    },
  } as any;
  const baseUrl = getBaseUrlForTarget();
  expect(baseUrl).toBe("http://example.com/path/target");
});

test("getBaseUrlForAi", () => {
  globalThis.window = {
    location: {
      href: "http://example.com/path/",
    },
  } as any;

  const baseUrl = getBaseUrlForAi();
  expect(baseUrl).toBe("http://example.com/path/ai");
});

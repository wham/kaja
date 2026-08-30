import { afterEach, expect, test } from "bun:test";
import { getBaseUrlForApi, getBaseUrlForTarget } from "./connection";

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

  expect(baseUrl).toBe("http://example.com/path");
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

// A deeplink is `/#run/<script>?…`, so the page's own URL routinely carries a
// fragment now. It says where the page points, not where it is served from.
test("ignores a fragment and a query the page happens to carry", () => {
  globalThis.window = {
    location: {
      href: "http://example.com/path/?theme=dark#run/nightly?tag=q3",
    },
  } as any;

  expect(getBaseUrlForApi()).toBe("http://example.com/path");
  expect(getBaseUrlForTarget()).toBe("http://example.com/path/target");
});

import { afterEach, expect, test } from "bun:test";
import { getBaseUrlForApi, getBaseUrlForApp } from "./connection";

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

test("getBaseUrlForApp", () => {
  globalThis.window = {
    location: {
      href: "http://example.com/path/",
    },
  } as any;
  const baseUrl = getBaseUrlForApp();
  expect(baseUrl).toBe("http://example.com/path/app");
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
  expect(getBaseUrlForApp()).toBe("http://example.com/path/app");
});

// The desktop is a page like any other now: the webview is served from its own
// scheme and fetches the mux mounted behind it.
test("reads the desktop's own origin", () => {
  globalThis.window = {
    location: {
      href: "wails://localhost/",
    },
  } as any;

  expect(getBaseUrlForApi()).toBe("wails://localhost");
  expect(getBaseUrlForApp()).toBe("wails://localhost/app");
});

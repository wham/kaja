import { expect, test, vi } from "vitest";
import { getBaseUrl } from "./connection";

test("getBaseUrl", () => {
  vi.stubGlobal("window", {
    location: {
      href: "http://example.com/path/",
    },
  });
  const baseUrl = getBaseUrl();

  expect(baseUrl).toBe("http://example.com/path/twirp");

  vi.unstubAllGlobals();
});

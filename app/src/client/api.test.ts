import { expect, test, vi } from "vitest";
import { getBaseUrl } from "./api";

test("getBaseUrl", () => {
  vi.stubGlobal("window", {
    location: {
      href: "http://example.com/path",
    },
  });
  const baseUrl = getBaseUrl();

  expect(baseUrl).toBe("http://example.com/api");

  vi.unstubAllGlobals();
});
import { afterEach, describe, expect, it } from "bun:test";
import { uuidV4 } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const real = globalThis.crypto;
afterEach(() => {
  globalThis.crypto = real;
});

// What a non-secure context has: the desktop's webview and a kaja served over plain
// http both get a Crypto with no randomUUID on it.
function withoutRandomUUID(): void {
  globalThis.crypto = { getRandomValues: (array: Uint8Array) => real.getRandomValues(array) } as Crypto;
}

describe("uuidV4", () => {
  it("is a v4 UUID", () => {
    expect(uuidV4()).toMatch(V4);
    expect(uuidV4()).not.toBe(uuidV4());
  });

  it("is one where the context has no crypto.randomUUID", () => {
    withoutRandomUUID();
    expect(crypto.randomUUID).toBeUndefined();
    expect(uuidV4()).toMatch(V4);
    expect(uuidV4()).not.toBe(uuidV4());
  });
});

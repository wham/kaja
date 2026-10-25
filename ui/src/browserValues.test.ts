import { beforeEach, describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
(globalThis as any).window = {
  location: { href: "http://localhost/" },
  addEventListener: () => {},
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
};

const { absorbValues, setValuesWorkspace, storedValues, valuesHeader } = await import("./browserValues");

function header(): unknown {
  const binary = atob(valuesHeader() ?? "");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
}

function trailer(written: unknown): string {
  return encodeURIComponent(JSON.stringify(written));
}

describe("browserValues", () => {
  beforeEach(() => {
    storage.clear();
    setValuesWorkspace("");
  });

  test("a call carries the values kept for the open workspace", () => {
    setValuesWorkspace("w1");
    absorbValues(trailer({ workspace: "w1", values: { TOKEN: "ünïcode" } }));
    expect(header()).toEqual({ workspace: "w1", values: { TOKEN: "ünïcode" } });
  });

  test("a workspace with no id carries nothing, and takes the id the first write gives it", () => {
    expect(header()).toEqual({});
    absorbValues(trailer({ workspace: "new", values: { TOKEN: "typed" } }));
    expect(storedValues()).toEqual({ TOKEN: "typed" });
  });

  test("a null value is a delete", () => {
    setValuesWorkspace("w1");
    absorbValues(trailer({ workspace: "w1", values: { A: "1", B: "2" } }));
    absorbValues(trailer({ workspace: "w1", values: { A: null } }));
    expect(storedValues()).toEqual({ B: "2" });
  });

  test("values kept for one workspace are not another's", () => {
    setValuesWorkspace("w1");
    absorbValues(trailer({ workspace: "w1", values: { TOKEN: "one" } }));
    setValuesWorkspace("w2");
    expect(storedValues()).toEqual({});
  });

  test("a trailer that can't be read is ignored", () => {
    setValuesWorkspace("w1");
    absorbValues("%E0%A4%A");
    absorbValues(undefined);
    expect(storedValues()).toEqual({});
  });
});

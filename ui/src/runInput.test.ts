import { describe, expect, it } from "bun:test";
import { rememberIn, repeatInput, runInputLabel, RunInputArchive } from "./runInput";

const NOW = 1_700_000_000_000;

describe("rememberIn", () => {
  it("keeps the newest values for a file", () => {
    const once = rememberIn({}, "a.ts", { url: "one" }, NOW);
    expect(rememberIn(once, "a.ts", { url: "two" }, NOW + 1)["a.ts"].input).toEqual({ url: "two" });
  });

  it("lets the least recently run files go rather than growing without end", () => {
    let archive: RunInputArchive = {};
    for (let index = 0; index < 60; index++) archive = rememberIn(archive, `file-${index}.ts`, { url: `${index}` }, NOW + index);
    expect(Object.keys(archive)).toHaveLength(50);
    expect(archive["file-59.ts"]).toBeDefined();
    expect(archive["file-9.ts"]).toBeUndefined();
  });
});

describe("repeatInput", () => {
  it("carries the last run's values for the parameters the script reads", () => {
    expect(repeatInput({ id: "42", month: "2026-01" }, ["id", "month"])).toEqual({ id: "42", month: "2026-01" });
  });

  it("drops a key the script has stopped reading", () => {
    expect(repeatInput({ id: "42", month: "2026-01" }, ["id"])).toEqual({ id: "42" });
  });

  it("carries a blank value, which is not the same as no key", () => {
    expect(repeatInput({ id: "" }, ["id"])).toEqual({ id: "" });
  });

  it("carries nothing where there is nothing held for what the script reads", () => {
    expect(repeatInput({ id: "42" }, ["month"])).toBeUndefined();
    expect(repeatInput(undefined, ["id"])).toBeUndefined();
    expect(repeatInput({ id: "42" }, [])).toBeUndefined();
  });
});

describe("runInputLabel", () => {
  it("states every pair the run carried", () => {
    expect(runInputLabel({ id: "42", month: "2026-01" })).toBe("id=42 · month=2026-01");
  });

  it("states a blank value rather than hiding the key", () => {
    expect(runInputLabel({ id: "" })).toBe("id=");
  });

  it("says nothing about a run that carried nothing", () => {
    expect(runInputLabel(undefined)).toBeUndefined();
    expect(runInputLabel({})).toBeUndefined();
  });
});

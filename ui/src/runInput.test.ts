import { describe, expect, it } from "bun:test";
import { rememberIn, RunInputArchive } from "./runInput";

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

import { describe, expect, test } from "bun:test";
import { runRefusal } from "./runRefusal";

describe("runRefusal", () => {
  test("lets code that parses run", () => {
    expect(runRefusal('import { A } from "a";\nconst x: number = await A.Get({});')).toBeUndefined();
  });

  test("names where the code stops parsing", () => {
    const refused = runRefusal("const a = 1;\nfor (le)");
    expect(refused?.offset).toBe(20);
    expect(refused?.message).not.toMatch(/\(\d+:\d+\)/);
  });

  test("refuses a top-level return, which a script hasn't got", () => {
    expect(runRefusal("const a = 1;\nreturn a;")?.offset).toBe(13);
    expect(runRefusal("function f() { return 1; }")).toBeUndefined();
  });

  test("leaves a type error to the run", () => {
    expect(runRefusal('const a: number = "x";')).toBeUndefined();
  });
});

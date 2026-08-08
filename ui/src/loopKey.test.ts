import { describe, expect, it } from "bun:test";
import { loopKey } from "./loopKey";

describe("loopKey", () => {
  it("reads the value that identifies what the call was about", () => {
    expect(loopKey({ id: "in_0001" })).toBe("in_0001");
  });

  it("prefers an explicit id over a name", () => {
    expect(loopKey({ name: "Northwind Ltd", accountId: "ac_8813" })).toBe("ac_8813");
  });

  it("finds the subject through one envelope", () => {
    expect(loopKey({ invoice: { number: 7, id: "in_0002" } })).toBe("in_0002");
  });

  it("takes a number as readily as a string", () => {
    expect(loopKey({ id: 41 })).toBe("41");
  });

  it("has nothing to say about a request that identifies nothing", () => {
    expect(loopKey({ limit: 50, includeArchived: true })).toBeUndefined();
  });

  // A generated request holds zero values, so a call nobody filled in must not
  // come out labelled with the emptiness of its own template.
  it("ignores the zero values a generated request starts with", () => {
    expect(loopKey({ id: "" })).toBeUndefined();
    expect(loopKey({ id: 0 })).toBeUndefined();
    expect(loopKey({ id: "0" })).toBeUndefined();
  });

  it("truncates a key too long to sit in a row", () => {
    expect(loopKey({ id: "a".repeat(40) })).toBe(`${"a".repeat(21)}…`);
  });

  it("has nothing to read off a request that is not an object", () => {
    expect(loopKey(undefined)).toBeUndefined();
    expect(loopKey("in_0001")).toBeUndefined();
    expect(loopKey([{ id: "in_0001" }])).toBeUndefined();
  });
});

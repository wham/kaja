import { describe, expect, it } from "bun:test";
import { fields, MAX_FIELDS, nodeAt, objectLabel, pageList, readValue } from "./payloadRows";

describe("fields", () => {
  it("keeps the order the payload holds and skips what it left unset", () => {
    expect(fields({ b: 1, a: "x", c: undefined }).map((field) => field.key)).toEqual(["b", "a"]);
  });

  it("keys a list by position", () => {
    expect(fields(["x", "y"]).map((field) => field.key)).toEqual([0, 1]);
  });

  it("stops at the cap", () => {
    expect(fields(Array.from({ length: MAX_FIELDS + 5 }, (_, index) => index))).toHaveLength(MAX_FIELDS);
  });

  it("has nothing to list in a value", () => {
    expect(fields("text")).toEqual([]);
    expect(fields(new Uint8Array(3))).toEqual([]);
  });
});

describe("readValue", () => {
  it("tells the kinds of text apart", () => {
    expect(readValue("")).toEqual({ kind: "empty" });
    expect(readValue("react").kind).toBe("text");
    expect(readValue("https://react.dev").kind).toBe("url");
    expect(readValue("2024-03-01T12:00:00Z").kind).toBe("instant");
    expect(readValue("2024-03-01").kind).toBe("text");
  });

  it("prints a number as the API sent it", () => {
    expect(readValue(10270250)).toEqual({ kind: "number", text: "10270250" });
    expect(readValue(BigInt("9007199254740993"))).toEqual({ kind: "number", text: "9007199254740993" });
  });

  it("states null and bytes rather than printing them", () => {
    expect(readValue(null)).toEqual({ kind: "null" });
    expect(readValue(new Uint8Array(4))).toEqual({ kind: "bytes", length: 4 });
  });

  it("names an object by its most name-like field", () => {
    expect(readValue({ id: 7, login: "facebook", type: "Organization" })).toEqual({ kind: "object", label: "facebook", count: 3 });
  });

  it("names a list of values by its head and a list of records by nothing", () => {
    expect(readValue(["a", "b"])).toEqual({ kind: "array", label: "a, b", count: 2 });
    expect(readValue(["a", "b", "c", "d", "e"])).toEqual({ kind: "array", label: "a, b, c, d, …", count: 5 });
    expect(readValue([{ name: "x" }])).toEqual({ kind: "array", label: undefined, count: 1 });
  });
});

describe("objectLabel", () => {
  it("prefers a name over an id and passes over what is empty or long", () => {
    expect(objectLabel({ id: 1, name: "" })).toBe("1");
    expect(objectLabel({ title: "x".repeat(81), key: "mit" })).toBe("mit");
    expect(objectLabel({ type: "x" })).toBeUndefined();
  });
});

describe("nodeAt", () => {
  const payload = { owner: { login: "facebook" }, topics: ["react"] };

  it("follows a path", () => {
    expect(nodeAt(payload, ["owner", "login"])).toBe("facebook");
    expect(nodeAt(payload, ["topics", 0])).toBe("react");
    expect(nodeAt(payload, [])).toBe(payload);
  });

  it("answers nothing once the payload no longer has the path", () => {
    expect(nodeAt(payload, ["owner", "login", "x"])).toBeUndefined();
    expect(nodeAt(payload, ["license", "key"])).toBeUndefined();
  });
});

describe("pageList", () => {
  it("finds the one list beside plain values", () => {
    expect(pageList({ items: [{ id: 1 }], nextToken: "abc", total: 3 })).toBe("items");
    expect(pageList({ items: [1] })).toBe("items");
  });

  it("is not a page where it could be a guess", () => {
    expect(pageList({ items: [1], users: [2] })).toBeUndefined();
    expect(pageList({ items: [1], meta: { next: "abc" } })).toBeUndefined();
    expect(pageList({ name: "x" })).toBeUndefined();
    expect(pageList([1, 2])).toBeUndefined();
  });

  it("leaves an empty list a row", () => {
    expect(pageList({ items: [], nextToken: "" })).toBeUndefined();
  });
});

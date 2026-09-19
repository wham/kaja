import { describe, expect, test } from "bun:test";
import { rowCaption, rowRecord, rowTitle } from "./mobile";

describe("rowTitle", () => {
  test("is the first column", () => {
    expect(rowTitle(["Ran", "Kurosawa", "1985"])).toBe("Ran");
  });

  test("is empty where the row is", () => {
    expect(rowTitle([])).toBe("");
  });
});

describe("rowCaption", () => {
  test("joins what is left", () => {
    expect(rowCaption(["Ran", "Kurosawa", "1985", "162 min"])).toBe("Kurosawa · 1985 · 162 min");
  });

  test("leaves out the cells with nothing in them", () => {
    expect(rowCaption(["Ran", "", "1985", "   "])).toBe("1985");
  });

  test("is empty on a one-column table", () => {
    expect(rowCaption(["Ran"])).toBe("");
  });
});

describe("rowRecord", () => {
  test("pairs each value with its column", () => {
    expect(rowRecord(["title", "director"], ["Ran", "Kurosawa"])).toEqual([
      { column: "title", value: "Ran", index: 0 },
      { column: "director", value: "Kurosawa", index: 1 },
    ]);
  });

  test("keeps a value the table named no column for", () => {
    expect(rowRecord(["title"], ["Ran", "Kurosawa"])).toEqual([
      { column: "title", value: "Ran", index: 0 },
      { column: "", value: "Kurosawa", index: 1 },
    ]);
  });

  test("keeps a column the row is missing", () => {
    expect(rowRecord(["title", "director"], ["Ran"])).toEqual([
      { column: "title", value: "Ran", index: 0 },
      { column: "director", value: "", index: 1 },
    ]);
  });
});

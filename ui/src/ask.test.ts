import { describe, expect, it } from "bun:test";
import { answerPlaceholder, answerProblem, normalizeAnswer, parseInteger, typeaheadIndex } from "./ask";

describe("parseInteger", () => {
  it("reads a whole number, signed or padded", () => {
    expect(parseInteger("42")).toBe(42);
    expect(parseInteger("  42  ")).toBe(42);
    expect(parseInteger("-7")).toBe(-7);
    expect(parseInteger("+7")).toBe(7);
    expect(parseInteger("0")).toBe(0);
  });

  it("refuses anything that isn't one", () => {
    expect(parseInteger("")).toBeUndefined();
    expect(parseInteger("3.5")).toBeUndefined();
    expect(parseInteger("3 apples")).toBeUndefined();
    expect(parseInteger("1e3")).toBeUndefined();
    expect(parseInteger("0x10")).toBeUndefined();
    expect(parseInteger("NaN")).toBeUndefined();
  });

  it("refuses a number too big to be exact", () => {
    expect(parseInteger("9007199254740991")).toBe(9007199254740991);
    expect(parseInteger("9007199254740993")).toBeUndefined();
  });
});

describe("answerProblem", () => {
  it("takes any text as a string, including none", () => {
    expect(answerProblem("str", "")).toBeUndefined();
    expect(answerProblem("str", "  ")).toBeUndefined();
    expect(answerProblem("str", "june")).toBeUndefined();
  });

  it("names what is wrong with an int", () => {
    expect(answerProblem("int", "42")).toBeUndefined();
    expect(answerProblem("int", "")).toBe("Enter a whole number");
    expect(answerProblem("int", "3.5")).toBe("Not a whole number");
  });

  it("has nothing to say about a select, which can only produce a choice", () => {
    expect(answerProblem("select", "eu")).toBeUndefined();
  });
});

describe("normalizeAnswer", () => {
  it("records the number that was read, not the spacing it was typed with", () => {
    expect(normalizeAnswer("int", "  +42 ")).toBe("42");
    expect(normalizeAnswer("str", "  june ")).toBe("  june ");
  });
});

describe("answerPlaceholder", () => {
  it("says what the field is after", () => {
    expect(answerPlaceholder("int")).toBe("Whole number…");
    expect(answerPlaceholder("str")).toBe("Answer…");
  });
});

describe("typeaheadIndex", () => {
  const names = ["adam", "chinmay", "mia", "nao", "nikita", "Mora"];

  it("lands on the first choice starting with the letter", () => {
    expect(typeaheadIndex(names, "n", 0)).toBe(3);
    expect(typeaheadIndex(names, "c", 0)).toBe(1);
  });

  it("stays where it is when the choice it is on already matches", () => {
    expect(typeaheadIndex(names, "m", 2)).toBe(2);
  });

  it("cycles through the matches when the letter is typed again", () => {
    expect(typeaheadIndex(names, "mm", 2)).toBe(5);
    expect(typeaheadIndex(names, "mmm", 5)).toBe(2);
  });

  it("narrows as more letters are typed", () => {
    expect(typeaheadIndex(names, "ni", 3)).toBe(4);
    expect(typeaheadIndex(names, "na", 4)).toBe(3);
  });

  it("wraps rather than stopping at the end", () => {
    expect(typeaheadIndex(names, "a", 4)).toBe(0);
  });

  it("ignores case, on both sides", () => {
    expect(typeaheadIndex(names, "MO", 0)).toBe(5);
  });

  it("has nowhere to go when nothing starts with it", () => {
    expect(typeaheadIndex(names, "z", 0)).toBeUndefined();
    expect(typeaheadIndex([], "a", 0)).toBeUndefined();
  });
});

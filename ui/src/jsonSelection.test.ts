import { describe, expect, test } from "bun:test";
import { expandRange, LineRange, valueAt } from "./jsonSelection";

describe("valueAt", () => {
  const line = '    "id": "lib_Y44zdPLE4h", "n": -1.5e3, "ok": true';

  test("a string is taken without its quotes", () => {
    const at = valueAt(line, line.indexOf("Y44") + 1)!;
    expect(line.slice(at.start - 1, at.end - 1)).toBe("lib_Y44zdPLE4h");
  });

  test("a press on a quote is the string", () => {
    const at = valueAt(line, line.indexOf('"lib') + 1)!;
    expect(line.slice(at.start - 1, at.end - 1)).toBe("lib_Y44zdPLE4h");
  });

  test("a key is a string too", () => {
    const at = valueAt(line, line.indexOf("id") + 1)!;
    expect(line.slice(at.start - 1, at.end - 1)).toBe("id");
  });

  test("numbers and literals are taken whole", () => {
    const number = valueAt(line, line.indexOf("1.5") + 1)!;
    expect(line.slice(number.start - 1, number.end - 1)).toBe("-1.5e3");
    const literal = valueAt(line, line.indexOf("true") + 2)!;
    expect(line.slice(literal.start - 1, literal.end - 1)).toBe("true");
  });

  test("an empty string is its quotes", () => {
    const empty = '"a": ""';
    const at = valueAt(empty, 6)!;
    expect(empty.slice(at.start - 1, at.end - 1)).toBe('""');
  });

  test("punctuation and whitespace are nothing", () => {
    expect(valueAt(line, 1)).toBeUndefined();
    expect(valueAt(line, line.indexOf(":") + 1)).toBeUndefined();
  });
});

describe("expandRange", () => {
  const text = JSON.stringify({ items: [{ id: "lib_1", parent: { id: "lib_0" } }, { id: "lib_2" }] }, null, 2);
  const lines = text.split("\n");
  const read = (range: LineRange) => {
    const out: string[] = [];
    for (let line = range.startLine; line <= range.endLine; line++) {
      const content = lines[line - 1];
      const from = line === range.startLine ? range.startColumn - 1 : 0;
      const to = line === range.endLine ? range.endColumn - 1 : content.length;
      out.push(content.slice(from, to));
    }
    return out.join("\n");
  };
  const press = (needle: string): LineRange => {
    const line = lines.findIndex((content) => content.includes(needle)) + 1;
    const at = valueAt(lines[line - 1], lines[line - 1].indexOf(needle) + 1)!;
    return { startLine: line, startColumn: at.start, endLine: line, endColumn: at.end };
  };

  test("a value grows to its member, then to the object holding it, then outwards", () => {
    let range = press("lib_0");
    expect(read(range)).toBe("lib_0");
    range = expandRange(lines, range);
    expect(read(range)).toBe('"id": "lib_0"');
    range = expandRange(lines, range);
    expect(read(range)).toBe('"parent": {\n        "id": "lib_0"\n      }');
    range = expandRange(lines, range);
    expect(read(range)).toBe('{\n      "id": "lib_1",\n      "parent": {\n        "id": "lib_0"\n      }\n    }');
    range = expandRange(lines, range);
    expect(read(range).startsWith('"items": [')).toBe(true);
    range = expandRange(lines, range);
    expect(read(range)).toBe(text);
    expect(read(expandRange(lines, range))).toBe(text);
  });

  test("the trailing comma is not part of a member", () => {
    expect(read(expandRange(lines, press("lib_1")))).toBe('"id": "lib_1"');
  });

  test("a key grows to its whole member", () => {
    expect(read(expandRange(lines, press("parent")))).toBe('"parent": {\n        "id": "lib_0"\n      }');
  });
});

import { expect, test } from "bun:test";
import { drawnText, printJson } from "./payloadText";

test("prints a payload the way the pane shows it", () => {
  expect(printJson({ id: "show-1", seats: [1, 2] })).toEqual(`{\n  "id": "show-1",\n  "seats": [\n    1,\n    2\n  ]\n}`);
});

test("prints a 64-bit field rather than throwing on it", () => {
  expect(printJson({ id: 9007199254740993n })).toEqual(`{\n  "id": "9007199254740993"\n}`);
});

test("undefined has nothing to print", () => {
  expect(printJson(undefined)).toEqual("");
});

test("a payload under the ceiling is drawn as itself", () => {
  const text = printJson({ id: "x" });
  expect(drawnText(text)).toEqual(text);
});

test("a payload over the ceiling says how much of it is not drawn", () => {
  const text = "x".repeat(2_000_100);
  const drawn = drawnText(text);
  expect(drawn.length).toBeLessThan(text.length);
  expect(drawn).toContain("100 more characters not shown");
});

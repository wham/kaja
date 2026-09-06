import { expect, test } from "bun:test";
import { formatTypeScript, formatTypeScriptWithCursor } from "./formatter";

test("formatTypeScript", () => {
  // What appLoader's printer emits: four-space indent, one statement per line.
  const printed = `import { Shows } from "theatre";\nShows.GetShow({\n    id: "",\n    page: {\n        size: 0\n    }\n});\n`;
  expect(formatTypeScript(printed)).toEqual(`import { Shows } from "theatre";\nShows.GetShow({\n  id: "",\n  page: {\n    size: 0\n  }\n});\n`);

  expect(formatTypeScript(`let i=1;\n++i;\n`)).toEqual(`let i = 1;\n++i;\n`);
  expect(formatTypeScript("} invalid_typescript")).toEqual("} invalid_typescript");
});

test("formatTypeScriptWithCursor", () => {
  const code = `export const Meters = { ListMeters: async (input: { name: string; page: number; filter: string[] }): Promise<void> => {}, GetMeter: async (input: { id: string }): Promise<void> => {} };`;
  const result = formatTypeScriptWithCursor(code, code.indexOf("GetMeter"));
  expect(result.code.slice(result.cursorOffset, result.cursorOffset + "GetMeter".length)).toEqual("GetMeter");

  const invalid = "} invalid_typescript";
  expect(formatTypeScriptWithCursor(invalid, 5)).toEqual({ code: invalid, cursorOffset: 5 });
});

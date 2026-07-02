import { expect, test } from "bun:test";
import { formatJson, formatTypeScript, formatTypeScriptWithCursor } from "./formatter";

test("formatJson", async () => {
  expect(await formatJson(`{hello: "json"}`)).toEqual(`{ "hello": "json" }\n`);
  expect(await formatJson("invalid_json")).toEqual("invalid_json");
});

test("formatTypeScript", async () => {
  expect(await formatTypeScript(`let i=1;++i`)).toEqual(`let i = 1;\n++i;\n`);
  expect(await formatTypeScript("} invalid_typescript")).toEqual("} invalid_typescript");
});

test("formatTypeScriptWithCursor", async () => {
  const code = `export const Meters = { ListMeters: async (input: { name: string; page: number; filter: string[] }): Promise<void> => {}, GetMeter: async (input: { id: string }): Promise<void> => {} };`;
  const result = await formatTypeScriptWithCursor(code, code.indexOf("GetMeter"));
  expect(result.code.slice(result.cursorOffset, result.cursorOffset + "GetMeter".length)).toEqual("GetMeter");

  const invalid = "} invalid_typescript";
  expect(await formatTypeScriptWithCursor(invalid, 5)).toEqual({ code: invalid, cursorOffset: 5 });
});

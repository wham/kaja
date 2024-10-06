import { expect, test } from "vitest";
import { formatJson, formatTypeScript } from "./formatter";

test("formatJson", async () => {
  expect(await formatJson(`{hello: "json"}`)).toEqual(`{ "hello": "json" }\n`);
  expect(await formatJson("invalid_json")).toEqual("invalid_json");
});

test("formatTypeScript", async () => {
  expect(await formatTypeScript(`let i=1;++i`)).toEqual(`let i = 1;\n++i;\n`);
  expect(await formatJson("invalid_typescript")).toEqual("invalid_typescript");
});

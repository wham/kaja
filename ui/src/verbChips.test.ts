import { describe, expect, test } from "bun:test";
import { readVerbs } from "./verbChips";

function chipped(code: string): string[] {
  return readVerbs(code)!.chips.map((chip) => code.slice(chip.from, chip.to));
}

describe("readVerbs", () => {
  test("reads each verb the runtime is called through", () => {
    const code = `import { kaja } from "kaja";\nconst a = await kaja.askSelect("q", ["x"]);\nkaja.table([a]);\n`;
    expect(chipped(code)).toEqual(["kaja.askSelect", "kaja.table"]);
  });

  test("follows an alias and ignores another object's member of the same name", () => {
    const code = `import { kaja as k } from "kaja";\nconst kaja = { table() {} };\nk.table([]);\nother.table([]);\n`;
    expect(chipped(code)).toEqual(["k.table"]);
  });

  test("leaves a member that isn't a verb as written", () => {
    expect(chipped(`kaja.nothing(); kaja.input.id;`)).toEqual(["kaja.input"]);
  });

  test("hides the runtime's import line, break included", () => {
    const code = `import { kaja } from "kaja";\nimport { Repos } from "github";\n`;
    const { from, to } = readVerbs(code)!.runtimeImport!;
    expect(code.slice(from, to)).toBe(`import { kaja } from "kaja";\n`);
  });

  test("keeps an import that brings in something else too", () => {
    expect(readVerbs(`import { kaja, type Table } from "kaja";\n`)!.runtimeImport).toBeUndefined();
    expect(readVerbs(`import { kaja } from "kaja"; const x = 1;\n`)!.runtimeImport).toBeUndefined();
  });

  test("has nothing to say about a file that doesn't parse", () => {
    expect(readVerbs(`kaja.table(`)).toBeUndefined();
  });
});

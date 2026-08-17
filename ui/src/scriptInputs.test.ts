import { describe, expect, it } from "bun:test";
import { readInputKeys } from "./scriptInputs";

const script = (body: string, imports = `import { kaja } from "kaja";`) => `${imports}\n\n${body}\n`;

describe("readInputKeys", () => {
  it("reads a property access, in source order", () => {
    expect(readInputKeys(script(`const url = kaja.input.url;\nconst note = kaja.input.note;`))).toEqual(["url", "note"]);
  });

  it("names each key once, however often it is read", () => {
    expect(readInputKeys(script(`if (kaja.input.url) kaja.text(kaja.input.url);`))).toEqual(["url"]);
  });

  it("reads an optional chain", () => {
    expect(readInputKeys(script(`const url = kaja.input?.url ?? "";`))).toEqual(["url"]);
  });

  it("reads a bracketed key, which is the only way to write one that isn't an identifier", () => {
    expect(readInputKeys(script(`const value = kaja.input["order id"];`))).toEqual(["order id"]);
  });

  it("reads a destructuring, and a rename by the key rather than the local name", () => {
    expect(readInputKeys(script(`const { url: link, note } = kaja.input;`))).toEqual(["url", "note"]);
  });

  it("ignores the rest of a destructuring, which names no key", () => {
    expect(readInputKeys(script(`const { url, ...rest } = kaja.input;`))).toEqual(["url"]);
  });

  it("follows a name bound to the input map", () => {
    expect(readInputKeys(script(`const input = kaja.input;\nconst url = input.url;\nconst { note } = input;`))).toEqual(["url", "note"]);
  });

  it("follows the alias the import was given", () => {
    expect(readInputKeys(script(`const url = k.input.url;`, `import { kaja as k } from "kaja";`))).toEqual(["url"]);
  });

  it("reads a file that hasn't imported the runtime yet", () => {
    expect(readInputKeys(`const url = kaja.input.url;`)).toEqual(["url"]);
  });

  // The whole reason this is an AST read rather than a pattern over the source.
  it("ignores an `input` on anything but the runtime", () => {
    const code = script(`const url = call.input.url;\nconst other = response.input["note"];`);
    expect(readInputKeys(code)).toEqual([]);
  });

  it("ignores a mention in a comment or a string", () => {
    const code = script(`// kaja.input.stale\nkaja.text("kaja.input.quoted");`);
    expect(readInputKeys(code)).toEqual([]);
  });

  it("ignores a key the script computes, since there is no name to list", () => {
    expect(readInputKeys(script(`const which = "url";\nconst value = kaja.input[which];`))).toEqual([]);
  });

  it("says nothing about a script that reads the map whole", () => {
    expect(readInputKeys(script(`for (const [name, value] of Object.entries(kaja.input)) kaja.text(name + value);`))).toEqual([]);
  });

  it("reads a key deep inside the script", () => {
    const code = script(`async function main() {\n  const rows = kaja.table(["a"]);\n  rows.row(kaja.input.since);\n}\nawait main();`);
    expect(readInputKeys(code)).toEqual(["since"]);
  });

  it("reads what it can out of a file that doesn't parse", () => {
    expect(readInputKeys(script(`const url = kaja.input.url;\nconst broken = (;`))).toEqual(["url"]);
  });

  it("has nothing to say about a script that takes nothing", () => {
    expect(readInputKeys(script(`kaja.text("hello");`))).toEqual([]);
  });
});

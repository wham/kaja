import { describe, expect, it } from "bun:test";
import ts from "typescript";
import { kajaModuleDeclaration } from "./kajaModule";
import { readInputKeys, readInputParameters, runInputDeclaration, ScriptInputs } from "./scriptInputs";

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

describe("readInputParameters", () => {
  const open = (body: string) => readInputParameters(script(body)).open;

  it("is closed over a script that names every key it reads", () => {
    expect(readInputParameters(script(`const url = kaja.input.url;`))).toEqual({ keys: ["url"], open: false });
  });

  it("is open where the key is computed, since what it names is not all it reads", () => {
    expect(open(`const which = "url";\nconst value = kaja.input[which];`)).toBe(true);
  });

  it("is open where a destructuring takes the rest", () => {
    expect(readInputParameters(script(`const { url, ...rest } = kaja.input;`))).toEqual({ keys: ["url"], open: true });
  });

  it("is open where the map is handed somewhere whole", () => {
    expect(open(`for (const [name] of Object.entries(kaja.input)) kaja.text(name);`)).toBe(true);
  });

  // The name being bound is spelled like a use of the map and is the opposite of one.
  it("stays closed for a name bound to the map and then read by key", () => {
    expect(readInputParameters(script(`const input = kaja.input;\nconst url = input.url;`))).toEqual({ keys: ["url"], open: false });
  });

  it("follows a name bound to one of those names", () => {
    expect(readInputParameters(script(`const input = kaja.input;\nconst again = input;\nconst url = again.url;`))).toEqual({ keys: ["url"], open: false });
  });

  it("is open where an alias goes somewhere whole", () => {
    expect(open(`const input = kaja.input;\nkaja.text(JSON.stringify(input));`)).toBe(true);
  });

  it("is closed over a script that reads nothing", () => {
    expect(readInputParameters(script(`kaja.text("hello");`))).toEqual({ keys: [], open: false });
  });
});

describe("runInputDeclaration", () => {
  const declaration = (scripts: ScriptInputs[]) => runInputDeclaration(scripts);

  it("declares what a script takes under every spelling a link reaches it by", () => {
    const text = declaration([{ name: "reports/churn", parameters: { keys: ["customer"], open: false } }]);
    expect(text).toContain(`"reports/churn": { customer?: unknown };`);
    expect(text).toContain(`"reports/churn.ts": KajaScripts["reports/churn"];`);
    expect(text).toContain(`"churn": KajaScripts["reports/churn"];`);
    expect(text).toContain(`"churn.ts": KajaScripts["reports/churn"];`);
  });

  // A window that has just started has read nothing, and refusing everything in it
  // would be worse than refusing nothing.
  it("leaves out a script nothing has read", () => {
    expect(declaration([{ name: "reports/churn" }])).not.toContain("reports/churn");
  });

  it("lets a script that reads a key it doesn't name take anything", () => {
    expect(declaration([{ name: "churn", parameters: { keys: ["a"], open: true } }])).toContain(`"churn": { a?: unknown; [key: string]: unknown };`);
  });

  it("refuses every key for a script that reads none", () => {
    expect(declaration([{ name: "ping", parameters: { keys: [], open: false } }])).toContain(`"ping": { [key: string]: ThisScriptReadsNoParameters };`);
  });

  // The same rule a click resolves under: the first script in the listing that answers
  // to the name.
  it("gives a base name two scripts share to the first of them", () => {
    const text = declaration([
      { name: "reports/churn", parameters: { keys: ["a"], open: false } },
      { name: "billing/churn", parameters: { keys: ["b"], open: false } },
    ]);
    expect(text).toContain(`"churn": KajaScripts["reports/churn"];`);
    expect(text).not.toContain(`"churn": KajaScripts["billing/churn"];`);
  });

  it("quotes a key that is not an identifier", () => {
    expect(declaration([{ name: "churn", parameters: { keys: ["order id"], open: false } }])).toContain(`{ "order id"?: unknown }`);
  });
});

/**
 * The declaration is only worth anything if TypeScript reads it the way it is meant,
 * so it is compiled rather than described: the generated file, the kaja module it is
 * read through, and a script written against both.
 */
describe("what TypeScript makes of the declaration", () => {
  const FILES = { module: "/kaja.ts", declaration: "/kaja-scripts.d.ts", script: "/script.ts" };

  function errors(scripts: ScriptInputs[], body: string): string[] {
    const files: Record<string, string> = {
      [FILES.module]: kajaModuleDeclaration([]),
      [FILES.declaration]: runInputDeclaration(scripts),
      [FILES.script]: `import { kaja } from "./kaja";\n${body}\n`,
    };
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Classic,
      moduleDetection: ts.ModuleDetectionKind.Force,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    };
    const host = ts.createCompilerHost(options);
    const readSource = host.getSourceFile.bind(host);
    host.getSourceFile = (name, version, onError, create) =>
      files[name] === undefined ? readSource(name, version, onError, create) : ts.createSourceFile(name, files[name], version, true);
    const exists = host.fileExists.bind(host);
    host.fileExists = (name) => files[name] !== undefined || exists(name);
    const read = host.readFile.bind(host);
    host.readFile = (name) => files[name] ?? read(name);

    const program = ts.createProgram(Object.keys(files), options, host);
    return program
      .getSemanticDiagnostics(program.getSourceFile(FILES.script))
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
  }

  const churn: ScriptInputs[] = [
    { name: "reports/churn", parameters: { keys: ["customer", "month"], open: false } },
    { name: "loose", parameters: { keys: [], open: true } },
    { name: "ping", parameters: { keys: [], open: false } },
    { name: "unread" },
  ];

  it("says nothing about a parameter the script reads", () => {
    expect(errors(churn, `kaja.run("reports/churn", { customer: "acme", month: "2026-01" });`)).toEqual([]);
  });

  it("names the misspelled key, and what it was probably meant to be", () => {
    const [message, ...rest] = errors(churn, `kaja.run("reports/churn", { custmer: "acme" });`);
    expect(rest).toEqual([]);
    expect(message).toContain("'custmer'");
    expect(message).toContain("Did you mean to write 'customer'");
  });

  it("checks a script reached by its base name", () => {
    expect(errors(churn, `kaja.run("churn", { custmer: "acme" });`)).toHaveLength(1);
    expect(errors(churn, `kaja.run("churn.ts", { month: "2026-01" });`)).toEqual([]);
  });

  // The refusal is a type name, so the name has to read as the sentence it stands in
  // for: TypeScript prints it, and `never` on its own explains nothing.
  it("refuses a parameter to a script that reads none, and says so by name", () => {
    expect(errors(churn, `kaja.run("ping", { customer: "acme" });`)).toEqual([`Type 'string' is not assignable to type 'ThisScriptReadsNoParameters'.`]);
    expect(errors(churn, `kaja.run("ping");`)).toEqual([]);
    expect(errors(churn, `kaja.run("ping", {});`)).toEqual([]);
  });

  it("refuses nothing to a script that reads a key it doesn't name", () => {
    expect(errors(churn, `kaja.run("loose", { whatever: 1 });`)).toEqual([]);
  });

  it("refuses nothing to a script nothing has read", () => {
    expect(errors(churn, `kaja.run("unread", { whatever: 1 });`)).toEqual([]);
  });

  // A const holds the name it was written with, so the check follows it there too.
  it("checks a name held in a const", () => {
    expect(errors(churn, `const named = "reports/churn";\nkaja.run(named, { custmer: "acme" });`)).toHaveLength(1);
  });

  it("refuses nothing where the name is computed", () => {
    expect(errors(churn, `const named: string = folder();\nkaja.run(named, { custmer: "acme" });\nfunction folder() {\n  return "reports/churn";\n}`)).toEqual(
      [],
    );
  });

  // Every value is sent as text, so there is nothing about one to be wrong.
  it("takes a value of any kind", () => {
    expect(errors(churn, `kaja.run("reports/churn", { customer: 42, month: new Date() });`)).toEqual([]);
  });

  it("leaves the label alone", () => {
    expect(errors(churn, `kaja.run("reports/churn", { customer: "acme" }, { label: "Churn" });`)).toEqual([]);
  });
});

import { describe, expect, it } from "bun:test";
import { readRunReferences, remapRunReferences, runNameAt, unresolvedRuns } from "./scriptRuns";

const IMPORT = 'import { kaja } from "kaja";\n';

describe("readRunReferences", () => {
  it("reads the name a cell runs", () => {
    const code = `${IMPORT}kaja.table(["a"], [[kaja.run("reports/churn", { id: 7 })]]);`;
    expect(readRunReferences(code).map((reference) => reference.name)).toEqual(["reports/churn"]);
  });

  it("covers the name and not its quotes", () => {
    const code = `${IMPORT}kaja.run("churn");`;
    const [reference] = readRunReferences(code);
    expect(code.slice(reference.start, reference.end)).toBe("churn");
  });

  it("follows the alias the import bound", () => {
    const code = 'import { kaja as k } from "kaja";\nk.run("churn");';
    expect(readRunReferences(code).map((reference) => reference.name)).toEqual(["churn"]);
  });

  it("reads a file that has not written its import yet", () => {
    expect(readRunReferences('kaja.run("churn");').map((reference) => reference.name)).toEqual(["churn"]);
  });

  it("leaves a run on something else alone", () => {
    const code = `${IMPORT}const job = { run: (name: string) => name };\njob.run("churn");`;
    expect(readRunReferences(code)).toEqual([]);
  });

  it("leaves a kaja.run in a comment or a string alone", () => {
    const code = `${IMPORT}// kaja.run("churn")\nconst note = 'kaja.run("churn")';`;
    expect(readRunReferences(code)).toEqual([]);
  });

  it("leaves a computed name alone rather than guessing at it", () => {
    const code = `${IMPORT}const which = "churn";\nkaja.run(which);\nkaja.run(\`reports/\${which}\`);`;
    expect(readRunReferences(code)).toEqual([]);
  });

  it("reads a name being typed, before its closing quote", () => {
    const code = `${IMPORT}kaja.run("rep`;
    expect(readRunReferences(code).map((reference) => reference.name)).toEqual(["rep"]);
  });
});

describe("runNameAt", () => {
  const code = `${IMPORT}kaja.run("churn");`;
  const at = code.indexOf("churn");

  it("is the destination the cursor sits in", () => {
    expect(runNameAt(code, at + 2)?.name).toBe("churn");
  });

  it("reaches both edges, which is where a name is typed from", () => {
    expect(runNameAt(code, at)?.name).toBe("churn");
    expect(runNameAt(code, at + "churn".length)?.name).toBe("churn");
  });

  it("is nothing outside the quotes", () => {
    expect(runNameAt(code, at - 2)).toBeUndefined();
  });
});

describe("unresolvedRuns", () => {
  const scripts = ["reports/churn.ts", "ingest.ts"];

  it("says nothing about a name that reaches a script", () => {
    expect(unresolvedRuns(`${IMPORT}kaja.run("reports/churn");`, scripts)).toEqual([]);
  });

  it("takes the extension a link may carry", () => {
    expect(unresolvedRuns(`${IMPORT}kaja.run("reports/churn.ts");`, scripts)).toEqual([]);
  });

  it("takes the bare name of a filed script", () => {
    expect(unresolvedRuns(`${IMPORT}kaja.run("churn");`, scripts)).toEqual([]);
  });

  it("reports a name that reaches nothing", () => {
    expect(unresolvedRuns(`${IMPORT}kaja.run("billing/churn");`, scripts).map((r) => r.name)).toEqual(["billing/churn"]);
  });

  it("leaves a blank name to the run, which refuses it by name", () => {
    expect(unresolvedRuns(`${IMPORT}kaja.run("");`, scripts)).toEqual([]);
  });

  it("says nothing where there are no scripts to say it against", () => {
    expect(unresolvedRuns(`${IMPORT}kaja.run("churn");`, []).map((r) => r.name)).toEqual(["churn"]);
  });
});

describe("remapRunReferences", () => {
  it("follows a renamed folder", () => {
    const code = `${IMPORT}kaja.run("openmeter/customer", { id });`;
    const renames = new Map([["openmeter/customer.ts", "openmeter-dev/customer.ts"]]);
    expect(remapRunReferences(code, renames)).toBe(`${IMPORT}kaja.run("openmeter-dev/customer", { id });`);
  });

  it("says the new name the way the old one was said", () => {
    const renames = new Map([["reports/churn.ts", "reports/weekly.ts"]]);
    expect(remapRunReferences(`${IMPORT}kaja.run("reports/churn.ts");`, renames)).toBe(`${IMPORT}kaja.run("reports/weekly.ts");`);
  });

  it("leaves a bare name alone when the move did not break it", () => {
    const code = `${IMPORT}kaja.run("customer");`;
    const renames = new Map([["openmeter/customer.ts", "openmeter-dev/customer.ts"]]);
    expect(remapRunReferences(code, renames)).toBe(code);
  });

  it("follows a bare name the rename did break", () => {
    const code = `${IMPORT}kaja.run("churn");`;
    const renames = new Map([["churn.ts", "churn-report.ts"]]);
    expect(remapRunReferences(code, renames)).toBe(`${IMPORT}kaja.run("churn-report");`);
  });

  it("keeps the quote the author wrote", () => {
    const code = `${IMPORT}kaja.run('churn');`;
    expect(remapRunReferences(code, new Map([["churn.ts", "weekly.ts"]]))).toBe(`${IMPORT}kaja.run('weekly');`);
  });

  it("follows every destination in one pass, later ones first", () => {
    const code = `${IMPORT}kaja.run("x/a");\nkaja.run("y/b");`;
    const renames = new Map([
      ["x/a.ts", "x2/a.ts"],
      ["y/b.ts", "y2/b.ts"],
    ]);
    expect(remapRunReferences(code, renames)).toBe(`${IMPORT}kaja.run("x2/a");\nkaja.run("y2/b");`);
  });

  // A bare name names no folder, so it goes on reaching the file wherever it is filed.
  // Rewriting one would be following a move that broke nothing.
  it("leaves a bare name alone when the file only changed folders", () => {
    const code = `${IMPORT}kaja.run("churn");`;
    expect(remapRunReferences(code, new Map([["churn.ts", "reports/churn.ts"]]))).toBe(code);
  });

  it("leaves a name no rename touched alone", () => {
    const code = `${IMPORT}kaja.run("ingest");`;
    expect(remapRunReferences(code, new Map([["churn.ts", "weekly.ts"]]))).toBe(code);
  });

  it("leaves the rest of the line exactly as it was", () => {
    const code = `${IMPORT}kaja.run(   "churn" ,  { id: 7 }, { label: "Churn" });`;
    expect(remapRunReferences(code, new Map([["churn.ts", "weekly.ts"]]))).toBe(`${IMPORT}kaja.run(   "weekly" ,  { id: 7 }, { label: "Churn" });`);
  });
});

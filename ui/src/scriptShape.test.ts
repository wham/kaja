import { describe, expect, it } from "bun:test";
import { scriptShape, topScripts } from "./scriptShape";

describe("scriptShape", () => {
  it("reads the apps a script imports, kaja aside", () => {
    const shape = scriptShape(
      `import { kaja } from "kaja";\nimport { Repos, Search } from "github";\nimport { GRPCBin } from "grpcb.in/grpcbin";\n\nawait Repos.Get({});\n`,
    );
    expect(shape?.imports).toEqual([
      { specifier: "github", names: ["Repos", "Search"] },
      { specifier: "grpcb.in/grpcbin", names: ["GRPCBin"] },
    ]);
  });

  it("is a table where the script draws one", () => {
    expect(scriptShape(`import { kaja } from "kaja";\nkaja.text("hi");\nkaja.table([], (row) => row);\n`)?.kind).toBe("table");
  });

  it("is a load test before anything it also draws", () => {
    expect(scriptShape(`import { kaja } from "kaja";\nkaja.table([]);\nawait kaja.perfTest(() => fetch("/"), { iterations: 1 });\n`)?.kind).toBe("perfTest");
  });

  it("follows kaja under another name", () => {
    expect(scriptShape(`import { kaja as k } from "kaja";\nawait k.askStr("Which?");\n`)?.kind).toBe("ask");
  });

  it("is calls alone where nothing is drawn", () => {
    const shape = scriptShape(`const response = await fetch("https://example.com");\nconsole.log(response.status);\n`);
    expect(shape).toMatchObject({ kind: "calls", imports: [], fetches: true });
  });

  it("has nothing to say about a file that doesn't parse", () => {
    expect(scriptShape("import { from")).toBeUndefined();
  });
});

describe("topScripts", () => {
  const script = (name: string) => ({ path: `/w/${name}`, name, folder: "" });
  const scripts = [script("a.ts"), script("b.ts"), script("c.ts"), script("d.ts")];

  it("leads with the most recently run, then the rest as listed", () => {
    const ran = new Map([
      ["/w/c.ts", 10],
      ["/w/b.ts", 20],
    ]);
    expect(topScripts(scripts, ran, 3).map((s) => s.name)).toEqual(["b.ts", "c.ts", "a.ts"]);
  });

  it("ignores runs of files that are gone", () => {
    expect(topScripts(scripts, new Map([["/w/z.ts", 1]]), 10).map((s) => s.name)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });
});

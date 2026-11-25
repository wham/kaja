import { describe, expect, it } from "bun:test";
import { App, createPendingApp } from "./apps";
import { mergeImports } from "./drafts";
import { importSpecifiers } from "./missingImports";
import { Source } from "./sources";

function app(name: string, modules: { path: string; services?: string[]; interfaces?: string[] }[]): App {
  const created = createPendingApp({ name, app: { oneofKind: "grpc" } as any });
  created.sources = modules.map(
    ({ path, services, interfaces }) => ({ importPath: path, serviceNames: services ?? [], enums: {}, interfaces: interfaces ?? [] }) as unknown as Source,
  );
  return created;
}

describe("importSpecifiers", () => {
  const apps = [
    app("zoo", [
      { path: "zoo/v1", services: ["Animals", "Keepers"], interfaces: ["Pet", "Cage"] },
      { path: "zoo/v2", services: ["Animals"], interfaces: ["Pet"] },
    ]),
    app("farm", [{ path: "farm/service", services: ["Keepers"] }]),
  ];

  it("offers kaja from its module", () => {
    expect(importSpecifiers("kaja", [])).toEqual(["kaja"]);
  });

  it("offers every app declaring the name", () => {
    expect(importSpecifiers("Keepers", apps)).toEqual(["zoo", "farm"]);
  });

  it("offers the modules' paths where the app alone is ambiguous", () => {
    expect(importSpecifiers("Animals", apps)).toEqual(["zoo/v1", "zoo/v2"]);
    expect(importSpecifiers("Pet", apps)).toEqual(["zoo/v1", "zoo/v2"]);
  });

  it("offers types, and nothing for a name nobody declares", () => {
    expect(importSpecifiers("Cage", apps)).toEqual(["zoo"]);
    expect(importSpecifiers("Nothing", apps)).toEqual([]);
  });
});

describe("mergeImports", () => {
  const line = 'import { Animals } from "zoo";';

  it("keeps a trailing comma legal", () => {
    expect(mergeImports('import { Keepers, } from "zoo";\n', line)).toBe('import { Keepers, Animals } from "zoo";\n');
  });

  it("leaves a type-only import alone", () => {
    expect(mergeImports('import type { Pet } from "zoo";\n', line)).toBe(`import type { Pet } from "zoo";\n${line}\n`);
  });
});

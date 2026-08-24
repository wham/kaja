import { describe, it, expect } from "bun:test";
import { App, createPendingApp } from "./apps";
import { Source } from "./sources";
import { barrel, moduleSpecifier, resolve } from "./appImports";

function source(importPath: string, serviceNames: string[], enums: string[] = []): Source {
  return { importPath, serviceNames, enums: Object.fromEntries(enums.map((name) => [name, { object: {} }])) } as unknown as Source;
}

// An app kaja generated the proto surface for: one module, named by a word kaja
// chose, plus the .client module no script writes against.
function generated(): App {
  const app = createPendingApp({ name: "theatre", app: { oneofKind: "openapi" } as any });
  app.sources = [source("theatre/service", ["Shows"], ["Sort"]), source("theatre/service.client", [])];
  return app;
}

// An app built from proto files on disk, where two of them declare Quirks.
function fromDisk(): App {
  const app = createPendingApp({ name: "quirks", app: { oneofKind: "twirp" } as any });
  app.sources = [source("quirks/v1/quirks", ["Quirks", "Basics"]), source("quirks/v2/quirks", ["Quirks"])];
  return app;
}

describe("moduleSpecifier", () => {
  it("is the app, where the app declares the name once", () => {
    const app = generated();
    expect(moduleSpecifier(app, app.sources[0], "Shows")).toBe("theatre");
    expect(moduleSpecifier(app, app.sources[0], "Sort")).toBe("theatre");
  });

  it("is the module's path, where two of the app's modules declare the name", () => {
    const app = fromDisk();
    expect(moduleSpecifier(app, app.sources[0], "Quirks")).toBe("quirks/v1/quirks");
    expect(moduleSpecifier(app, app.sources[1], "Quirks")).toBe("quirks/v2/quirks");
    // A name only one of them declares is reached by the app, in the same app.
    expect(moduleSpecifier(app, app.sources[0], "Basics")).toBe("quirks");
  });
});

describe("resolve", () => {
  it("answers the app's own name with the module declaring the name", () => {
    const app = generated();
    expect(resolve(app, "theatre", "Shows")).toEqual({ source: app.sources[0] });
  });

  it("answers a path with that module, whatever the name", () => {
    const app = fromDisk();
    expect(resolve(app, "quirks/v2/quirks", "Quirks")).toEqual({ source: app.sources[1] });
  });

  it("reports a name two modules declare as ambiguous", () => {
    const app = fromDisk();
    const resolution = resolve(app, "quirks", "Quirks");
    expect(resolution).toEqual({ ambiguous: [app.sources[0], app.sources[1]] });
  });

  it("reports a name nothing declares as absent, since a type binds nothing at run time", () => {
    const app = generated();
    expect(resolve(app, "theatre", "ListShowsRequest")).toEqual({ absent: true });
  });

  it("reports a path no module answers to", () => {
    const app = generated();
    expect(resolve(app, "theatre/nope", "Shows")).toEqual({ unknownPath: true });
  });

  it("never resolves a name through the .client module", () => {
    const app = generated();
    app.sources.push(source("theatre/service.client", ["Shows"]));
    expect(resolve(app, "theatre", "Shows")).toEqual({ source: app.sources[0] });
  });
});

describe("barrel", () => {
  it("re-exports every module a script may import from, under the app's name", () => {
    expect(barrel(generated())).toEqual({ path: "theatre.ts", content: 'export * from "./theatre/service";\n' });
  });

  it("leaves a name two modules declare unreachable, which is what makes the path required", () => {
    expect(barrel(fromDisk()).content).toBe('export * from "./quirks/v1/quirks";\nexport * from "./quirks/v2/quirks";\n');
  });
});

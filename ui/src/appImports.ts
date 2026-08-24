import { App } from "./apps";
import { Source } from "./sources";

// An import names an app. A path follows it only where the app declares one name
// in two modules and the app alone cannot say which is meant — which is the whole
// of what a path is for.
//
// Every app kaja generates the proto surface for has exactly one module, and its
// name is a word kaja chose ("service", "mcp", "folder"), so a path there could
// never tell anything apart. An app built from proto files on disk has as many
// modules as you wrote, and a path is how you pick between two that agree.

// importable are the modules a script may import from. The generated `.client`
// modules declare the transport's own I<Service>Client, which no script writes
// against.
export function importable(app: App): Source[] {
  return app.sources.filter((source) => !source.importPath.endsWith(".client"));
}

// declaring returns the app's modules that export `name` under it.
export function declaring(app: App, name: string): Source[] {
  return importable(app).filter((source) => source.serviceNames.includes(name) || source.enums[name] !== undefined);
}

// moduleSpecifier is what a script writes to reach `name` in `source`.
export function moduleSpecifier(app: App, source: Source, name: string): string {
  return declaring(app, name).length > 1 ? source.importPath : app.configuration.name;
}

// appFor finds the app a specifier addresses, by its name or by one of its paths.
export function appFor(apps: App[], specifier: string): App | undefined {
  return apps.find((app) => specifier === app.configuration.name || specifier.startsWith(app.configuration.name + "/"));
}

export type Resolution = { source: Source } | { ambiguous: Source[] } | { unknownPath: true } | { absent: true };

// resolve finds the module an import specifier names a value in. A path names its
// module outright; the app's bare name is resolved by the name being imported,
// which is why resolution is per name rather than per import statement — one
// `import { Add, GRPCBin } from "grpcb.in"` may reach into two modules.
export function resolve(app: App, specifier: string, name: string): Resolution {
  if (specifier !== app.configuration.name) {
    const source = app.sources.find((s) => s.importPath === specifier);
    return source ? { source } : { unknownPath: true };
  }
  const sources = declaring(app, name);
  if (sources.length === 1) return { source: sources[0] };
  if (sources.length > 1) return { ambiguous: sources };
  return { absent: true };
}

// barrel is the module an app's own name resolves to in the editor: one
// re-export per module. A name declared once is reachable under the app; a name
// two modules declare is excluded by `export *` and so is reachable only through
// its path, which is the same rule moduleSpecifier writes and resolve enforces.
export function barrel(app: App): { path: string; content: string } {
  return {
    path: app.configuration.name + ".ts",
    content: importable(app)
      .map((source) => `export * from "./${source.importPath}";\n`)
      .join(""),
  };
}

import { declaring, moduleSpecifier } from "./appImports";
import { App } from "./apps";
import { KAJA_MODULE } from "./defaultInput";

// TypeScript's codes for a name nothing in scope declares: plain, with a spelling
// suggestion, and as a shorthand property.
const UNKNOWN_NAME = [2304, 2552, 18004];

export function isUnknownName(code: number): boolean {
  return UNKNOWN_NAME.includes(code);
}

/** Every module specifier a script can import `name` from, as the runner resolves them. */
export function importSpecifiers(name: string, apps: App[]): string[] {
  const specifiers = name === "kaja" ? [KAJA_MODULE] : [];
  for (const app of apps) {
    const values = declaring(app, name);
    if (values.length > 0) {
      specifiers.push(...values.map((source) => moduleSpecifier(app, source, name)));
      continue;
    }
    const types = app.sources.filter((source) => source.interfaces.includes(name));
    specifiers.push(...types.map((source) => (types.length > 1 ? source.importPath : app.configuration.name)));
  }
  return specifiers;
}

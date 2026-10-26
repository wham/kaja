import type { ImportDeclaration } from "@babel/types";
import { Script } from "./apps";
import { isCall, memberAccess, parseScript, walk } from "./scriptSyntax";

// What a script makes, by the verb that decides what its run looks like. Ordered: a
// load test that draws a table is a load test.
export type ScriptKind = "perfTest" | "approve" | "table" | "ask" | "text" | "calls";

export interface ScriptShape {
  kind: ScriptKind;
  // Each import that is not kaja's, with the names it takes, in the order written.
  imports: { specifier: string; names: string[] }[];
  fetches: boolean;
}

const KIND_ORDER: ScriptKind[] = ["perfTest", "approve", "table", "ask", "text"];

const VERB_KIND: { [verb: string]: ScriptKind } = {
  perfTest: "perfTest",
  approve: "approve",
  table: "table",
  askStr: "ask",
  askInt: "ask",
  askSelect: "ask",
  text: "text",
  code: "text",
};

export function scriptShape(code: string): ScriptShape | undefined {
  const file = parseScript(code);
  if (!file) return undefined;

  const imports: ScriptShape["imports"] = [];
  // `kaja` is an ordinary binding, so it is whatever the kaja import called it.
  const kajaNames = new Set<string>();
  for (const statement of file.program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const declaration = statement as ImportDeclaration;
    const specifier = declaration.source.value;
    if (specifier === "kaja") {
      for (const imported of declaration.specifiers) kajaNames.add(imported.local.name);
      continue;
    }
    const names = declaration.specifiers.flatMap((imported) =>
      imported.type === "ImportSpecifier" ? [imported.imported.type === "Identifier" ? imported.imported.name : imported.imported.value] : [],
    );
    const held = imports.find((entry) => entry.specifier === specifier);
    if (held) held.names.push(...names.filter((name) => !held.names.includes(name)));
    else imports.push({ specifier, names });
  }

  const kinds = new Set<ScriptKind>();
  let fetches = false;
  walk(file.program, (node) => {
    if (!isCall(node)) return;
    if (node.callee.type === "Identifier" && node.callee.name === "fetch") fetches = true;
    const access = memberAccess(node.callee);
    if (access && access.object.type === "Identifier" && kajaNames.has(access.object.name)) {
      const kind = VERB_KIND[access.name];
      if (kind) kinds.add(kind);
    }
  });

  return { kind: KIND_ORDER.find((kind) => kinds.has(kind)) ?? "calls", imports, fetches };
}

// The scripts Start leads with: the ones run most recently, then the rest as the
// sidebar lists them.
export function topScripts(scripts: Script[], lastRunAt: Map<string, number>, limit: number): Script[] {
  const ran = scripts.filter((script) => lastRunAt.has(script.path)).sort((a, b) => lastRunAt.get(b.path)! - lastRunAt.get(a.path)!);
  const rest = scripts.filter((script) => !lastRunAt.has(script.path));
  return [...ran, ...rest].slice(0, limit);
}

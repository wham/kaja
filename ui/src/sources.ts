import type { Node, StringLiteral } from "@babel/types";
import { Declaration } from "./declarations";
import { parseScript, walk } from "./scriptSyntax";

export interface Source {
  path: string;
  importPath: string;
  stubModuleId: string;
  // The module Monaco is given for this source, which is not the generated one: its
  // services are consts a script calls, and its types carry no protobuf bookkeeping.
  text: string;
  serviceNames: string[];
  interfaces: string[];
  enums: { [key: string]: { object: any } };
  // The generated types this source declares, as a script reads them.
  declarations: { [name: string]: Declaration };
}

export type Sources = Source[];

export interface Stub {
  [key: string]: any;
}

// What protoc-gen-kaja says about the TypeScript it generated (kaja.manifest.json), so
// nothing here has to parse it back.
export interface Manifest {
  version: number;
  modules: ModuleManifest[];
}

export interface ModuleManifest {
  path: string;
  editorText: string;
  services: ServiceManifest[];
  interfaces: string[];
  enums: string[];
  declarations: Declaration[];
}

export interface ServiceManifest {
  name: string;
  typeName: string;
  clientModule: string;
  methods: MethodManifest[];
}

export interface MethodManifest {
  name: string;
  input: string;
  output: string;
  doc?: string;
  deprecated?: boolean;
}

export function parseManifest(text: string): Manifest {
  return text ? JSON.parse(text) : { version: 1, modules: [] };
}

// The stub names a module after its path, e.g. "basics/lib/enum.ts" -> "basics$lib$enum".
export function stubModuleId(path: string): string {
  return path.replace(".ts", "").replace(/\//g, "$").replace(/\./g, "$").replace(/-/g, "$");
}

export function loadSources(manifest: Manifest, stub: Stub, appName: string): Sources {
  return manifest.modules.map((module) => {
    const path = appName + "/" + module.path;
    const stubModule = stub[stubModuleId(module.path)] || {};
    const enums: Source["enums"] = {};
    for (const name of module.enums) {
      if (stubModule[name]) enums[name] = { object: stubModule[name] };
    }
    return {
      path,
      importPath: path.replace(".ts", ""),
      stubModuleId: stubModuleId(module.path),
      text: module.editorText,
      serviceNames: module.services.map((service) => service.name),
      interfaces: module.interfaces,
      enums,
      declarations: Object.fromEntries(module.declarations.map((declaration) => [declaration.name, declaration])),
    };
  });
}

export function remapSourcesToNewName(sources: Sources, oldName: string, newName: string): Sources {
  return sources.map((source) => {
    // Replace old app name prefix with new one
    const relativePath = source.path.slice(oldName.length + 1); // +1 for the "/"
    const newPath = newName + "/" + relativePath;
    const newImportPath = newPath.replace(".ts", "");

    return {
      ...source,
      path: newPath,
      importPath: newImportPath,
    };
  });
}

/**
 * Follow an app's rename into a script's imports. An import names the app by its bare
 * name, or by one of its module paths under it, so both are rewritten; a specifier that
 * merely starts with the same letters is not. Only the specifier is spliced, never the
 * text around it, so whatever the author wrote keeps its formatting.
 */
export function remapEditorCode(editorCode: string, oldName: string, newName: string): string {
  // A script mid-edit is left as it is, and its imports go red until it is fixed.
  const file = parseScript(editorCode);
  if (!file) return editorCode;
  const specifiers: StringLiteral[] = [];
  walk(file.program, (node) => {
    const specifier = moduleSpecifierOf(node);
    if (specifier && (specifier.value === oldName || specifier.value.startsWith(oldName + "/"))) {
      specifiers.push(specifier);
    }
  });

  let code = editorCode;
  // Back to front, so an earlier edit cannot move a later one's positions.
  for (const specifier of specifiers.reverse()) {
    const start = specifier.start!;
    const quote = code[start];
    code = code.slice(0, start) + quote + newName + specifier.value.slice(oldName.length) + quote + code.slice(specifier.end!);
  }
  return code;
}

// The module a node names, in each of the ways a script can name one.
function moduleSpecifierOf(node: Node): StringLiteral | undefined {
  if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") {
    return node.source ?? undefined;
  }
  if (node.type === "ImportExpression") {
    return node.source.type === "StringLiteral" ? node.source : undefined;
  }
  return undefined;
}

export function findEnum(sources: Sources, object: any): [string, Source] | undefined {
  for (const source of sources) {
    for (const enumName in source.enums) {
      if (source.enums[enumName].object === object) {
        return [enumName, source];
      }
    }
  }
}

// Find an export by name in the stub module corresponding to a source file
export function findInStub(stub: Stub, source: Source, name: string): any {
  const module = stub[source.stubModuleId];
  return module?.[name];
}

export async function parseStub(stubCode: string): Promise<Stub> {
  // Create a blob URL and dynamically import the stub JS
  const blob = new Blob([stubCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);

  const stub = await import(url);
  URL.revokeObjectURL(url);

  return stub;
}

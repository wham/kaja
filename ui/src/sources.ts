import type { Node, StringLiteral } from "@babel/types";
import type { JsonObject } from "@protobuf-ts/runtime";
import { Declaration } from "./declarations";
import type { Reflection } from "./protoReflection";
import { parseScript, walk } from "./scriptSyntax";

export interface Source {
  path: string;
  importPath: string;
  // The module Monaco is given for this source: its services are consts a script
  // calls, and its types carry no protobuf bookkeeping.
  text: string;
  serviceNames: string[];
  interfaces: string[];
  enums: { [key: string]: { object: any } };
  // The generated types this source declares, as a script reads them.
  declarations: { [name: string]: Declaration };
}

export type Sources = Source[];

// What an app compiles to (kaja.manifest.json, see protoc-gen-kaja/kaja/manifest.go).
// None of it is code: the runtime's types are built off the field descriptors.
export interface Manifest {
  version: number;
  modules: ModuleManifest[];
}

export interface ModuleManifest {
  path: string;
  editorText: string;
  messages: MessageManifest[];
  enums: EnumManifest[];
  services: ServiceManifest[];
  declarations: Declaration[];
}

export interface MessageManifest {
  name: string;
  typeName: string;
  fields: FieldManifest[];
  options?: JsonObject;
}

// A protobuf-ts PartialFieldInfo, naming a message or an enum by its type name.
export interface FieldManifest {
  no: number;
  name: string;
  kind: "scalar" | "message" | "enum" | "map";
  localName?: string;
  jsonName?: string;
  oneof?: string;
  opt?: boolean;
  repeat?: number;
  T?: number | string;
  L?: number;
  K?: number;
  V?: { kind: "scalar" | "message" | "enum"; T: number | string; L?: number };
  options?: JsonObject;
}

export interface EnumManifest {
  name: string;
  typeName: string;
  values: [string, number][];
  prefix?: string;
}

export interface ServiceManifest {
  name: string;
  typeName: string;
  methods: MethodManifest[];
  options?: JsonObject;
}

export interface MethodManifest {
  name: string;
  localName?: string;
  // The types as the module names them, and the type names they are looked up by.
  input: string;
  output: string;
  I: string;
  O: string;
  serverStreaming?: boolean;
  clientStreaming?: boolean;
  idempotency?: "NO_SIDE_EFFECTS" | "IDEMPOTENT";
  options?: JsonObject;
  doc?: string;
  deprecated?: boolean;
}

export function parseManifest(text: string): Manifest {
  return text ? JSON.parse(text) : { version: 2, modules: [] };
}

export function loadSources(manifest: Manifest, reflection: Reflection, appName: string): Sources {
  return manifest.modules.map((module) => {
    const path = appName + "/" + module.path;
    const enums: Source["enums"] = {};
    for (const e of module.enums) {
      const object = reflection.enums.get(e.typeName);
      if (object) enums[e.name] = { object };
    }
    return {
      path,
      importPath: path.replace(".ts", ""),
      text: module.editorText,
      serviceNames: module.services.map((service) => service.name),
      interfaces: module.messages.map((message) => message.name),
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

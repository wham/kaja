import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import { ServiceInfo } from "@protobuf-ts/runtime-rpc";
import type { CallExpression, File, Node, OptionalCallExpression } from "@babel/types";
import { App } from "./apps";
import { declaredValues } from "./declarations";
import { findInStub, Source } from "./sources";
import { isCall, keyName, memberAccess, nodePath, parseScript } from "./scriptSyntax";
import { recallValues, RememberedValue } from "./typeMemory";

// A scalar value position inside a request literal, resolved back to the proto
// field it fills in.
export interface ValuePosition {
  // Message type holding the field, e.g. "movies.v1.GetMovieRequest".
  typeName: string;
  fieldName: string;
  scalarType: ScalarType;
  // The values the API's own document declares for the field, empty where it
  // declares no closed set. Read from the field rather than remembered, so they
  // are offered on a field nobody has filled in yet.
  declared: string[];
  // Set when the cursor sits inside a string literal: the offsets of its
  // contents, so a suggestion replaces what is between the quotes.
  stringRange?: { start: number; end: number };
}

export interface ValueSuggestions {
  position: ValuePosition;
  values: RememberedValue[];
}

/**
 * What fits the field under the cursor — the values its API declares, and the values
 * seen in earlier calls — or undefined when the cursor isn't in a field's value.
 */
export function suggestValues(code: string, offset: number, apps: App[]): ValueSuggestions | undefined {
  const position = resolveValuePosition(code, offset, apps);
  if (!position) {
    return undefined;
  }

  // A declared value seen in an earlier call is the same value; the API saying so
  // is the better reason to offer it.
  const values = recallValues(position.typeName, position.fieldName, position.scalarType).filter(
    (remembered) => !position.declared.includes(String(remembered.value)),
  );
  if (values.length === 0 && position.declared.length === 0) {
    return undefined;
  }

  return { position, values };
}

export function resolveValuePosition(code: string, offset: number, apps: App[]): ValuePosition | undefined {
  const file = parseScript(code);
  if (!file) {
    return undefined;
  }

  const path = nodePath(file, offset);
  const enclosing = enclosingCall(path, offset);
  if (!enclosing) {
    return undefined;
  }

  const inputType = resolveInputType(file, enclosing.call, apps);
  if (!inputType) {
    return undefined;
  }

  const field = fieldAtPath(inputType, enclosing.path);
  if (!field) {
    return undefined;
  }

  const literal = path.at(-1);

  return {
    ...field,
    stringRange:
      literal?.type === "StringLiteral" && offset > literal.start! && offset < literal.end! ? { start: literal.start! + 1, end: literal.end! - 1 } : undefined,
  };
}

// Walk out of the node under the cursor to the call it is an argument of,
// collecting the property names passed on the way, e.g. ["movie", "title"].
function enclosingCall(nodes: Node[], offset: number): { call: CallExpression | OptionalCallExpression; path: string[] } | undefined {
  const path: string[] = [];

  for (let index = nodes.length - 1; index >= 0; index--) {
    const current = nodes[index];
    const child = nodes[index + 1];
    if (current.type === "ObjectProperty") {
      // The cursor has to be past the property name; sitting on the name itself
      // is a property completion, which TypeScript already handles.
      if (offset < current.key.end!) {
        return undefined;
      }
      path.unshift(current.computed ? "" : (keyName(current.key) ?? ""));
    } else if (isCall(current)) {
      if (path.length === 0 || !current.arguments.includes(child as never)) {
        return undefined;
      }
      return { call: current, path };
    }
  }

  return undefined;
}

// Resolve `SomeService.SomeMethod(...)` to the method's input message type. The
// service identifier is matched through its import so two apps declaring the
// same service name stay apart.
function resolveInputType(file: File, call: CallExpression | OptionalCallExpression, apps: App[]): IMessageType<any> | undefined {
  const callee = memberAccess(call.callee);
  if (!callee || callee.object.type !== "Identifier") {
    return undefined;
  }

  const serviceName = callee.object.name;
  const methodName = callee.name;
  const importPath = importPathOf(file, serviceName);

  const serviceInfo = findServiceInfo(apps, serviceName, importPath);
  if (!serviceInfo) {
    return undefined;
  }

  const method = serviceInfo.methods.find((candidate) => candidate.name.toLowerCase() === methodName.toLowerCase());

  return method?.I;
}

function importPathOf(file: File, localName: string): string | undefined {
  for (const statement of file.program.body) {
    if (statement.type !== "ImportDeclaration") {
      continue;
    }
    if (statement.specifiers.some((specifier) => specifier.type === "ImportSpecifier" && specifier.local.name === localName)) {
      return statement.source.value;
    }
  }
  return undefined;
}

function findServiceInfo(apps: App[], serviceName: string, importPath: string | undefined): ServiceInfo | undefined {
  const candidates: { app: App; source: Source }[] = [];

  for (const app of apps) {
    for (const source of app.sources) {
      if (!source.serviceNames.includes(serviceName)) {
        continue;
      }
      if (importPath === undefined || source.importPath === importPath) {
        candidates.push({ app, source });
      }
    }
  }

  for (const { app, source } of candidates) {
    const serviceInfo: ServiceInfo | undefined = findInStub(app.stub, source, serviceName);
    if (serviceInfo) {
      return serviceInfo;
    }
  }

  return undefined;
}

function fieldAtPath(
  messageType: IMessageType<any>,
  path: string[],
): { typeName: string; fieldName: string; scalarType: ScalarType; declared: string[] } | undefined {
  let current = messageType;

  for (let index = 0; index < path.length; index++) {
    const name = path[index];
    const field = current.fields.find((candidate) => candidate.localName === name || candidate.name === name);
    const last = index === path.length - 1;

    if (!field) {
      // A oneof is nested one level deeper than its members ({ kind: { oneofKind,
      // <member> } }), so the wrapper is not a field of its own.
      if (!last && current.fields.some((candidate) => candidate.oneof === name)) {
        continue;
      }
      return undefined;
    }

    if (field.kind === "scalar" && last) {
      return { typeName: current.typeName, fieldName: field.localName, scalarType: field.T, declared: declaredValues(field) };
    }

    // A map's entries are keyed by the map key, so the field is one level above
    // the value the cursor is in.
    if (field.kind === "map" && field.V.kind === "scalar" && index === path.length - 2) {
      return { typeName: current.typeName, fieldName: field.localName, scalarType: field.V.T, declared: [] };
    }

    if (field.kind !== "message") {
      return undefined;
    }

    current = field.T();
  }

  return undefined;
}

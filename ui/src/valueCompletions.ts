import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import { ServiceInfo } from "@protobuf-ts/runtime-rpc";
import ts from "typescript";
import { App } from "./apps";
import { findInStub, Source } from "./sources";
import { recallValues, RememberedValue } from "./typeMemory";

// A scalar value position inside a request literal, resolved back to the proto
// field it fills in.
export interface ValuePosition {
  // Message type holding the field, e.g. "movies.v1.GetMovieRequest".
  typeName: string;
  fieldName: string;
  scalarType: ScalarType;
  // Set when the cursor sits inside a string literal: the offsets of its
  // contents, so a suggestion replaces what is between the quotes.
  stringRange?: { start: number; end: number };
}

export interface ValueSuggestions {
  position: ValuePosition;
  values: RememberedValue[];
}

/**
 * Values seen in earlier calls that fit the field under the cursor, or
 * undefined when the cursor isn't in a field's value.
 */
export function suggestValues(code: string, offset: number, apps: App[]): ValueSuggestions | undefined {
  const position = resolveValuePosition(code, offset, apps);
  if (!position) {
    return undefined;
  }

  const values = recallValues(position.typeName, position.fieldName, position.scalarType);
  if (values.length === 0) {
    return undefined;
  }

  return { position, values };
}

export function resolveValuePosition(code: string, offset: number, apps: App[]): ValuePosition | undefined {
  const file = ts.createSourceFile("completion.ts", code, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS);

  const node = nodeAt(file, offset);
  if (!node) {
    return undefined;
  }

  const enclosing = enclosingCall(node, offset);
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

  const literal = stringLiteralAt(node, offset);

  return {
    ...field,
    stringRange: literal ? { start: literal.getStart(file) + 1, end: literal.getEnd() - 1 } : undefined,
  };
}

function nodeAt(file: ts.SourceFile, offset: number): ts.Node | undefined {
  let found: ts.Node | undefined = undefined;

  const visit = (node: ts.Node) => {
    if (offset < node.getStart(file) || offset > node.getEnd()) {
      return;
    }
    found = node;
    node.forEachChild(visit);
  };

  file.forEachChild(visit);

  return found;
}

function stringLiteralAt(node: ts.Node, offset: number): ts.StringLiteral | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isStringLiteral(current) && offset > current.getStart() && offset < current.getEnd()) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

// Walk out of the node under the cursor to the call it is an argument of,
// collecting the property names passed on the way, e.g. ["movie", "title"].
function enclosingCall(node: ts.Node, offset: number): { call: ts.CallExpression; path: string[] } | undefined {
  const path: string[] = [];
  let child: ts.Node = node;
  let current: ts.Node | undefined = node;

  while (current) {
    if (ts.isPropertyAssignment(current)) {
      // The cursor has to be past the property name; sitting on the name itself
      // is a property completion, which TypeScript already handles.
      if (offset < current.name.getEnd()) {
        return undefined;
      }
      path.unshift(propertyName(current));
    } else if (ts.isCallExpression(current)) {
      if (path.length === 0 || !current.arguments.includes(child as ts.Expression)) {
        return undefined;
      }
      return { call: current, path };
    }
    child = current;
    current = current.parent;
  }

  return undefined;
}

function propertyName(property: ts.PropertyAssignment): string {
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return "";
}

// Resolve `SomeService.SomeMethod(...)` to the method's input message type. The
// service identifier is matched through its import so two apps declaring the
// same service name stay apart.
function resolveInputType(file: ts.SourceFile, call: ts.CallExpression, apps: App[]): IMessageType<any> | undefined {
  if (!ts.isPropertyAccessExpression(call.expression) || !ts.isIdentifier(call.expression.expression)) {
    return undefined;
  }

  const serviceName = call.expression.expression.text;
  const methodName = call.expression.name.text;
  const importPath = importPathOf(file, serviceName);

  const serviceInfo = findServiceInfo(apps, serviceName, importPath);
  if (!serviceInfo) {
    return undefined;
  }

  const method = serviceInfo.methods.find((candidate) => candidate.name.toLowerCase() === methodName.toLowerCase());

  return method?.I;
}

function importPathOf(file: ts.SourceFile, localName: string): string | undefined {
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }
    if (bindings.elements.some((element) => element.name.text === localName)) {
      return statement.moduleSpecifier.text;
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

function fieldAtPath(messageType: IMessageType<any>, path: string[]): { typeName: string; fieldName: string; scalarType: ScalarType } | undefined {
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
      return { typeName: current.typeName, fieldName: field.localName, scalarType: field.T };
    }

    // A map's entries are keyed by the map key, so the field is one level above
    // the value the cursor is in.
    if (field.kind === "map" && field.V.kind === "scalar" && index === path.length - 2) {
      return { typeName: current.typeName, fieldName: field.localName, scalarType: field.V.T };
    }

    if (field.kind !== "message") {
      return undefined;
    }

    current = field.T();
  }

  return undefined;
}

import { EnumInfo, FieldInfo, IMessageType, ScalarType } from "@protobuf-ts/runtime";
import ts from "typescript";
import { findEnum, Source, Sources } from "./sources";

// google.protobuf.Value holds arbitrary JSON through a "kind" oneof, and an
// OpenAPI spec's free-form properties are generated as one. It has no fillable
// default: leaving the oneof unset is rejected on send ("none of the oneof
// fields is set" from the JSON encoder), and picking a member would invent a
// value. So, like a recursive type, it is left out of the generated request
// rather than placed there only to fail.
const unfillable = "google.protobuf.Value";

// omitMessage reports whether a message type has no default worth generating:
// either it is unfillable, or it is already on the recursion path.
function omitMessage(typeName: string, visiting: Set<string>): boolean {
  return typeName === unfillable || visiting.has(typeName);
}

export function defaultMessage<T extends object>(
  message: IMessageType<T>,
  sources: Sources,
  imports: Imports,
  visiting: Set<string> = new Set(),
): ts.ObjectLiteralExpression {
  const typeName = message.typeName;

  // Special case for Timestamp - default to current time
  if (typeName === "google.protobuf.Timestamp") {
    const now = new Date();
    const seconds = Math.floor(now.getTime() / 1000);
    const nanos = (now.getTime() % 1000) * 1_000_000;
    return ts.factory.createObjectLiteralExpression([
      ts.factory.createPropertyAssignment("seconds", ts.factory.createStringLiteral(seconds.toString())),
      ts.factory.createPropertyAssignment("nanos", ts.factory.createNumericLiteral(nanos)),
    ]);
  }

  let properties: ts.PropertyAssignment[] = [];

  // Track the message types on the current recursion path so a self-referential
  // message (e.g. a recursive filter/expression type from an OpenAPI spec) stops
  // instead of recursing until the stack overflows.
  const nested = new Set(visiting).add(typeName);
  const oneofs = new Set<string>();

  message.fields.forEach((field) => {
    // A oneof's members live under a single `{ oneofKind, <member> }` property,
    // so emitting them as fields would be both a type error and, since the group
    // itself would then be missing, a serialization crash. It is generated once,
    // empty: which member to set is the caller's choice.
    if (field.oneof) {
      if (!oneofs.has(field.oneof)) {
        oneofs.add(field.oneof);
        properties.push(
          ts.factory.createPropertyAssignment(
            field.oneof,
            ts.factory.createObjectLiteralExpression([ts.factory.createPropertyAssignment("oneofKind", ts.factory.createIdentifier("undefined"))]),
          ),
        );
      }
      return;
    }

    // A field with no default worth generating — an unfillable type, or a
    // message type already on the current path, which can't be filled in without
    // recursing forever — is left out: a repeated field defaults to an empty
    // array and a singular (optional) field is omitted entirely, so the generated
    // code stays type-correct instead of holding a placeholder that can't be sent.
    if (field.kind === "message" && omitMessage(field.T().typeName, nested)) {
      if (field.repeat) {
        properties.push(ts.factory.createPropertyAssignment(field.localName, ts.factory.createArrayLiteralExpression([])));
      }
      return;
    }

    let value: ts.Expression;

    if (field.repeat) {
      // A repeated scalar defaults to an empty array. A single placeholder element
      // (e.g. [""] or [0]) is sent verbatim as an invalid value, and for request
      // bodies that accept at most one of several array-valued operators it also
      // makes multiple operators look "set". Repeated message and enum fields keep
      // one element: there the element carries a nested shape or a concrete valid
      // value that the field name alone doesn't convey.
      const elements = field.kind === "scalar" ? [] : [defaultMessageField(field, sources, imports, nested)];
      value = ts.factory.createArrayLiteralExpression(elements);
    } else {
      value = defaultMessageField(field, sources, imports, nested);
    }

    properties.push(ts.factory.createPropertyAssignment(field.localName, value));
  });

  return ts.factory.createObjectLiteralExpression(properties);
}

export interface Imports {
  [key: string]: Set<string>;
}

export function addImport(imports: Imports, name: string, source: Source): Imports {
  const path = source.importPath;

  if (!imports[path]) {
    imports[path] = new Set();
  }

  imports[path].add(name);

  return imports;
}

function defaultMessageField(field: FieldInfo, sources: Sources, imports: Imports, visiting: Set<string>): ts.Expression {
  // Scalars start at their zero value. Values from earlier calls are offered as
  // editor completions instead (see valueCompletions), so what is generated
  // here is only ever the shape of the request, never a guess at its contents.
  if (field.kind === "scalar") {
    return defaultScalar(field.T);
  }

  if (field.kind === "map") {
    // An empty map is valid, so a value type with no default worth generating
    // leaves the map empty rather than holding an entry that can't be sent.
    if (field.V.kind === "message" && omitMessage(field.V.T().typeName, visiting)) {
      return ts.factory.createObjectLiteralExpression([]);
    }
    const properties: ts.PropertyAssignment[] = [];
    properties.push(ts.factory.createPropertyAssignment(defaultMapKey(field.K), defaultMapValue(field.V, sources, imports, visiting)));

    return ts.factory.createObjectLiteralExpression(properties);
  }

  if (field.kind === "enum") {
    return defaultEnum(field.T(), sources, imports);
  }

  if (field.kind === "message") {
    // For nested message types, recurse with the nested type name
    return defaultMessage(field.T(), sources, imports, visiting);
  }

  return ts.factory.createNull();
}

function defaultScalar(value: ScalarType): ts.Expression {
  // 64-bit integer types are represented as strings
  switch (value) {
    case ScalarType.INT64:
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      return ts.factory.createStringLiteral("0");
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
    case ScalarType.INT32:
    case ScalarType.FIXED32:
    case ScalarType.UINT32:
    case ScalarType.SFIXED32:
    case ScalarType.SINT32:
      return ts.factory.createNumericLiteral(0);
    case ScalarType.BOOL:
      return ts.factory.createTrue();
    case ScalarType.BYTES:
      return ts.factory.createNewExpression(ts.factory.createIdentifier("Uint8Array"), undefined, []);
  }

  return ts.factory.createStringLiteral("");
}

type mapKeyType = Exclude<ScalarType, ScalarType.FLOAT | ScalarType.DOUBLE | ScalarType.BYTES>;

function defaultMapKey(key: mapKeyType): string {
  switch (key) {
    case ScalarType.INT64:
    case ScalarType.UINT64:
    case ScalarType.INT32:
    case ScalarType.FIXED64:
    case ScalarType.FIXED32:
    case ScalarType.UINT32:
    case ScalarType.SFIXED32:
    case ScalarType.SFIXED64:
    case ScalarType.SINT32:
    case ScalarType.SINT64:
      return "0";
    case ScalarType.BOOL:
      return "true";
  }

  return "key";
}

type mapValueType =
  | {
      kind: "scalar";
      T: ScalarType;
    }
  | {
      kind: "enum";
      T: () => EnumInfo;
    }
  | {
      kind: "message";
      T: () => IMessageType<any>;
    };

function defaultMapValue(value: mapValueType, sources: Sources, imports: Imports, visiting: Set<string>): ts.Expression {
  switch (value.kind) {
    case "scalar":
      return defaultScalar(value.T);
    case "enum":
      return defaultEnum(value.T(), sources, imports);
    case "message":
      return defaultMessage(value.T(), sources, imports, visiting);
  }
}

function defaultEnum(value: EnumInfo, sources: Sources, imports: Imports): ts.Expression {
  const result = findEnum(sources, value[1]);

  if (!result) {
    throw new Error(`Enum not found: ${value[0]}`);
  }

  const [enumName, source] = result;
  addImport(imports, enumName, source);

  // If the enum has more than one value, use the second one. The first one is usually the "unspecified" value that the API will reject.
  const enumValue = value[1][1] || value[1][0];

  return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(enumName), ts.factory.createIdentifier(enumValue));
}

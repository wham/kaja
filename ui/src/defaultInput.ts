import { EnumInfo, FieldInfo, IMessageType, ScalarType } from "@protobuf-ts/runtime";
import ts from "typescript";
import { findEnum, Source, Sources } from "./sources";
import { getScalarMemorizedValue, getMessageMemorizedValue } from "./typeMemory";

export function defaultMessage<T extends object>(message: IMessageType<T>, sources: Sources, imports: Imports): ts.ObjectLiteralExpression {
  let properties: ts.PropertyAssignment[] = [];

  const typeName = message.typeName;

  message.fields.forEach((field) => {
    let value = defaultMessageField(field, sources, imports, typeName);

    if (field.repeat) {
      const arrayValue = defaultMessageField(field, sources, imports, typeName);
      value = ts.factory.createArrayLiteralExpression([arrayValue]);
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

function defaultMessageField(field: FieldInfo, sources: Sources, imports: Imports, parentTypeName?: string): ts.Expression {
  // For scalar fields, try to get memorized value
  if (field.kind === "scalar") {
    // First check type memory (more specific - values seen in this exact type)
    if (parentTypeName) {
      const typeMemorized = getMessageMemorizedValue(parentTypeName, field.localName);
      if (typeMemorized !== undefined) {
        return valueToExpression(typeMemorized);
      }
    }
    // Fall back to scalar memory (broader - any field with this name and protobuf type)
    const memorized = getScalarMemorizedValue(field.localName, field.T);
    if (memorized !== undefined) {
      return valueToExpression(memorized);
    }
    return defaultScalar(field.T);
  }

  if (field.kind === "map") {
    const properties: ts.PropertyAssignment[] = [];
    properties.push(ts.factory.createPropertyAssignment(defaultMapKey(field.K), defaultMapValue(field.V, sources, imports)));

    return ts.factory.createObjectLiteralExpression(properties);
  }

  if (field.kind === "enum") {
    return defaultEnum(field.T(), sources, imports);
  }

  if (field.kind === "message") {
    const messageType = field.T();
    // Special case for Timestamp - default to current time
    if (messageType.typeName === "google.protobuf.Timestamp") {
      const now = new Date();
      const seconds = Math.floor(now.getTime() / 1000);
      const nanos = (now.getTime() % 1000) * 1_000_000;
      return ts.factory.createObjectLiteralExpression([
        ts.factory.createPropertyAssignment("seconds", ts.factory.createStringLiteral(seconds.toString())),
        ts.factory.createPropertyAssignment("nanos", ts.factory.createNumericLiteral(nanos)),
      ]);
    }
    // For nested message types, recurse with the nested type name
    return defaultMessage(messageType, sources, imports);
  }

  return ts.factory.createNull();
}

function valueToExpression(value: any): ts.Expression {
  if (typeof value === "string") {
    return ts.factory.createStringLiteral(value);
  }
  if (typeof value === "number") {
    if (value < 0) {
      return ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, ts.factory.createNumericLiteral(Math.abs(value)));
    }
    return ts.factory.createNumericLiteral(value);
  }
  if (typeof value === "boolean") {
    return value ? ts.factory.createTrue() : ts.factory.createFalse();
  }
  return ts.factory.createNull();
}

function defaultScalar(value: ScalarType): ts.Expression {
  // 64-bit integer types are represented as strings (with long_type_string option)
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

function defaultMapValue(value: mapValueType, sources: Sources, imports: Imports): ts.Expression {
  switch (value.kind) {
    case "scalar":
      return defaultScalar(value.T);
    case "enum":
      return defaultEnum(value.T(), sources, imports);
    case "message":
      return defaultMessage(value.T(), sources, imports);
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

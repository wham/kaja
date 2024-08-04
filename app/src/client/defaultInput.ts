import { EnumInfo, FieldInfo, IMessageType, LongType, ScalarType } from "@protobuf-ts/runtime";
import ts from "typescript";
import { findEnum, Sources } from "./sources";

export function defaultMessage<T extends object>(message: IMessageType<T>, enumNames: string[], sources: Sources): ts.ObjectLiteralExpression {
  let properties: ts.PropertyAssignment[] = [];

  message.fields.forEach((field) => {
    const value = field.repeat
      ? ts.factory.createArrayLiteralExpression([defaultMessageField(field, enumNames, sources)])
      : defaultMessageField(field, enumNames, sources);

    properties.push(ts.factory.createPropertyAssignment(field.localName, value));
  });

  return ts.factory.createObjectLiteralExpression(properties);
}

function defaultMessageField(field: FieldInfo, enumNames: string[], sources: Sources): ts.Expression {
  if (field.kind === "scalar") {
    return defaultScalar(field.T, field.L);
  }

  if (field.kind === "map") {
    const properties: ts.PropertyAssignment[] = [];
    properties.push(ts.factory.createPropertyAssignment(defaultMapKey(field.K), defaultMapValue(field.V, enumNames, sources)));

    return ts.factory.createObjectLiteralExpression(properties);
  }

  if (field.kind === "enum") {
    return defaultEnum(field.T(), enumNames, sources);
  }

  if (field.kind === "message") {
    return defaultMessage(field.T(), enumNames, sources);
  }

  return ts.factory.createNull();
}

function defaultScalar(value: ScalarType, long?: LongType): ts.TrueLiteral | ts.NumericLiteral | ts.StringLiteral | ts.BigIntLiteral {
  switch (value) {
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
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
      if (long === LongType.BIGINT) {
        return ts.factory.createBigIntLiteral("0n");
      }
      return ts.factory.createNumericLiteral(0);
    case ScalarType.BOOL:
      return ts.factory.createTrue();
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
      L?: LongType;
    }
  | {
      kind: "enum";
      T: () => EnumInfo;
    }
  | {
      kind: "message";
      T: () => IMessageType<any>;
    };

function defaultMapValue(value: mapValueType, enumNames: string[], sources: Sources): ts.Expression {
  switch (value.kind) {
    case "scalar":
      return defaultScalar(value.T, value.L);
    case "enum":
      return defaultEnum(value.T(), enumNames, sources);
    case "message":
      return defaultMessage(value.T(), enumNames, sources);
  }
}

function defaultEnum(value: EnumInfo, enumNames: string[], sources: Sources): ts.Expression {
  let enumName = value[0];
  // Temp hack to quirks.v1.RepeatedRequest.Enum -> RepeatedRequest_Enum
  // Won't work with any real projects
  /*const nameParts = value[0].split(".");
  while (nameParts.length > 0) {
    enumName = nameParts.join("_");
    if (enumNames.includes(enumName)) {
      break;
    }
    nameParts.shift();
  }*/
  const result = findEnum(sources, value[1]);

  if (!result) {
    throw new Error(`Enum not found: ${value[0]}`);
    // return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(enumName), ts.factory.createIdentifier(value[1][0]));
  }

  const [enumDeclaration, source] = result;

  return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(enumDeclaration.name.text), ts.factory.createIdentifier(value[1][0]));
}

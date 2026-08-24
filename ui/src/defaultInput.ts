import { EnumInfo, FieldInfo, IMessageType, ScalarType } from "@protobuf-ts/runtime";
import ts from "typescript";
import { HTTP_REQUIRED_OPTION } from "./declarations";
import { findEnum, Source, Sources } from "./sources";

// How much of a message a generated call writes out. `all` is the whole shape, which
// is what clicking a method in the tree is for: the generated call is where a person
// meets the request, and a field they never see is a field they never send. `required`
// is the same call with everything the API doesn't insist on left out — an omitted
// field is sent as its zero value, so the two calls send the same request, and a reader
// who already has the declarations in front of them is only slowed down by a page of
// `""` and `0`. That reader is an agent, which is handed the declarations of every type
// a method names before it is handed the call.
export type FieldSet = "all" | "required";

// A field is required only where the app said so (see
// server/pkg/apps/openapi/http.proto). Nothing in a proto is, so a gRPC or Twirp
// method's `required` call is `{}` — its declarations are the whole of what it takes.
function writesField(field: FieldInfo, fields: FieldSet): boolean {
  return fields === "all" || field.options?.[HTTP_REQUIRED_OPTION] === true;
}

// google.protobuf.Value and friends hold arbitrary JSON through a "kind" oneof, and
// an OpenAPI spec's free-form properties are generated as them. Written by hand they
// have no fillable default — leaving the oneof unset is rejected on send, and picking
// a member means writing out the encoding — so the kaja builders are the default they
// were missing. Being in the generated code is also the only place the builder can be
// learned, since the field is otherwise absent from everything a caller reads.
const wellKnownBuilders: { [typeName: string]: string } = {
  "google.protobuf.Value": "value",
  "google.protobuf.Struct": "struct",
  "google.protobuf.ListValue": "listValue",
};

const wellKnownArguments: { [typeName: string]: () => ts.Expression } = {
  "google.protobuf.Value": () => ts.factory.createNull(),
  "google.protobuf.Struct": () => ts.factory.createObjectLiteralExpression([]),
  "google.protobuf.ListValue": () => ts.factory.createArrayLiteralExpression([]),
};

// kajaBuilderCall writes `kaja.value(null)` for a well-known JSON type, and records
// the import the call needs.
function kajaBuilderCall(typeName: string, imports: Imports): ts.Expression | undefined {
  const builder = wellKnownBuilders[typeName];
  if (!builder) {
    return undefined;
  }
  if (!imports[KAJA_MODULE]) {
    imports[KAJA_MODULE] = new Set();
  }
  imports[KAJA_MODULE].add("kaja");
  return ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("kaja"), ts.factory.createIdentifier(builder)),
    undefined,
    [wellKnownArguments[typeName]()],
  );
}

// The module the kaja runtime object is imported from, which the task runner resolves
// without looking at any app.
export const KAJA_MODULE = "kaja";

// omitMessage reports whether a message type has no default worth generating, which
// now only happens on the recursion path.
function omitMessage(typeName: string, visiting: Set<string>): boolean {
  return visiting.has(typeName);
}

export function defaultMessage<T extends object>(
  message: IMessageType<T>,
  sources: Sources,
  imports: Imports,
  visiting: Set<string> = new Set(),
  fields: FieldSet = "all",
): ts.ObjectLiteralExpression {
  const typeName = message.typeName;

  // Timestamp defaults to the current time.
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

  // Track the message types on the current recursion path so a self-referential message
  // stops instead of recursing until the stack overflows.
  const nested = new Set(visiting).add(typeName);
  const oneofs = new Set<string>();

  message.fields.forEach((field) => {
    if (!writesField(field, fields)) {
      return;
    }

    // A oneof's members live under a single `{ oneofKind, <member> }` property, so
    // emitting them as fields would be both a type error and, since the group itself would
    // then be missing, a serialization crash. It is generated once, empty.
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

    // A message type already on the current path can't be filled in without recursing
    // forever, so it is left out: a repeated field defaults to an empty array and a
    // singular one is omitted, so the generated code stays type-correct.
    if (field.kind === "message" && omitMessage(field.T().typeName, nested)) {
      if (field.repeat) {
        properties.push(ts.factory.createPropertyAssignment(field.localName, ts.factory.createArrayLiteralExpression([])));
      }
      return;
    }

    let value: ts.Expression;

    if (field.repeat) {
      // A repeated scalar defaults to an empty array: a single placeholder element ([""] or
      // [0]) is sent verbatim as an invalid value, and for bodies that accept at most one of
      // several array-valued operators it also makes multiple operators look "set". Repeated
      // message and enum fields keep one element, which carries a nested shape or a concrete
      // valid value the field name alone doesn't convey.
      const elements = field.kind === "scalar" ? [] : [defaultMessageField(field, sources, imports, nested, fields)];
      value = ts.factory.createArrayLiteralExpression(elements);
    } else {
      value = defaultMessageField(field, sources, imports, nested, fields);
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

function defaultMessageField(field: FieldInfo, sources: Sources, imports: Imports, visiting: Set<string>, fields: FieldSet): ts.Expression {
  // Scalars start at their zero value. Values from earlier calls are offered as editor
  // completions instead (valueCompletions), so what is generated here is only ever the
  // shape of the request, never a guess at its contents.
  if (field.kind === "scalar") {
    return defaultScalar(field.T);
  }

  if (field.kind === "map") {
    // An empty map is valid, so a value type with no default worth generating leaves the
    // map empty rather than holding an entry that can't be sent.
    if (field.V.kind === "message" && omitMessage(field.V.T().typeName, visiting)) {
      return ts.factory.createObjectLiteralExpression([]);
    }
    const properties: ts.PropertyAssignment[] = [];
    properties.push(ts.factory.createPropertyAssignment(defaultMapKey(field.K), defaultMapValue(field.V, sources, imports, visiting, fields)));

    return ts.factory.createObjectLiteralExpression(properties);
  }

  if (field.kind === "enum") {
    return defaultEnum(field.T(), sources, imports);
  }

  if (field.kind === "message") {
    const builder = kajaBuilderCall(field.T().typeName, imports);
    if (builder) {
      return builder;
    }
    return defaultMessage(field.T(), sources, imports, visiting, fields);
  }

  return ts.factory.createNull();
}

function defaultScalar(value: ScalarType): ts.Expression {
  // 64-bit integer types are represented as strings.
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

function defaultMapValue(value: mapValueType, sources: Sources, imports: Imports, visiting: Set<string>, fields: FieldSet): ts.Expression {
  switch (value.kind) {
    case "scalar":
      return defaultScalar(value.T);
    case "enum":
      return defaultEnum(value.T(), sources, imports);
    case "message":
      return kajaBuilderCall(value.T().typeName, imports) ?? defaultMessage(value.T(), sources, imports, visiting, fields);
  }
}

function defaultEnum(value: EnumInfo, sources: Sources, imports: Imports): ts.Expression {
  const result = findEnum(sources, value[1]);

  if (!result) {
    throw new Error(`Enum not found: ${value[0]}`);
  }

  const [enumName, source] = result;
  addImport(imports, enumName, source);

  // The second value, where there is one: the first is usually the "unspecified" value
  // the API will reject.
  const enumValue = value[1][1] || value[1][0];

  return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(enumName), ts.factory.createIdentifier(enumValue));
}

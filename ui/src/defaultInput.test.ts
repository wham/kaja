import { MessageType } from "@protobuf-ts/runtime";
import { expect, test } from "bun:test";
import { defaultMessage, Imports } from "./defaultInput";
import { Kaja } from "./kaja";
import { printStatements } from "./appLoader";
import ts from "typescript";
import { Sources } from "./sources";

test("defaultInput", () => {
  const I = new MessageType("quirks.v1.MapRequest", [
    { no: 1, name: "string_string", kind: "map", K: 9 /*ScalarType.STRING*/, V: { kind: "scalar", T: 9 /*ScalarType.STRING*/ } },
    { no: 2, name: "string_int32", kind: "map", K: 9 /*ScalarType.STRING*/, V: { kind: "scalar", T: 5 /*ScalarType.INT32*/ } },
    { no: 3, name: "sint64_string", kind: "map", K: 18 /*ScalarType.SINT64*/, V: { kind: "scalar", T: 9 /*ScalarType.STRING*/ } },
  ]);

  // expect(printStatements([defaultInput(I)])).toBe({});
});

// A self-referential message (as generated for recursive OpenAPI schemas such as
// filter/expression types) must terminate and still produce valid code:
// a repeated self-reference defaults to an empty array, a singular one is omitted.
test("defaultInput terminates on self-referential message with valid output", () => {
  const filter: MessageType<any> = new MessageType("openapi.demo.Filter", [
    { no: 1, name: "field", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
    { no: 2, name: "and", kind: "message", repeat: 2 /*RepeatType.UNPACKED*/, T: () => filter },
    { no: 3, name: "not", kind: "message", T: () => filter },
  ]);

  const sources: Sources = [];
  const expr = printStatements([ts.factory.createExpressionStatement(defaultMessage(filter, sources, {}))]);

  // The repeated self-reference becomes an empty array, not an unfillable element.
  expect(expr).toContain("field:");
  expect(expr).toContain("and: []");
  // The singular self-reference is optional in the generated type, so it is omitted.
  expect(expr).not.toContain("not:");
});

// A repeated scalar defaults to an empty array, not a placeholder element like
// [""]: that placeholder would be sent verbatim as an invalid value. Repeated
// message and enum fields keep one element, where it carries real structure.
test("defaultInput uses empty arrays for repeated scalars, one element for messages", () => {
  const item: MessageType<any> = new MessageType("openapi.demo.Item", [{ no: 1, name: "name", kind: "scalar", T: 9 /*ScalarType.STRING*/ }]);
  const request: MessageType<any> = new MessageType("openapi.demo.Request", [
    { no: 1, name: "ids", kind: "scalar", repeat: 2 /*RepeatType.UNPACKED*/, T: 9 /*ScalarType.STRING*/ },
    { no: 2, name: "items", kind: "message", repeat: 2 /*RepeatType.UNPACKED*/, T: () => item },
  ]);

  const sources: Sources = [];
  const expr = printStatements([ts.factory.createExpressionStatement(defaultMessage(request, sources, {}))]);

  // Repeated scalar: empty array, no placeholder element.
  expect(expr).toContain("ids: []");
  // Repeated message: one element revealing the nested shape.
  expect(expr).toContain("name:");
});

const anyValue = (): MessageType<any> =>
  new MessageType("google.protobuf.Value", [
    { no: 1, name: "null_value", kind: "enum", oneof: "kind", T: () => ["google.protobuf.NullValue", {}] },
    { no: 3, name: "string_value", kind: "scalar", oneof: "kind", T: 9 /*ScalarType.STRING*/ },
    { no: 4, name: "bool_value", kind: "scalar", oneof: "kind", T: 8 /*ScalarType.BOOL*/ },
  ]);

// google.protobuf.Value (used for free-form / polymorphic OpenAPI fields) can't
// be written out by hand: its "kind" oneof can neither be flattened into fields
// (not a valid shape) nor left unset (the JSON encoder rejects it on send). The
// kaja builder is what a caller writes instead, and the generated request is the
// only place it can be learned — the field appears nowhere else a caller reads.
test("defaultInput builds a google.protobuf.Value field with kaja.value", () => {
  const request: MessageType<any> = new MessageType("openapi.demo.Request", [
    { no: 1, name: "id", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
    { no: 2, name: "data", kind: "message", T: anyValue },
    { no: 3, name: "values", kind: "message", repeat: 2 /*RepeatType.UNPACKED*/, T: anyValue },
  ]);

  const sources: Sources = [];
  const imports: Imports = {};
  const expr = printStatements([ts.factory.createExpressionStatement(defaultMessage(request, sources, imports))]);

  expect(expr).toContain("id:");
  expect(expr).toContain("data: kaja.value(null)");
  expect(expr).toContain("values: [kaja.value(null)]");
  // The encoding stays out of it: no hand-written oneof members.
  expect(expr).not.toContain("stringValue");
  expect(expr).not.toContain("oneofKind");
  // The call needs an import, so the generated code runs as it stands.
  expect([...(imports["kaja"] ?? [])]).toEqual(["kaja"]);
});

// A free-form OpenAPI object becomes map<string, google.protobuf.Value>. The
// entry shows the builder the values are written with.
test("defaultInput builds a map of google.protobuf.Value with kaja.value", () => {
  const request: MessageType<any> = new MessageType("openapi.demo.Request", [
    { no: 1, name: "schema_fields", kind: "map", K: 9 /*ScalarType.STRING*/, V: { kind: "message", T: anyValue } },
  ]);

  const sources: Sources = [];
  const expr = printStatements([ts.factory.createExpressionStatement(defaultMessage(request, sources, {}))]);

  expect(expr).toContain("schemaFields: { key: kaja.value(null) }");
});

// A oneof of any kind is a single { oneofKind, <member> } property: its members
// are never fields of their own.
test("defaultInput renders a oneof as a single empty group", () => {
  const request: MessageType<any> = new MessageType("demo.Request", [
    { no: 1, name: "id", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
    { no: 2, name: "by_name", kind: "scalar", oneof: "selector", T: 9 /*ScalarType.STRING*/ },
    { no: 3, name: "by_index", kind: "scalar", oneof: "selector", T: 5 /*ScalarType.INT32*/ },
  ]);

  const sources: Sources = [];
  const expr = printStatements([ts.factory.createExpressionStatement(defaultMessage(request, sources, {}))]);

  expect(expr).toContain("id:");
  expect(expr).toContain("selector: { oneofKind: undefined }");
  expect(expr).not.toContain("byName");
  expect(expr).not.toContain("byIndex");
});

// The point of the shape: a generated request has to survive the serializer.
// A flattened oneof leaves the group itself missing, and protobuf-ts fails on
// it with an error that names neither the field nor the request.
test("defaultInput generates a request that serializes", () => {
  const selector: MessageType<any> = new MessageType("demo.Selector", [
    { no: 1, name: "by_name", kind: "scalar", oneof: "target", T: 9 /*ScalarType.STRING*/ },
    { no: 2, name: "by_index", kind: "scalar", oneof: "target", T: 5 /*ScalarType.INT32*/ },
  ]);
  const request: MessageType<any> = new MessageType("openapi.demo.Request", [
    { no: 1, name: "page_size", kind: "scalar", T: 5 /*ScalarType.INT32*/ },
    { no: 2, name: "selector", kind: "message", T: () => selector },
    { no: 3, name: "schema_fields", kind: "map", K: 9 /*ScalarType.STRING*/, V: { kind: "message", T: anyValue } },
  ]);

  const sources: Sources = [];
  const expr = printStatements([ts.factory.createExpressionStatement(defaultMessage(request, sources, {}))]);
  // The generated code calls the kaja builders, which a script gets from the
  // runtime object; supply the real one so what is serialized is what a run sends.
  const generated = new Function("kaja", `return ${expr.replace(/;\s*$/, "")}`)(
    new Kaja(
      () => {},
      async () => "",
      async () => "approved" as const,
      () => {},
    ),
  );

  expect(() => request.toBinary(generated)).not.toThrow();
});

// The Timestamp default applies wherever a Timestamp appears, including as a
// map value.
test("defaultInput fills in a Timestamp map value", () => {
  const timestamp: MessageType<any> = new MessageType("google.protobuf.Timestamp", [
    { no: 1, name: "seconds", kind: "scalar", T: 3 /*ScalarType.INT64*/ },
    { no: 2, name: "nanos", kind: "scalar", T: 5 /*ScalarType.INT32*/ },
  ]);
  const request: MessageType<any> = new MessageType("demo.Request", [
    { no: 1, name: "seen_at", kind: "map", K: 9 /*ScalarType.STRING*/, V: { kind: "message", T: () => timestamp } },
  ]);

  const sources: Sources = [];
  const expr = printStatements([ts.factory.createExpressionStatement(defaultMessage(request, sources, {}))]);

  expect(expr).toContain("seconds:");
  expect(expr).toContain("nanos:");
  // The current time, not the "0"/0 the generic recursion would produce.
  expect(expr).not.toContain('seconds: "0"');
});

// A cycle across two messages (A -> B -> A) must also terminate.
test("defaultInput terminates on mutually recursive messages", () => {
  const a: MessageType<any> = new MessageType("openapi.demo.A", [{ no: 1, name: "b", kind: "message", T: () => b }]);
  const b: MessageType<any> = new MessageType("openapi.demo.B", [{ no: 1, name: "a", kind: "message", T: () => a }]);

  const sources: Sources = [];
  expect(() => defaultMessage(a, sources, {})).not.toThrow();
});

// A map whose value type is self-referential defaults to an empty map.
test("defaultInput terminates on recursive map value", () => {
  const node: MessageType<any> = new MessageType("openapi.demo.Node", [
    { no: 1, name: "children", kind: "map", K: 9 /*ScalarType.STRING*/, V: { kind: "message", T: () => node } },
  ]);

  const sources: Sources = [];
  const expr = printStatements([ts.factory.createExpressionStatement(defaultMessage(node, sources, {}))]);

  expect(expr).toContain("children: {}");
});

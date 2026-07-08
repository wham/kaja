import { MessageType } from "@protobuf-ts/runtime";
import { expect, test } from "bun:test";
import { defaultMessage } from "./defaultInput";
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

// google.protobuf.Value (used for free-form / polymorphic OpenAPI fields) must
// not recurse into its "kind" oneof — that would emit every member at once, an
// invalid shape. It renders as an empty, editable placeholder instead.
test("defaultInput renders google.protobuf.Value as an empty placeholder", () => {
  const value: MessageType<any> = new MessageType("google.protobuf.Value", [
    { no: 1, name: "null_value", kind: "enum", oneof: "kind", T: () => ["google.protobuf.NullValue", {}] },
    { no: 3, name: "string_value", kind: "scalar", oneof: "kind", T: 9 /*ScalarType.STRING*/ },
    { no: 4, name: "bool_value", kind: "scalar", oneof: "kind", T: 8 /*ScalarType.BOOL*/ },
  ]);
  const request: MessageType<any> = new MessageType("openapi.demo.Request", [{ no: 1, name: "data", kind: "message", T: () => value }]);

  const sources: Sources = [];
  const expr = printStatements([ts.factory.createExpressionStatement(defaultMessage(request, sources, {}))]);

  expect(expr).toContain("kind: { oneofKind: undefined }");
  // No flat oneof members leaked out.
  expect(expr).not.toContain("stringValue");
  expect(expr).not.toContain("boolValue");
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

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

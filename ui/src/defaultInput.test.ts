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
// OpenMeter's filter/expression types) must not recurse until the stack overflows.
test("defaultInput terminates on self-referential message", () => {
  const filter: MessageType<any> = new MessageType("openapi.demo.Filter", [
    { no: 1, name: "field", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
    { no: 2, name: "and", kind: "message", repeat: 2 /*RepeatType.UNPACKED*/, T: () => filter },
  ]);

  const sources: Sources = [];
  const expr = printStatements([ts.factory.createExpressionStatement(defaultMessage(filter, sources, {}))]);

  // The nested "and" element stops at an empty object literal instead of recursing.
  expect(expr).toContain("field:");
  expect(expr).toContain("and: [{}]");
});

// A cycle across two messages (A -> B -> A) must also terminate.
test("defaultInput terminates on mutually recursive messages", () => {
  const a: MessageType<any> = new MessageType("openapi.demo.A", [{ no: 1, name: "b", kind: "message", T: () => b }]);
  const b: MessageType<any> = new MessageType("openapi.demo.B", [{ no: 1, name: "a", kind: "message", T: () => a }]);

  const sources: Sources = [];
  expect(() => defaultMessage(a, sources, {})).not.toThrow();
});

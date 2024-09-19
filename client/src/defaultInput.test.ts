import { MessageType } from "@protobuf-ts/runtime";
import { test } from "vitest";

test("defaultInput", () => {
  const I = new MessageType("quirks.v1.MapRequest", [
    { no: 1, name: "string_string", kind: "map", K: 9 /*ScalarType.STRING*/, V: { kind: "scalar", T: 9 /*ScalarType.STRING*/ } },
    { no: 2, name: "string_int32", kind: "map", K: 9 /*ScalarType.STRING*/, V: { kind: "scalar", T: 5 /*ScalarType.INT32*/ } },
    { no: 3, name: "sint64_string", kind: "map", K: 18 /*ScalarType.SINT64*/, V: { kind: "scalar", T: 9 /*ScalarType.STRING*/ } },
  ]);

  // expect(printStatements([defaultInput(I)])).toBe({});
});

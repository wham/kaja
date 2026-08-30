import { expect, test } from "bun:test";
import { responseBytes } from "./wails-transport";
import { StoredValueResponse } from "./api";

test("decodes a base64 body", () => {
  expect(Array.from(responseBytes(btoa("kaja")))).toEqual([107, 97, 106, 97]);
});

// Wails marshals an empty []byte as JSON null, and atob("null") is three bytes of
// noise no message can be read out of ("illegal tag: field no 208531").
test("reads a response with no bytes as a message with no fields set", () => {
  for (const body of [null, undefined, ""]) {
    expect(responseBytes(body)).toHaveLength(0);
    expect(StoredValueResponse.fromBinary(responseBytes(body))).toEqual(StoredValueResponse.create());
  }
});

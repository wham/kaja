import { MessageType } from "@protobuf-ts/runtime";
import { expect, test } from "bun:test";
import { envelopeField, unwrapEnvelope } from "./httpEnvelope";

const payload = (value: string) => ({ "kaja.http_payload": value });

// An array response has no message to be, so the app wraps it. The wrapper is
// the encoding, so the response is the array it holds.
test("unwraps a message that is nothing but an array payload", () => {
  const item = new MessageType("openapi.demo.Pet", [{ no: 1, name: "name", kind: "scalar", T: 9 /*ScalarType.STRING*/ }]);
  const response = new MessageType("openapi.demo.ListPetsResponse", [
    { no: 1, name: "items", kind: "message", repeat: 2 /*RepeatType.UNPACKED*/, T: () => item, options: payload("HTTP_PAYLOAD_ITEMS") },
  ]);

  expect(unwrapEnvelope(response, { items: [{ name: "Rex" }] })).toEqual([{ name: "Rex" }]);
});

test("unwraps a scalar payload down to the bare value", () => {
  const response = new MessageType("openapi.demo.GetStatusResponse", [
    { no: 1, name: "value", kind: "scalar", T: 9 /*ScalarType.STRING*/, options: payload("HTTP_PAYLOAD_VALUE") },
  ]);

  expect(unwrapEnvelope(response, { value: "ok" })).toBe("ok");
});

// A message the API really declares has no envelope to see past, even when it
// happens to have one field, and even when that field is called "items".
test("leaves an unmarked message alone", () => {
  const response = new MessageType("openapi.demo.Page", [{ no: 1, name: "items", kind: "scalar", repeat: 2, T: 9 /*ScalarType.STRING*/ }]);

  expect(envelopeField(response)).toBeUndefined();
  expect(unwrapEnvelope(response, { items: ["a"] })).toEqual({ items: ["a"] });
});

// A body that sits beside path, query or header parameters is marked too, but
// the message is more than the payload: unwrapping it would drop the parameters.
test("leaves a payload that shares its message with parameters alone", () => {
  const body = new MessageType("openapi.demo.WidgetBase", [{ no: 1, name: "name", kind: "scalar", T: 9 /*ScalarType.STRING*/ }]);
  const request = new MessageType("openapi.demo.UpdateWidgetRequest", [
    { no: 1, name: "widget_id", localName: "widgetId", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
    { no: 2, name: "body", kind: "message", T: () => body, options: payload("HTTP_PAYLOAD_BODY") },
  ]);

  expect(envelopeField(request)).toBeUndefined();
  expect(unwrapEnvelope(request, { widgetId: "42", body: { name: "Milo" } })).toEqual({ widgetId: "42", body: { name: "Milo" } });
});

test("passes through when there is no type or no value", () => {
  expect(unwrapEnvelope(undefined, { a: 1 })).toEqual({ a: 1 });
  expect(unwrapEnvelope(undefined, undefined)).toBeUndefined();
});

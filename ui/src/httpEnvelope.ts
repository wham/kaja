import type { FieldInfo, IMessageType } from "@protobuf-ts/runtime";

// The field option an app sets on a field that exists only to carry an HTTP
// payload protobuf has no shape for — a body that is an array, a bare scalar, or
// plain text. See server/pkg/apps/openapi/http.proto for the declaration.
const HTTP_PAYLOAD_OPTION = "kaja.http_payload";

// envelopeField returns the field of a message that is nothing but an envelope:
// one field, and that field declared as the HTTP payload. Any other message —
// including one where the payload sits beside path, query or header parameters —
// has no envelope to see past, and returns undefined.
export function envelopeField(messageType?: IMessageType<any>): FieldInfo | undefined {
  const fields = messageType?.fields;
  if (!fields || fields.length !== 1) return undefined;
  const field = fields[0];
  return field.options?.[HTTP_PAYLOAD_OPTION] ? field : undefined;
}

// unwrapEnvelope returns the HTTP payload a message carries, or the message
// itself when it is not an envelope. It is what a response is shown as: the
// envelope is an artifact of fitting HTTP into protobuf, so the array or scalar
// the API actually returned is what the response is.
//
// The wire shape is untouched — a script still reads `response.items`, which is
// what the generated types say — so this is a matter of what gets displayed.
export function unwrapEnvelope(messageType: IMessageType<any> | undefined, value: unknown): unknown {
  const field = envelopeField(messageType);
  if (!field || value === null || typeof value !== "object") return value;
  return (value as Record<string, unknown>)[field.localName];
}

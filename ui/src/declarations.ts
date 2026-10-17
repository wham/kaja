import type { FieldInfo } from "@protobuf-ts/runtime";

// What a script writes against is TypeScript, so the answer to "what does this method
// take" is a declaration rather than a description of one. protoc-gen-kaja writes each
// generated type out again as a script reads it (see protoc-gen-kaja/kaja/manifest.go):
// the protobuf bookkeeping dropped, and what the app knows but TypeScript can't say —
// that a field is required, or travels in the query string — folded into the JSDoc.
export interface Declaration {
  name: string;
  // The declaration, ready to show.
  text: string;
  // So an answer can close over everything a type reaches.
  references: string[];
}

// The marks an app writes onto a field where protobuf has no shape for what it needs
// to say. Declared in server/pkg/apps/openapi/http.proto.
export const HTTP_REQUIRED_OPTION = "kaja.http_required";
const ENUM_VALUES_OPTION = "kaja.enum_values";

/**
 * The values the app said a field takes, or an empty list where it said nothing.
 * A document's closed set is carried beside the field rather than modeled as a proto
 * enum, which would rename what goes on the wire, so the field stays the string it is
 * and the values are read from here.
 */
export function declaredValues(field: FieldInfo | undefined): string[] {
  const values = field?.options?.[ENUM_VALUES_OPTION];
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string");
}

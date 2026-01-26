import { MessageType } from "@protobuf-ts/runtime";

interface JsonSchemaProperty {
  type: string;
  enum?: string[];
  additionalProperties?: { type: string };
}

export interface JsonSchema {
  type: string;
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

// Scalar type constants from protobuf-ts
const SCALAR_TYPE_BOOL = 8;
const SCALAR_TYPE_STRING = 9;

export function generateJsonSchema(messageType: MessageType<any>, options?: { required?: string[]; enumValues?: Record<string, string[]> }): JsonSchema {
  const fields = messageType.fields;
  const properties: Record<string, JsonSchemaProperty> = {};

  for (const field of fields) {
    const jsonName = field.jsonName || field.name;
    if (field.kind === "scalar") {
      properties[jsonName] = { type: field.T === SCALAR_TYPE_BOOL ? "boolean" : "string" };
    } else if (field.kind === "enum") {
      const enumVals = options?.enumValues?.[jsonName];
      if (enumVals) {
        properties[jsonName] = { type: "string", enum: enumVals };
      } else {
        properties[jsonName] = { type: "string" };
      }
    } else if (field.kind === "map") {
      properties[jsonName] = { type: "object", additionalProperties: { type: "string" } };
    }
  }

  return {
    type: "object",
    properties,
    required: options?.required,
    additionalProperties: false,
  };
}

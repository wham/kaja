import { describe, expect, it } from "vitest";
import { generateJsonSchema } from "./jsonSchema";

// Mock MessageType with fields array for testing
function createMockMessageType(fields: any[]) {
  return { fields } as any;
}

describe("generateJsonSchema", () => {
  it("should generate schema for string scalar fields", () => {
    const messageType = createMockMessageType([
      { name: "name", kind: "scalar", T: 9 }, // STRING
      { name: "url", kind: "scalar", T: 9 },
    ]);

    const schema = generateJsonSchema(messageType);

    expect(schema.type).toBe("object");
    expect(schema.properties.name).toEqual({ type: "string" });
    expect(schema.properties.url).toEqual({ type: "string" });
    expect(schema.additionalProperties).toBe(false);
  });

  it("should generate schema for boolean scalar fields", () => {
    const messageType = createMockMessageType([
      { name: "enabled", kind: "scalar", T: 8 }, // BOOL
    ]);

    const schema = generateJsonSchema(messageType);

    expect(schema.properties.enabled).toEqual({ type: "boolean" });
  });

  it("should use jsonName when available", () => {
    const messageType = createMockMessageType([
      { name: "proto_dir", jsonName: "protoDir", kind: "scalar", T: 9 },
    ]);

    const schema = generateJsonSchema(messageType);

    expect(schema.properties.protoDir).toEqual({ type: "string" });
    expect(schema.properties.proto_dir).toBeUndefined();
  });

  it("should generate schema for enum fields with provided values", () => {
    const messageType = createMockMessageType([
      { name: "protocol", kind: "enum" },
    ]);

    const schema = generateJsonSchema(messageType, {
      enumValues: { protocol: ["grpc", "twirp"] },
    });

    expect(schema.properties.protocol).toEqual({
      type: "string",
      enum: ["grpc", "twirp"],
    });
  });

  it("should generate schema for enum fields without provided values", () => {
    const messageType = createMockMessageType([
      { name: "status", kind: "enum" },
    ]);

    const schema = generateJsonSchema(messageType);

    expect(schema.properties.status).toEqual({ type: "string" });
  });

  it("should generate schema for map fields", () => {
    const messageType = createMockMessageType([
      { name: "headers", kind: "map" },
    ]);

    const schema = generateJsonSchema(messageType);

    expect(schema.properties.headers).toEqual({
      type: "object",
      additionalProperties: { type: "string" },
    });
  });

  it("should include required fields when specified", () => {
    const messageType = createMockMessageType([
      { name: "name", kind: "scalar", T: 9 },
      { name: "url", kind: "scalar", T: 9 },
    ]);

    const schema = generateJsonSchema(messageType, {
      required: ["name", "url"],
    });

    expect(schema.required).toEqual(["name", "url"]);
  });

  it("should handle complex message type with multiple field types", () => {
    const messageType = createMockMessageType([
      { name: "name", kind: "scalar", T: 9 },
      { name: "protocol", kind: "enum" },
      { name: "url", kind: "scalar", T: 9 },
      { name: "proto_dir", jsonName: "protoDir", kind: "scalar", T: 9 },
      { name: "use_reflection", jsonName: "useReflection", kind: "scalar", T: 8 },
      { name: "headers", kind: "map" },
    ]);

    const schema = generateJsonSchema(messageType, {
      required: ["name", "url"],
      enumValues: { protocol: ["grpc", "twirp"] },
    });

    expect(schema).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        protocol: { type: "string", enum: ["grpc", "twirp"] },
        url: { type: "string" },
        protoDir: { type: "string" },
        useReflection: { type: "boolean" },
        headers: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["name", "url"],
      additionalProperties: false,
    });
  });
});

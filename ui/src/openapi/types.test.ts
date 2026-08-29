import { describe, it, expect } from "bun:test";
import { Document, Schema } from "./document";
import { declarations, typeText } from "./types";

function doc(schemas: { [name: string]: Schema }): Document {
  return { openapi: "3.1.0", components: { schemas } };
}

const empty: Document = { openapi: "3.1.0" };

describe("typeText", () => {
  it("writes the scalars", () => {
    expect(typeText(empty, { type: "string" })).toBe("string");
    expect(typeText(empty, { type: "integer" })).toBe("number");
    expect(typeText(empty, { type: "number" })).toBe("number");
    expect(typeText(empty, { type: "boolean" })).toBe("boolean");
  });

  it("says nothing about a schema that says nothing", () => {
    expect(typeText(empty, {})).toBe("unknown");
    expect(typeText(empty, undefined)).toBe("unknown");
  });

  // The whole point: a reference is the name, not the shape. It is what keeps a
  // self-referential schema from recursing forever.
  it("writes a reference as the name it refers to", () => {
    expect(typeText(empty, { $ref: "#/components/schemas/Show" })).toBe("Show");
  });

  it("collects the names a type reaches", () => {
    const references = new Set<string>();
    typeText(empty, { type: "array", items: { $ref: "#/components/schemas/Show" } }, references);
    expect([...references]).toEqual(["Show"]);
  });

  it("writes an array, parenthesising a union element", () => {
    expect(typeText(empty, { type: "array", items: { type: "string" } })).toBe("string[]");
    expect(typeText(empty, { type: "array", items: { type: ["string", "number"] } })).toBe("(string | number)[]");
  });

  // Everything below is a shape proto3 had no way to carry, so the server-side
  // path flattened it. TypeScript says it, so it is said.
  it("writes a nullable type as a union, in both spellings", () => {
    expect(typeText(empty, { type: ["string", "null"] })).toBe("string | null");
    expect(typeText(empty, { type: "string", nullable: true })).toBe("string | null");
  });

  it("writes oneOf and anyOf as a union", () => {
    const union = { oneOf: [{ $ref: "#/components/schemas/Cat" }, { $ref: "#/components/schemas/Dog" }] };
    expect(typeText(empty, union)).toBe("Cat | Dog");
    expect(typeText(empty, { anyOf: [{ type: "string" }, { type: "number" }] })).toBe("string | number");
  });

  it("folds a null member of a union in rather than making it a type of its own", () => {
    expect(typeText(empty, { oneOf: [{ type: "string" }, { type: "null" }] })).toBe("string | null");
  });

  it("writes allOf as an intersection", () => {
    const composed = { allOf: [{ $ref: "#/components/schemas/Base" }, { $ref: "#/components/schemas/Extra" }] };
    expect(typeText(empty, composed)).toBe("Base & Extra");
  });

  it("writes an enum as the values, which is what the document said", () => {
    expect(typeText(empty, { type: "string", enum: ["draft", "live"] })).toBe('"draft" | "live"');
    expect(typeText(empty, { type: "integer", enum: [1, 2] })).toBe("1 | 2");
    expect(typeText(empty, { type: ["string", "null"], enum: ["a", null] })).toBe('"a" | null');
  });

  it("writes additionalProperties as an index signature", () => {
    expect(typeText(empty, { type: "object", additionalProperties: { type: "string" } })).toBe("{ [key: string]: string }");
    expect(typeText(empty, { type: "object", additionalProperties: true })).toBe("{ [key: string]: unknown }");
    expect(typeText(empty, { type: "object" })).toBe("{ [key: string]: unknown }");
  });

  it("reads shape keywords where the document forgot the type", () => {
    expect(typeText(empty, { properties: { id: { type: "string" } } })).toContain("id?: string");
    expect(typeText(empty, { items: { type: "string" } })).toBe("string[]");
  });

  it("marks a property optional unless the document requires it", () => {
    const object: Schema = { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id"] };
    const text = typeText(empty, object);
    expect(text).toContain("id: string;");
    expect(text).toContain("name?: string;");
  });

  it("quotes a property name that is not an identifier", () => {
    expect(typeText(empty, { type: "object", properties: { "x-rate-limit": { type: "number" } } })).toContain('"x-rate-limit"?: number');
  });
});

describe("declarations", () => {
  it("writes a plain object as an interface", () => {
    const [show] = declarations(doc({ Show: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } }));
    expect(show.name).toBe("Show");
    expect(show.text).toBe("export interface Show {\n  id: string;\n}");
  });

  // A union has no member list to write, and forcing one into an interface is
  // exactly what the proto path did when it merged the variants.
  it("writes anything that is not a plain object as a type alias", () => {
    const [pet] = declarations(doc({ Pet: { oneOf: [{ $ref: "#/components/schemas/Cat" }, { $ref: "#/components/schemas/Dog" }] } }));
    expect(pet.text).toBe("export type Pet = Cat | Dog;");

    const [status] = declarations(doc({ Status: { type: "string", enum: ["draft", "live"] } }));
    expect(status.text).toBe('export type Status = "draft" | "live";');
  });

  it("carries the API's own description onto the declaration and its members", () => {
    const declared = declarations(
      doc({ Show: { type: "object", description: "One screening.", properties: { id: { type: "string", description: "The id.", example: "vera-lune" } } } }),
    );
    expect(declared[0].text).toContain("/** One screening. */");
    expect(declared[0].text).toContain('/** The id. [e.g. "vera-lune"] */');
  });

  it("reports what a declaration reaches, without counting itself", () => {
    const declared = declarations(
      doc({
        Node: { type: "object", properties: { child: { $ref: "#/components/schemas/Node" }, leaf: { $ref: "#/components/schemas/Leaf" } } },
      }),
    );
    expect(declared[0].references).toEqual(["Leaf"]);
    // A schema that refers to itself terminates, because a reference is a name.
    expect(declared[0].text).toContain("child?: Node;");
  });

  it("makes a name that is not an identifier into one, in both places", () => {
    const declared = declarations(doc({ "order-item": { type: "object", properties: { of: { $ref: "#/components/schemas/order-item" } } } }));
    expect(declared[0].name).toBe("order_item");
    expect(declared[0].text).toContain("export interface order_item");
    expect(declared[0].text).toContain("of?: order_item;");
  });
});

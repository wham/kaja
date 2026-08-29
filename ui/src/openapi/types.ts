import { Document, Schema, refName, schemaTypes } from "./document";

/**
 * A schema, as TypeScript.
 *
 * This is the whole reason the parsing moved into the browser. Going through
 * protobuf, everything a REST API says that proto3 has no shape for had to be
 * flattened on the way in: a union of two objects became one message holding the
 * superset of their fields, a nullable string became a string, a free-form object
 * became `google.protobuf.Value`, an enum became a comment because proto3 has
 * nowhere to put the values. What came back out was a shape the API never
 * declared, and a script was checked against that shape rather than against the
 * API.
 *
 * TypeScript can say all of it, so it does:
 *
 *   oneOf                 →  A | B
 *   ["string", "null"]    →  string | null
 *   enum: ["a", "b"]      →  "a" | "b"
 *   additionalProperties  →  { [key: string]: T }
 *   allOf                 →  A & B
 *
 * A `$ref` becomes the name it refers to rather than the schema it refers to,
 * which is what keeps the output readable and what makes a self-referential
 * schema terminate.
 */

// A schema with none of type, properties, items or a composition keyword says
// nothing about its value — which in TypeScript is `unknown`, the type that makes
// a reader narrow before using it.
const UNKNOWN = "unknown";

export interface TypeDeclaration {
  name: string;
  // The declaration, ready to show and ready to compile.
  text: string;
  // The names this declaration mentions, so a reader can close over what a type
  // reaches without walking the schema again.
  references: string[];
}

/** The TypeScript for one schema, inline — a reference becomes a name. */
export function typeText(document: Document, schema: Schema | undefined, references?: Set<string>): string {
  if (!schema) return UNKNOWN;

  const referenced = refName(schema.$ref);
  if (referenced) {
    references?.add(referenced);
    return identifier(referenced);
  }

  const parts: string[] = [];
  const types = schemaTypes(schema);
  const nullable = types.includes("null");

  // allOf is an intersection, which is what "all of these at once" means. A
  // member that says nothing is left out rather than intersected with `unknown`,
  // which would erase the rest.
  if (schema.allOf?.length) {
    const members = schema.allOf.map((member) => typeText(document, member, references)).filter((text) => text !== UNKNOWN);
    parts.push(members.length ? members.join(" & ") : UNKNOWN);
  }

  // oneOf and anyOf are both unions here. The difference between them is whether
  // more than one member may match, which is a validation rule rather than a
  // shape, and TypeScript has no way to say it.
  const union = schema.oneOf ?? schema.anyOf;
  if (union?.length) {
    const members = union
      .filter((member) => !isNullSchema(member))
      .map((member) => typeText(document, member, references))
      .filter((text, index, all) => all.indexOf(text) === index);
    // The null member joins the union rather than sitting beside it: a variant
    // that may be null is `A | null`, and `A & null` is a type nothing inhabits.
    if (union.some(isNullSchema)) members.push("null");
    if (members.length) parts.push(members.length === 1 ? members[0] : members.join(" | "));
  }

  if (parts.length === 0) {
    parts.push(bareType(document, schema, types, references));
  }

  const text = parts.length === 1 ? parts[0] : parts.join(" & ");
  return nullable && !text.split(" | ").includes("null") ? `${text} | null` : text;
}

function isNullSchema(schema: Schema): boolean {
  return schemaTypes(schema).length === 1 && schemaTypes(schema)[0] === "null";
}

function bareType(document: Document, schema: Schema, types: string[], references?: Set<string>): string {
  // The values are the type. A document that declares an enum has said exactly
  // what may be sent, and a literal union is the one place the editor can offer
  // it back — which the proto path could only write in a comment.
  if (schema.enum?.length) {
    const literals = schema.enum.filter((value) => value !== null).map((value) => JSON.stringify(value));
    if (literals.length) {
      const text = literals.filter((value, index, all) => all.indexOf(value) === index).join(" | ");
      return schema.enum.includes(null) ? `${text} | null` : text;
    }
  }

  const concrete = types.filter((type) => type !== "null");
  if (concrete.length > 1) {
    return concrete.map((type) => scalarType(document, schema, type, references)).join(" | ");
  }
  return scalarType(document, schema, concrete[0], references);
}

function scalarType(document: Document, schema: Schema, type: string | undefined, references?: Set<string>): string {
  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return arrayType(document, schema, references);
    case "object":
      return objectType(document, schema, references);
    default:
      // No type keyword, but shape keywords that imply one. A document that
      // declares properties and forgets `type: object` is common enough that
      // reading it as an object is right, and reading it as `unknown` is useless.
      if (schema.properties || schema.additionalProperties !== undefined) return objectType(document, schema, references);
      if (schema.items) return arrayType(document, schema, references);
      return UNKNOWN;
  }
}

function arrayType(document: Document, schema: Schema, references?: Set<string>): string {
  const element = typeText(document, schema.items, references);
  // A union element needs the parentheses, or `A | B[]` reads as `A | (B[])`.
  return /[|&]/.test(element) ? `(${element})[]` : `${element}[]`;
}

function objectType(document: Document, schema: Schema, references?: Set<string>): string {
  const members = objectMembers(document, schema, references, "  ");
  const index = indexSignature(document, schema, references);

  if (members.length === 0) {
    // A free-form object: what the document said, rather than the `Value` builder
    // the proto path needed for the same thing.
    return index ?? "{ [key: string]: unknown }";
  }
  const lines = [...members, ...(index ? [`  ${index.slice(2, -2).trim()};`] : [])];
  return `{\n${lines.join("\n")}\n}`;
}

function indexSignature(document: Document, schema: Schema, references?: Set<string>): string | undefined {
  const additional = schema.additionalProperties;
  if (additional === undefined || additional === false) return undefined;
  if (additional === true) return "{ [key: string]: unknown }";
  return `{ [key: string]: ${typeText(document, additional, references)} }`;
}

function objectMembers(document: Document, schema: Schema, references: Set<string> | undefined, indent: string): string[] {
  const required = new Set(schema.required ?? []);
  const lines: string[] = [];

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const doc = propertyDoc(property);
    if (doc) lines.push(`${indent}/** ${doc} */`);
    // A property the document does not require is optional, which is the one
    // thing proto3 could not say at all: everything was optional there, so a
    // required field looked exactly like one the API never needed.
    lines.push(`${indent}${propertyName(name)}${required.has(name) ? "" : "?"}: ${typeText(document, property, references)};`);
  }
  return lines;
}

// A description, and the facts a reader would otherwise have to open the document
// for. Kept to one line: this is the hover, not the reference.
function propertyDoc(schema: Schema): string {
  const parts: string[] = [];
  if (schema.description) parts.push(schema.description.replace(/\s+/g, " ").trim());
  if (schema.deprecated) parts.push("[deprecated]");
  if (schema.readOnly) parts.push("[read-only]");
  if (schema.writeOnly) parts.push("[write-only]");
  if (schema.format) parts.push(`[${schema.format}]`);
  if (schema.default !== undefined) parts.push(`[default ${JSON.stringify(schema.default)}]`);
  if (schema.example !== undefined) parts.push(`[e.g. ${JSON.stringify(schema.example)}]`);

  const text = parts.join(" ");
  return text.length > 240 ? text.slice(0, 239) + "…" : text;
}

// A property name is quoted unless it is an identifier — an API is free to use
// `x-rate-limit` or `2fa` as a property name, and a quoted key is how TypeScript
// says one.
export function propertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

// A schema name is a type name, so it has to be one. A document is free to call a
// schema `Pet.Detail` or `order-item`; the reference and the declaration are run
// through the same function, so they cannot disagree.
export function identifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || "_";
}

/**
 * Every named schema in the document, as a TypeScript declaration.
 *
 * An object becomes an interface, so a reader gets the members listed and the
 * editor gets a name it can go to. Anything else — a union, an enum, an alias —
 * becomes a type alias, because that is what it is.
 */
export function declarations(document: Document): TypeDeclaration[] {
  const schemas = document.components?.schemas ?? {};
  const declared: TypeDeclaration[] = [];

  for (const [name, schema] of Object.entries(schemas)) {
    if (!schema) continue;
    const references = new Set<string>();
    const doc = schemaDoc(schema);
    const header = doc ? `/** ${doc} */\n` : "";

    if (isInterface(schema)) {
      const members = objectMembers(document, schema, references, "  ");
      const index = indexSignature(document, schema, references);
      const body = [...members, ...(index ? [`  [key: string]: ${index.slice(index.indexOf(": ") + 2, -2)};`] : [])];
      declared.push({
        name: identifier(name),
        text: `${header}export interface ${identifier(name)} {\n${body.join("\n")}\n}`,
        references: [...references].map(identifier).filter((reference) => reference !== identifier(name)),
      });
      continue;
    }

    declared.push({
      name: identifier(name),
      text: `${header}export type ${identifier(name)} = ${typeText(document, schema, references)};`,
      references: [...references].map(identifier).filter((reference) => reference !== identifier(name)),
    });
  }
  return declared;
}

// An interface is the right shape only for a plain object: something with members
// and no composition around them. A schema that is a union or an intersection has
// no member list to write, and forcing one is how the proto path lost them.
function isInterface(schema: Schema): boolean {
  if (schema.$ref || schema.oneOf?.length || schema.anyOf?.length || schema.allOf?.length || schema.enum?.length) return false;
  const types = schemaTypes(schema).filter((type) => type !== "null");
  if (schemaTypes(schema).includes("null")) return false;
  if (types.length > 1) return false;
  if (types[0] && types[0] !== "object") return false;
  return schema.properties !== undefined;
}

function schemaDoc(schema: Schema): string {
  const parts: string[] = [];
  if (schema.description) parts.push(schema.description.replace(/\s+/g, " ").trim());
  if (schema.deprecated) parts.push("[deprecated]");
  const text = parts.join(" ");
  return text.length > 240 ? text.slice(0, 239) + "…" : text;
}

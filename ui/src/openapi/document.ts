/**
 * An OpenAPI 3.x document, as a browser reads it.
 *
 * Kaja used to convert a document into a proto file on the server and invoke the
 * result as if it were gRPC. Everything a REST API says that protobuf has no shape
 * for had to be carried around it — an envelope field for a body that is an array,
 * a `kaja.http_in` mark for where a field travels, a `json_name` on every property
 * so proto3-JSON would spell it the way the API does. The wire was protobuf and the
 * API was HTTP, so the marks were the translation between them.
 *
 * Read here instead, none of that is needed: a schema becomes TypeScript, an
 * operation becomes an HTTP request, and what the document says is what the script
 * is checked against. What the API cannot express in protobuf — a union, a nullable
 * scalar, a free-form object, a literal enum — it can express in TypeScript.
 *
 * The model is the document's own shape. Nothing is normalized on the way in, so a
 * reader can always ask what was written.
 */

export interface Document {
  openapi?: string;
  swagger?: string;
  info?: Info;
  servers?: Server[];
  paths?: { [path: string]: PathItem };
  components?: Components;
  security?: SecurityRequirement[];
}

export interface Info {
  title?: string;
  version?: string;
  description?: string;
}

export interface Server {
  url?: string;
  description?: string;
  variables?: { [name: string]: ServerVariable };
}

export interface ServerVariable {
  default?: string;
  enum?: string[];
  description?: string;
}

export interface PathItem {
  parameters?: Parameter[];
  get?: Operation;
  put?: Operation;
  post?: Operation;
  patch?: Operation;
  delete?: Operation;
  head?: Operation;
  options?: Operation;
}

export interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses?: { [status: string]: Response };
  security?: SecurityRequirement[];
}

export interface Parameter {
  $ref?: string;
  name?: string;
  in?: "path" | "query" | "header" | "cookie";
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema?: Schema;
  // How an array or object parameter is spelled in the URL. Only `form` (the
  // default) and `deepObject` differ in a way a caller can observe.
  style?: string;
  explode?: boolean;
  example?: unknown;
  content?: { [contentType: string]: MediaType };
}

export interface RequestBody {
  description?: string;
  required?: boolean;
  content?: { [contentType: string]: MediaType };
}

export interface Response {
  description?: string;
  content?: { [contentType: string]: MediaType };
}

export interface MediaType {
  schema?: Schema;
  example?: unknown;
}

export interface Components {
  schemas?: { [name: string]: Schema };
  parameters?: { [name: string]: Parameter };
  requestBodies?: { [name: string]: RequestBody };
  responses?: { [name: string]: Response };
  securitySchemes?: { [name: string]: SecurityScheme };
}

export interface SecurityScheme {
  type?: string;
  scheme?: string;
  in?: string;
  name?: string;
  bearerFormat?: string;
  description?: string;
}

export type SecurityRequirement = { [scheme: string]: string[] };

export interface Schema {
  $ref?: string;
  // 3.0 writes one string; 3.1 (JSON Schema) allows ["string", "null"]. Kept as
  // written, because in TypeScript a nullable type is a union and can be said.
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  // 3.0's way of saying what 3.1 says with a "null" in `type`.
  nullable?: boolean;
  deprecated?: boolean;
  items?: Schema;
  properties?: { [name: string]: Schema };
  additionalProperties?: boolean | Schema;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  example?: unknown;
  readOnly?: boolean;
  writeOnly?: boolean;
}

// The verbs a path item may declare, in the order an index reads best: what an
// operation does to the resource, safest first.
export const VERBS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export type Verb = (typeof VERBS)[number];

/** One operation, with everything that addresses it resolved onto it. */
export interface ResolvedOperation {
  verb: string;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  deprecated: boolean;
  tag: string;
  // Path-item parameters merged with the operation's own, the operation winning
  // where both name the same parameter in the same place — which is what the
  // specification says an operation-level parameter does.
  parameters: Parameter[];
  requestBody?: RequestBody;
  // The response body a call hands back: the first 2xx that declares JSON.
  response?: { status: string; contentType: string; schema?: Schema };
  requestContentType?: string;
  requestSchema?: Schema;
}

// The tag an operation is filed under. The first, because that is the one a
// document orders its own navigation by; unfiled operations go in one place rather
// than each in a group of its own.
const UNTAGGED = "Default";

export function documentTitle(document: Document): string {
  return document.info?.title?.trim() || "";
}

/**
 * Every operation the document declares, in document order.
 *
 * A `$ref` in a parameter is followed here because a parameter is addressed by
 * name and place rather than by a type — unlike a schema, where the reference is
 * the type's name and is what makes the emitted TypeScript readable.
 */
export function operations(document: Document): ResolvedOperation[] {
  const found: ResolvedOperation[] = [];

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (!item) continue;
    for (const verb of VERBS) {
      const operation = item[verb];
      if (!operation) continue;
      found.push(resolveOperation(document, verb.toUpperCase(), path, item, operation));
    }
  }
  return found;
}

function resolveOperation(document: Document, verb: string, path: string, item: PathItem, operation: Operation): ResolvedOperation {
  const parameters = mergeParameters(
    (item.parameters ?? []).map((parameter) => resolveParameter(document, parameter)),
    (operation.parameters ?? []).map((parameter) => resolveParameter(document, parameter)),
  );

  const request = jsonContent(operation.requestBody?.content);
  const response = responseBody(document, operation);

  return {
    verb,
    path,
    operationId: operation.operationId,
    summary: operation.summary?.trim(),
    description: operation.description?.trim(),
    deprecated: operation.deprecated === true,
    tag: operation.tags?.[0]?.trim() || UNTAGGED,
    parameters,
    requestBody: operation.requestBody,
    requestContentType: request?.contentType,
    requestSchema: request?.schema,
    response,
  };
}

// An operation's own parameter replaces a path item's when both name the same
// parameter in the same place; anything else is added.
function mergeParameters(fromPath: Parameter[], fromOperation: Parameter[]): Parameter[] {
  const merged = [...fromPath];
  for (const parameter of fromOperation) {
    const at = merged.findIndex((other) => other.name === parameter.name && other.in === parameter.in);
    if (at === -1) merged.push(parameter);
    else merged[at] = parameter;
  }
  return merged;
}

export function resolveParameter(document: Document, parameter: Parameter): Parameter {
  if (!parameter.$ref) return parameter;
  const resolved = followRef(document, parameter.$ref) as Parameter | undefined;
  return resolved ? { ...resolved, ...withoutRef(parameter) } : parameter;
}

function withoutRef(parameter: Parameter): Parameter {
  const { $ref, ...rest } = parameter;
  return rest;
}

// The response a call hands back. The first 2xx with a body, because that is the
// one a script is written against; a document that declares several says so with
// several status codes and the earliest is the ordinary answer. `default` is the
// last resort, being what the document says about everything it did not enumerate.
function responseBody(document: Document, operation: Operation): ResolvedOperation["response"] | undefined {
  const responses = operation.responses ?? {};
  const codes = Object.keys(responses)
    .filter((code) => /^2\d\d$/.test(code))
    .sort();

  for (const code of [...codes, "2XX", "default"]) {
    const response = responses[code];
    if (!response) continue;
    const content = jsonContent(response.content);
    if (content) return { status: code, contentType: content.contentType, schema: content.schema };
    // A 2xx that declares no content at all is a call that answers with nothing,
    // which is a real answer and stops the search.
    if (code !== "default" && !response.content) return { status: code, contentType: "" };
  }
  return undefined;
}

/**
 * The JSON media type to read, preferring plain `application/json`, then a
 * charset-suffixed variant, then a structured `+json` type — the order the server
 * used, kept because an API that declares both means the plain one.
 */
export function jsonContent(content: { [contentType: string]: MediaType } | undefined): { contentType: string; schema?: Schema } | undefined {
  if (!content) return undefined;
  const types = Object.keys(content);

  const exact = types.find((type) => type === "application/json");
  const prefixed = types.find((type) => type.startsWith("application/json;"));
  const structured = types.find((type) => /\+json($|;)/.test(type));
  const chosen = exact ?? prefixed ?? structured;
  if (chosen) return { contentType: chosen, schema: content[chosen]?.schema };

  // Not JSON, but still a body: text/plain and friends are handed over as they are.
  const text = types.find((type) => type.startsWith("text/"));
  if (text) return { contentType: text, schema: content[text]?.schema };
  return undefined;
}

/**
 * Follow a local `$ref` (`#/components/schemas/Show`). Only local references are
 * followed: a document that points at another file has not been fetched, and a
 * reference kaja cannot resolve is left as it was rather than guessed at.
 */
export function followRef(document: Document, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = document;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** The name a schema reference names, or nothing where it is not one. */
export function refName(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const match = /^#\/components\/schemas\/(.+)$/.exec(ref);
  return match ? decodeURIComponent(match[1].replace(/~1/g, "/").replace(/~0/g, "~")) : undefined;
}

/** The declared types of a schema, with 3.0's `nullable` folded into 3.1's spelling. */
export function schemaTypes(schema: Schema): string[] {
  const declared = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (schema.nullable === true && !declared.includes("null")) return [...declared, "null"];
  return declared;
}

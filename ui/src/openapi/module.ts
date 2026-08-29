import { Document, ResolvedOperation, Schema, operations } from "./document";
import { declarations, identifier, propertyName, typeText, TypeDeclaration } from "./types";

/**
 * The TypeScript a script writes against a REST app.
 *
 * One module: the document's own schemas as declarations, a request type per
 * operation, and the door that addresses them by verb and path.
 *
 * There is no `Input<T>` here, and its absence is the point. Through protobuf
 * nothing was ever required — proto3 has no such thing — so every generated
 * request had to be a deep partial and the fields the API insists on were a
 * `[required]` note in a comment. The document says which fields are required, so
 * the request type says it too, and leaving one out is an error where the API
 * would have refused the call anyway.
 */

export interface RestModule {
  // The whole module, ready to be an editor model.
  text: string;
  // Every declaration by name, for the MCP catalog and go-to-definition.
  declarations: { [name: string]: TypeDeclaration };
  // One entry per operation, in the order the door declares them.
  operations: RestOperation[];
}

/** An operation, with the names its TypeScript goes by. */
export interface RestOperation {
  operation: ResolvedOperation;
  // What identifies the call: the document's operationId where it has one, since
  // that is the name the API itself gave the operation.
  name: string;
  service: string;
  requestType: string;
  responseType: string;
  // Whether a call must pass a request at all.
  required: boolean;
}

export function buildModule(document: Document): RestModule {
  const declared = declarations(document);
  const byName: { [name: string]: TypeDeclaration } = {};
  for (const declaration of declared) byName[declaration.name] = declaration;

  const found = operations(document);
  const taken = new Set(declared.map((declaration) => declaration.name));
  const built: RestOperation[] = [];
  const requestTypes: string[] = [];

  for (const operation of found) {
    const name = operationName(operation, taken);
    const request = requestInterface(document, operation, `${name}Request`);
    const responseType = typeText(document, operation.response?.schema) || "unknown";

    requestTypes.push(request.text);
    byName[request.name] = { name: request.name, text: request.text, references: request.references };
    built.push({
      operation,
      name,
      service: identifier(operation.tag),
      requestType: request.name,
      responseType: operation.response && operation.response.contentType === "" ? "void" : responseType,
      required: request.required,
    });
  }

  const text = [declared.map((declaration) => declaration.text).join("\n\n"), requestTypes.join("\n\n"), doorText(built)].filter(Boolean).join("\n\n");

  return { text, declarations: byName, operations: built };
}

/**
 * The door, one overload per operation. Same shape as the door over a compiled
 * app, because it is the same door: what changed is where the declarations it is
 * written in terms of came from.
 */
function doorText(built: RestOperation[]): string {
  const byVerb = new Map<string, RestOperation[]>();
  for (const entry of built) {
    const verb = entry.operation.verb.toLowerCase();
    (byVerb.get(verb) ?? byVerb.set(verb, []).get(verb)!).push(entry);
  }

  const lines: string[] = ["export const api: {"];
  for (const [verb, entries] of byVerb) {
    for (const entry of [...entries].sort((a, b) => a.operation.path.localeCompare(b.operation.path))) {
      const doc = overloadDoc(entry.operation);
      if (doc) lines.push(`    /** ${doc} */`);
      const request = `request${entry.required ? "" : "?"}: ${entry.requestType}`;
      lines.push(`    ${verb}(path: ${JSON.stringify(entry.operation.path)}, ${request}, options?: CallOptions): Call<${entry.responseType}>;`);
    }
  }
  lines.push("} = {} as never;");
  return lines.join("\n");
}

function overloadDoc(operation: ResolvedOperation): string {
  const parts: string[] = [];
  if (operation.summary) parts.push(operation.summary.replace(/\s+/g, " "));
  if (operation.deprecated) parts.push("[deprecated]");
  const text = parts.join(" ");
  return text.length > 200 ? text.slice(0, 199) + "…" : text;
}

/**
 * The request an operation takes: its parameters and its body, in one object.
 *
 * A script writes one flat object and the pieces are routed to the path, the
 * query, a header or the body — which is what an OpenAPI operation is. Where the
 * body is not an object there is nothing to spread, so it arrives under `body`.
 */
function requestInterface(
  document: Document,
  operation: ResolvedOperation,
  name: string,
): { name: string; text: string; references: string[]; required: boolean } {
  const references = new Set<string>();
  const lines: string[] = [];
  let required = false;

  for (const parameter of operation.parameters) {
    if (!parameter.name) continue;
    const doc = parameterDoc(parameter);
    if (doc) lines.push(`  /** ${doc} */`);
    // A path parameter is always required: without it the path is not an address,
    // whatever the document says about it.
    const insisted = parameter.required === true || parameter.in === "path";
    if (insisted) required = true;
    lines.push(`  ${propertyName(parameter.name)}${insisted ? "" : "?"}: ${typeText(document, parameter.schema, references)};`);
  }

  const body = operation.requestSchema;
  if (operation.requestBody) {
    const insisted = operation.requestBody.required === true;
    if (insisted) required = true;

    if (body && isSpreadable(body)) {
      // The body's own members sit beside the parameters, so one object is the
      // whole call.
      lines.push(...bodyMembers(document, body, references, insisted));
    } else {
      const doc = operation.requestBody.description?.replace(/\s+/g, " ").trim();
      if (doc) lines.push(`  /** ${doc} */`);
      lines.push(`  body${insisted ? "" : "?"}: ${typeText(document, body, references)};`);
    }
  }

  const text = lines.length === 0 ? `export interface ${name} {}` : `export interface ${name} {\n${lines.join("\n")}\n}`;
  return { name, text, references: [...references], required };
}

// A body is spread into the request where it is a plain object declared inline. A
// $ref is left whole so the request names the API's own type rather than copying
// its members — `body: Show` reads better and follows a rename of the schema.
function isSpreadable(schema: Schema | undefined): boolean {
  if (!schema || schema.$ref) return false;
  return schema.properties !== undefined;
}

function bodyMembers(document: Document, schema: Schema, references: Set<string>, bodyRequired: boolean): string[] {
  const required = new Set(schema.required ?? []);
  const lines: string[] = [];
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const doc = property.description?.replace(/\s+/g, " ").trim();
    if (doc) lines.push(`  /** ${doc} */`);
    // A member the body requires is required only if the body itself is: an
    // optional body that is left out entirely requires nothing.
    const insisted = bodyRequired && required.has(name);
    lines.push(`  ${propertyName(name)}${insisted ? "" : "?"}: ${typeText(document, property, references)};`);
  }
  return lines;
}

function parameterDoc(parameter: { description?: string; in?: string; deprecated?: boolean; example?: unknown }): string {
  const parts: string[] = [];
  if (parameter.description) parts.push(parameter.description.replace(/\s+/g, " ").trim());
  if (parameter.in && parameter.in !== "path") parts.push(`[${parameter.in} parameter]`);
  if (parameter.deprecated) parts.push("[deprecated]");
  if (parameter.example !== undefined) parts.push(`[e.g. ${JSON.stringify(parameter.example)}]`);
  const text = parts.join(" ");
  return text.length > 200 ? text.slice(0, 199) + "…" : text;
}

/**
 * What the operation is called. The document's own operationId where it has one —
 * the API named the operation, so kaja does not have to — and otherwise a name
 * read off the verb and the path.
 *
 * Only the request type and the call's identity are spelled with it; nothing a
 * script writes is, because a script writes the path.
 */
export function operationName(operation: ResolvedOperation, taken: Set<string>): string {
  const base = operation.operationId ? pascal(operation.operationId) : pascal(`${operation.verb} ${operation.path.replace(/[{}]/g, "")}`);
  let name = base || "Operation";
  for (let suffix = 2; taken.has(name); suffix++) name = `${base}${suffix}`;
  taken.add(name);
  return name;
}

function pascal(text: string): string {
  const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  return identifier(joined);
}

/**
 * The call clicking an operation writes: the path, and the fields the API insists
 * on. Everything else is left out — the declarations say what else may be sent,
 * and a page of empty strings reads as values being sent rather than as fields
 * being offered.
 */
export function restEditorCode(module: RestModule, name: string, binding: string): string | undefined {
  const entry = module.operations.find((operation) => operation.name === name);
  if (!entry) return undefined;

  const request = module.declarations[entry.requestType];
  const fields = request ? requiredFields(request.text) : [];
  const argument = fields.length ? `, {\n${fields.map((field) => `  ${field.name}: ${field.zero},`).join("\n")}\n}` : entry.required ? ", {}" : "";

  return `${binding}.${entry.operation.verb.toLowerCase()}(${JSON.stringify(entry.operation.path)}${argument});\n`;
}

// Read off the emitted interface rather than the schema, so what the call writes
// and what the editor checks it against cannot disagree: a member with no `?` is
// one the document requires.
function requiredFields(text: string): Array<{ name: string; zero: string }> {
  const fields: Array<{ name: string; zero: string }> = [];
  for (const line of text.split("\n")) {
    const match = /^\s{2}("[^"]+"|[A-Za-z_$][A-Za-z0-9_$]*):\s*(.+);$/.exec(line);
    if (!match) continue;
    fields.push({ name: match[1], zero: zeroFor(match[2]) });
  }
  return fields;
}

// The zero a field of this type takes. A union offers its first member, which for
// an enum is the first value the document listed — the one place a generated call
// can be right rather than empty.
function zeroFor(type: string): string {
  const first = type.split("|")[0].trim();
  if (/^".*"$/.test(first)) return first;
  if (first === "number") return "0";
  if (first === "boolean") return "false";
  if (first.endsWith("[]") || first.startsWith("(")) return "[]";
  if (first === "string") return '""';
  if (first.startsWith("{")) return "{}";
  return "{}";
}

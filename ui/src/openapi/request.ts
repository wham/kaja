import { Parameter, ResolvedOperation, Schema, schemaTypes } from "./document";

/**
 * The HTTP request an operation and its input make.
 *
 * This is what `transcode` did in Go, and moving it here is what lets the request
 * be an ordinary object. Going through protobuf, the input was a message: every
 * value had a declared field, a field left out was indistinguishable from one sent
 * as its zero, and a body that was not an object needed an envelope field to live
 * in. Here the input is JSON, so what the script wrote is what goes out —
 * including, where the API says so, a body that is an array or a bare string.
 */

export interface HttpRequest {
  method: string;
  // Relative to the app's base URL, which the tunnel supplies: the browser never
  // learns where the API is, and a script cannot address anything else.
  path: string;
  query: Array<[string, string]>;
  headers: { [name: string]: string };
  // Absent for a request with no body, which is not the same as an empty one.
  body?: string;
}

// Where a value in the input travels. A body-less operation takes its whole input
// from parameters; one with a body takes the rest of it from the body.
const BODY = "body";

/**
 * Build the request. `input` is what the script wrote; anything it does not name
 * is left out rather than sent as a zero — which the proto path could not do,
 * since a message has no way to say a field is absent.
 */
export function buildRequest(operation: ResolvedOperation, input: Record<string, unknown> | undefined): HttpRequest {
  const values = input ?? {};
  const query: Array<[string, string]> = [];
  const headers: { [name: string]: string } = {};

  let path = operation.path;
  for (const parameter of operation.parameters) {
    const name = parameter.name;
    if (!name) continue;
    const value = values[name];

    switch (parameter.in) {
      case "path":
        // A path parameter that is missing leaves its template in the URL rather
        // than a hole: the request then fails against the API, which is a clearer
        // account of what went wrong than a call to /shows/undefined.
        if (value !== undefined && value !== null) {
          path = path.replace(`{${name}}`, encodeURIComponent(scalar(value)));
        }
        break;
      case "query":
        if (value !== undefined && value !== null) query.push(...queryValues(parameter, name, value));
        break;
      case "header":
        if (value !== undefined && value !== null) headers[name] = scalar(value);
        break;
      case "cookie":
        // Cookies are the browser's to set and this call is made by a proxy, so a
        // cookie parameter is sent as the header it would have become.
        if (value !== undefined && value !== null) headers["Cookie"] = `${name}=${scalar(value)}`;
        break;
    }
  }

  const request: HttpRequest = { method: operation.verb.toUpperCase(), path, query, headers };

  const body = bodyOf(operation, values);
  if (body !== undefined) {
    request.body = JSON.stringify(body);
    headers["Content-Type"] = operation.requestContentType || "application/json";
  }
  return request;
}

/**
 * What goes in the body.
 *
 * An operation whose body is an object takes it from the input's own members,
 * minus the ones that travel in the path, the query or a header — so a script
 * writes one flat object and the request is assembled from it. An operation whose
 * body is not an object (an array, a scalar) takes it from a `body` member,
 * because there is nothing to spread.
 */
function bodyOf(operation: ResolvedOperation, values: Record<string, unknown>): unknown {
  if (!operation.requestBody) return undefined;

  if (!isObjectBody(operation.requestSchema)) {
    return BODY in values ? values[BODY] : undefined;
  }

  // An explicit `body` wins, so an API with a property genuinely called `body` is
  // still reachable and a caller who prefers to be explicit may be.
  if (BODY in values) return values[BODY];

  const travelling = new Set(operation.parameters.map((parameter) => parameter.name).filter((name): name is string => !!name));
  const body: Record<string, unknown> = {};
  let found = false;
  for (const [name, value] of Object.entries(values)) {
    if (travelling.has(name)) continue;
    body[name] = value;
    found = true;
  }
  // A body the API requires is sent even when it is empty; one it does not is
  // left out entirely, which is not the same as sending `{}`.
  if (!found && !operation.requestBody.required) return undefined;
  return body;
}

function isObjectBody(schema: Schema | undefined): boolean {
  if (!schema) return false;
  if (schema.$ref || schema.properties || schema.allOf?.length) return true;
  const types = schemaTypes(schema).filter((type) => type !== "null");
  if (types.includes("array")) return false;
  return types.length === 0 || types.includes("object");
}

/**
 * A query parameter, spelled the way the document says.
 *
 * `style` and `explode` are the only part of a URL an API gets to choose, and
 * getting it wrong is a request that silently returns the wrong rows — so the
 * default (form, exploded) is applied by absence rather than assumed.
 */
function queryValues(parameter: Parameter, name: string, value: unknown): Array<[string, string]> {
  const explode = parameter.explode ?? parameter.style !== "deepObject";

  if (parameter.style === "deepObject" && isRecord(value)) {
    return Object.entries(value)
      .filter(([, member]) => member !== undefined && member !== null)
      .map(([key, member]): [string, string] => [`${name}[${key}]`, scalar(member)]);
  }

  if (Array.isArray(value)) {
    const members = value.filter((member) => member !== undefined && member !== null).map(scalar);
    if (members.length === 0) return [];
    // form with explode=false is one comma-joined value; exploded is one entry
    // per member, which is what an API means by `?tag=a&tag=b`.
    return explode ? members.map((member): [string, string] => [name, member]) : [[name, members.join(",")]];
  }

  if (isRecord(value)) {
    // An object in a form-style parameter is its members, flattened — the
    // specification's own reading of `explode: true` for an object.
    const members = Object.entries(value).filter(([, member]) => member !== undefined && member !== null);
    if (explode) return members.map(([key, member]): [string, string] => [key, scalar(member)]);
    return [[name, members.map(([key, member]) => `${key},${scalar(member)}`).join(",")]];
  }

  return [[name, scalar(value)]];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A value in a URL is text. An object or array that reaches here is one the
// document did not describe as one, so it travels as its JSON rather than as
// "[object Object]".
function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

/** The request's path with its query on the end, which is what the tunnel sends. */
export function requestTarget(request: HttpRequest): string {
  if (request.query.length === 0) return request.path;
  const query = request.query.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&");
  return `${request.path}?${query}`;
}

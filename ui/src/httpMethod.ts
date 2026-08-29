import { Method, Service } from "./apps";

// A method's HTTP request, as the app wrote it onto the method: `GET /shows/{showId}`.
// See server/pkg/apps/openapi/http.proto.
//
// The pair is the API's own identity for an operation — an OpenAPI document is a map
// of paths to verbs — so it is unique where a generated method name only is because
// protogen went to trouble to make it so. That is what lets it be the address a script
// writes and the label the tree shows.
export interface HttpRequest {
  verb: string;
  path: string;
}

// The verbs the REST door offers. A document declaring anything else keeps its methods
// and is reached by name alone: a door has to be a member the editor can check.
const VERBS = ["get", "post", "put", "patch", "delete", "head", "options"];

export function parseHttpRequest(request: string | undefined): HttpRequest | undefined {
  if (!request) return undefined;
  const space = request.indexOf(" ");
  if (space <= 0) return undefined;
  const verb = request.slice(0, space).trim();
  const path = request.slice(space + 1).trim();
  if (!path.startsWith("/") || !VERBS.includes(verb.toLowerCase())) return undefined;
  return { verb: verb.toUpperCase(), path };
}

export function httpRequestOf(method: Method): HttpRequest | undefined {
  return parseHttpRequest(method.http);
}

// The member of the REST door a method is reached through — `get`, `post`. Lowercase
// because it is written in a script; `delete` is a member name rather than a binding,
// so the reserved word costs nothing.
export function verbMember(request: HttpRequest): string {
  return request.verb.toLowerCase();
}

// Whether the app has a REST surface at all: one method carrying an HTTP request is
// enough, and an app where none does never grows a door.
export function isRestService(service: Service): boolean {
  return service.methods.some((method) => httpRequestOf(method) !== undefined);
}

export function restOperations(services: Service[]): Array<{ service: Service; method: Method; request: HttpRequest }> {
  const operations: Array<{ service: Service; method: Method; request: HttpRequest }> = [];
  for (const service of services) {
    for (const method of service.methods) {
      const request = httpRequestOf(method);
      if (request) operations.push({ service, method, request });
    }
  }
  return operations;
}

// The parameters a path templates, in the order it names them: `/shows/{showId}/cast`
// gives ["showId"]. Read off the path rather than off the request, because the path is
// what a person is looking at when they wonder what a call still needs.
export function pathParameters(path: string): string[] {
  return [...path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

// A path split around its templated parameters, so a row can draw `{showId}` quieter
// than the segments that are literally the address. Always starts with a literal part,
// which is empty when the path opens with a parameter.
export function pathParts(path: string): Array<{ text: string; parameter: boolean }> {
  const parts: Array<{ text: string; parameter: boolean }> = [];
  let index = 0;
  for (const match of path.matchAll(/\{[^{}]+\}/g)) {
    if (match.index! > index) parts.push({ text: path.slice(index, match.index), parameter: false });
    parts.push({ text: match[0], parameter: true });
    index = match.index! + match[0].length;
  }
  if (index < path.length) parts.push({ text: path.slice(index), parameter: false });
  return parts;
}

// What the method is called in every list that names one. A REST method is named by
// the request it stands for, because that is the name its own API gives it; anything
// else keeps the name the proto surface gave it.
export function methodLabel(method: Method): string {
  const request = httpRequestOf(method);
  return request ? `${request.verb} ${request.path}` : method.name;
}

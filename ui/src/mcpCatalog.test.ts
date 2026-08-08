import { describe, expect, it } from "bun:test";
import { loadApp } from "./appLoader";
import { buildMcpCatalog } from "./mcpCatalog";
import type { Source as ApiSource } from "./server/api";

// createClients reads window.location for the base URL; provide it as the browser would.
(globalThis as any).window = { location: { href: "http://localhost/" } };

// A generated surface in the shape protoc-gen-kaja emits for an OpenAPI app: a
// service, its request/response messages, an enum, a nested message, and the
// kaja options that say what the method does over HTTP.
const serviceTs = `
import { ServiceType } from "@protobuf-ts/runtime-rpc";
/**
 * A show in the catalog.
 *
 * @generated from protobuf message theatre.Show
 */
export interface Show {
    /**
     * Unique slug of the show.
     */
    id: string;
    venue?: Show_Venue;
}
export interface Show_Venue {
    name: string;
}
export interface ListShowsRequest {
    /**
     * How many shows to return. Defaults to 25 when omitted.
     */
    pageSize: number;
    sort: Sort;
}
export interface ListShowsResponse {
    items: Show[];
}
export enum Sort { UNSPECIFIED = 0, NEWEST = 1 }
export const Shows = new ServiceType("Shows", []);
`;

const clientTs = `
import type { RpcOptions, UnaryCall } from "@protobuf-ts/runtime-rpc";
import type { ListShowsRequest, ListShowsResponse } from "./theatre";
export interface IShowsClient {
    /**
     * Lists the shows on sale.
     *
     * @generated from protobuf rpc: ListShows
     */
    listShows(input: ListShowsRequest, options?: RpcOptions): UnaryCall<ListShowsRequest, ListShowsResponse>;
}
`;

// Hand-written stand-ins for the runtime MessageType objects, carrying the field
// info and options protobuf-ts would.
const stubCode = `
const Show_Venue = { typeName: "theatre.Show_Venue", fields: [ { no: 1, name: "name", localName: "name", jsonName: "name", kind: "scalar", T: 9 } ] };
const Show = { typeName: "theatre.Show", fields: [
  { no: 1, name: "id", localName: "id", jsonName: "id", kind: "scalar", T: 9, options: { "kaja.http_required": true } },
  { no: 2, name: "venue", localName: "venue", jsonName: "venue", kind: "message", T: () => Show_Venue }
] };
const Sort = { 0: "UNSPECIFIED", 1: "NEWEST", UNSPECIFIED: 0, NEWEST: 1 };
const ListShowsRequest = { typeName: "theatre.ListShowsRequest", fields: [
  { no: 1, name: "page_size", localName: "pageSize", jsonName: "pageSize", kind: "scalar", T: 5, options: { "kaja.http_in": "query" } },
  { no: 2, name: "sort", localName: "sort", jsonName: "sort", kind: "enum", T: () => ["theatre.Sort", Sort, "SORT_"] }
] };
const ListShowsResponse = { typeName: "theatre.ListShowsResponse", fields: [
  { no: 1, name: "items", localName: "items", jsonName: "items", kind: "message", repeat: 2, T: () => Show, options: { "kaja.http_payload": "HTTP_PAYLOAD_ITEMS" } }
] };
export const proto$theatre = {
  Show, Show_Venue, ListShowsRequest, ListShowsResponse, Sort,
  Shows: { typeName: "theatre.Shows", methods: [
    { name: "ListShows", options: { "kaja.http_request": "GET /shows" }, I: ListShowsRequest, O: ListShowsResponse }
  ] },
};
export const proto$theatre$client = { ShowsClient: class { listShows() {} } };
`;

async function catalog() {
  const apiSources: ApiSource[] = [
    { path: "proto/theatre.ts", content: serviceTs },
    { path: "proto/theatre.client.ts", content: clientTs },
  ] as ApiSource[];
  const app = await loadApp(apiSources, stubCode, { name: "theatre", app: { oneofKind: "openapi" } } as any, "kaja-app://x", 1 as any);
  app.compilation.status = "success";
  return buildMcpCatalog([app]);
}

describe("buildMcpCatalog", () => {
  it("indexes apps, services and methods with their types", async () => {
    const built = await catalog();

    expect(built.apps).toHaveLength(1);
    expect(built.apps[0].name).toBe("theatre");
    expect(built.apps[0].type).toBe("openapi");

    const service = built.apps[0].services[0];
    expect(service.name).toBe("Shows");
    expect(service.importPath).toBe("theatre/proto/theatre");

    const method = service.methods[0];
    expect(method.name).toBe("ListShows");
    expect(method.input).toBe("theatre.ListShowsRequest");
    expect(method.output).toBe("theatre.ListShowsResponse");
    // The HTTP request is what says the method reads rather than writes.
    expect(method.http).toBe("GET /shows");
    expect(method.doc).toBe("Lists the shows on sale.");
  });

  it("collects every type a method reaches, transitively", async () => {
    const built = await catalog();
    expect(Object.keys(built.types).sort()).toEqual(["theatre.ListShowsRequest", "theatre.ListShowsResponse", "theatre.Show", "theatre.Show_Venue"]);
    expect(built.enums["theatre.Sort"].values).toEqual(["UNSPECIFIED", "NEWEST"]);
  });

  it("marks what the API said about each field", async () => {
    const built = await catalog();

    const request = built.types["theatre.ListShowsRequest"];
    expect(request.fields[0]).toEqual({ name: "pageSize", kind: "scalar", type: "int32", in: "query", doc: "How many shows to return." });
    expect(request.importPath).toBe("theatre/proto/theatre");
    expect(built.enums["theatre.Sort"].importPath).toBe("theatre/proto/theatre");
    expect(request.fields[1]).toEqual({ name: "sort", kind: "enum", type: "theatre.Sort" });

    const show = built.types["theatre.Show"];
    expect(show.doc).toBe("A show in the catalog.");
    expect(show.fields[0]).toEqual({ name: "id", kind: "scalar", type: "string", required: true, doc: "Unique slug of the show." });
    expect(show.fields[1]).toEqual({ name: "venue", kind: "message", type: "theatre.Show_Venue" });
    // A nested message keeps the name a script writes, not just the proto one.
    expect(built.types["theatre.Show_Venue"].ts).toBe("Show_Venue");

    const response = built.types["theatre.ListShowsResponse"];
    expect(response.fields[0]).toEqual({ name: "items", kind: "message", type: "theatre.Show", repeated: true, envelope: true });
  });

  it("leaves out an app that has not compiled", async () => {
    const apiSources: ApiSource[] = [
      { path: "proto/theatre.ts", content: serviceTs },
      { path: "proto/theatre.client.ts", content: clientTs },
    ] as ApiSource[];
    const app = await loadApp(apiSources, stubCode, { name: "theatre", app: { oneofKind: "openapi" } } as any, "t", 1 as any);
    expect(buildMcpCatalog([app]).apps).toHaveLength(0);
  });

  it("emits sources on real lines, not one line per module", async () => {
    const built = await catalog();
    const source = built.sources.find((candidate) => candidate.path === "theatre/proto/theatre");
    expect(source).toBeDefined();
    // The service const holds one method per line, so a line-based reader can find
    // a signature without pulling the whole module in.
    const line = source!.content.split("\n").find((candidate) => candidate.includes("ListShows: async"));
    expect(line).toBeDefined();
    expect(line!.length).toBeLessThan(120);
  });
});

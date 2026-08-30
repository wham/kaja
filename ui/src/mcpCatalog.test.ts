import { describe, expect, it } from "bun:test";
import { loadApp } from "./appLoader";
import { buildMcpCatalog } from "./mcpCatalog";
import type { Source as ApiSource } from "./server/api";

// createClients reads window.location for the base URL; provide it as the browser would.
(globalThis as any).window = { location: { href: "http://localhost/" } };

// A generated surface in the shape protoc-gen-kaja emits for an OpenAPI app: the
// interfaces a script writes against, an enum, and the JSDoc the API's own
// descriptions arrive as — alongside the protobuf bookkeeping that has to be
// dropped before an agent reads any of it.
const serviceTs = `
import { ServiceType } from "@protobuf-ts/runtime-rpc";
import { Value } from "./google/protobuf/struct";
/**
 * A show in the catalog.
 *
 * @generated from protobuf message theatre.Show
 */
export interface Show {
    /**
     * Unique slug of the show.
     *
     * @generated from protobuf field: string id = 1
     */
    id: string;
    /**
     * @generated from protobuf field: theatre.Venue venue = 2
     */
    venue?: Venue;
    /**
     * @generated from protobuf field: google.protobuf.Value extras = 3
     */
    extras?: Value;
}
export interface Venue {
    name: string;
}
export interface ListShowsRequest {
    /**
     * How many shows to return. Defaults to 25 when omitted.
     *
     * @generated from protobuf field: int32 page_size = 1
     */
    pageSize: number;
    sort: Sort;
}
export interface ListShowsResponse {
    items: Show[];
}
export interface GetShowRequest {
    /**
     * @generated from protobuf field: string show_id = 1
     */
    showId: string;
    fields: string[];
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
    /**
     * @generated from protobuf rpc: GetShow
     */
    getShow(input: GetShowRequest, options?: RpcOptions): UnaryCall<GetShowRequest, Show>;
}
`;

// Stand-ins for the runtime MessageType objects, carrying the marks the app writes
// where TypeScript has no way to say them.
const stubCode = `
const Venue = { typeName: "theatre.Venue", fields: [ { no: 1, name: "name", localName: "name", jsonName: "name", kind: "scalar", T: 9 } ] };
const Value = { typeName: "google.protobuf.Value", fields: [] };
const Show = { typeName: "theatre.Show", fields: [
  { no: 1, name: "id", localName: "id", jsonName: "id", kind: "scalar", T: 9, options: { "kaja.http_required": true } },
  { no: 2, name: "venue", localName: "venue", jsonName: "venue", kind: "message", T: () => Venue },
  { no: 3, name: "extras", localName: "extras", jsonName: "extras", kind: "message", T: () => Value }
] };
const Sort = { 0: "UNSPECIFIED", 1: "NEWEST", UNSPECIFIED: 0, NEWEST: 1 };
const ListShowsRequest = { typeName: "theatre.ListShowsRequest", fields: [
  { no: 1, name: "page_size", localName: "pageSize", jsonName: "pageSize", kind: "scalar", T: 5, options: { "kaja.http_in": "query" } },
  { no: 2, name: "sort", localName: "sort", jsonName: "sort", kind: "enum", T: () => ["theatre.Sort", Sort, "SORT_"] }
] };
const ListShowsResponse = { typeName: "theatre.ListShowsResponse", fields: [
  { no: 1, name: "items", localName: "items", jsonName: "items", kind: "message", repeat: 2, T: () => Show, options: { "kaja.http_payload": "HTTP_PAYLOAD_ITEMS" } }
] };
const GetShowRequest = { typeName: "theatre.GetShowRequest", fields: [
  { no: 1, name: "show_id", localName: "showId", jsonName: "showId", kind: "scalar", T: 9, options: { "kaja.http_in": "path", "kaja.http_required": true } },
  { no: 2, name: "fields", localName: "fields", jsonName: "fields", kind: "scalar", repeat: 2, T: 9, options: { "kaja.http_in": "query" } }
] };
export const proto$theatre = {
  Show, Venue, ListShowsRequest, ListShowsResponse, GetShowRequest, Sort,
  Shows: { typeName: "theatre.Shows", methods: [
    { name: "ListShows", options: { "kaja.http_request": "GET /shows" }, I: ListShowsRequest, O: ListShowsResponse },
    { name: "GetShow", options: { "kaja.http_request": "GET /shows/{showId}" }, I: GetShowRequest, O: Show }
  ] },
};
export const proto$theatre$client = { ShowsClient: class { listShows() {} } };
`;

async function loadTheatre(status: "success" | "pending" = "success") {
  const apiSources: ApiSource[] = [
    { path: "proto/theatre.ts", content: serviceTs },
    { path: "proto/theatre.client.ts", content: clientTs },
  ] as ApiSource[];
  const app = await loadApp(apiSources, stubCode, { name: "theatre", app: { oneofKind: "openapi" } } as any, "kaja-app://x");
  app.compilation.status = status;
  return app;
}

async function catalog() {
  return buildMcpCatalog([await loadTheatre()]);
}

describe("buildMcpCatalog", () => {
  it("indexes methods by the TypeScript a script writes", async () => {
    const built = await catalog();

    expect(built.apps).toHaveLength(1);
    expect(built.apps[0].name).toBe("theatre");
    expect(built.apps[0].type).toBe("openapi");

    const service = built.apps[0].services[0];
    expect(service.name).toBe("Shows");
    // The app declares Shows once, so the app is the whole import.
    expect(service.importPath).toBe("theatre");

    const method = service.methods[0];
    expect(method.name).toBe("ListShows");
    // Input<T> is the request with every field optional, which is what the call the
    // agent is handed leans on.
    expect(method.signature).toBe("ListShows(input: Input<ListShowsRequest>): Call<ListShowsResponse>");
    expect(method.input).toBe("ListShowsRequest");
    expect(method.output).toBe("ListShowsResponse");
    expect(method.doc).toBe("Lists the shows on sale.");
    // The HTTP request is what says the method reads rather than writes.
    expect(method.http).toBe("GET /shows");
  });

  it("declares each type as a script reads it, without the protobuf bookkeeping", async () => {
    const built = await catalog();
    const declarations = built.apps[0].declarations;

    expect(Object.keys(declarations).sort()).toEqual(["GetShowRequest", "ListShowsRequest", "ListShowsResponse", "Show", "Sort", "Venue"]);

    const show = declarations["Show"];
    expect(show.text).toBe(
      [
        "/** A show in the catalog. */",
        "export interface Show {",
        "    /** Unique slug of the show. [required] */",
        "    id: string;",
        "    venue?: Venue;",
        "    extras?: Value;",
        "}",
      ].join("\n"),
    );
    // The field numbers and wire types never reach a reader.
    expect(show.text).not.toContain("protobuf");
    // What the type reaches, so an answer can close over it.
    expect(show.references.sort()).toEqual(["Value", "Venue"]);
  });

  it("keeps the marks TypeScript has no way to state", async () => {
    const built = await catalog();
    const declarations = built.apps[0].declarations;

    expect(declarations["ListShowsRequest"].text).toContain("/** How many shows to return. Defaults to 25 when omitted. [query parameter] */");
    expect(declarations["ListShowsResponse"].text).toContain("[carries the HTTP payload]");
    // An enum field is unwritable without its values.
    expect(declarations["Sort"].text).toBe(["export enum Sort {", "    UNSPECIFIED = 0,", "    NEWEST = 1,", "}"].join("\n"));
  });

  // The call Kaja writes into a draft spells out every field, because that is where
  // a person meets the request. Here the declarations are printed right above it, so
  // the same page of `""` and `0` says nothing the reader hasn't just read and reads
  // as values being sent — only the fields the API insists on are written out.
  it("carries the call Kaja itself writes for the method, required fields only", async () => {
    const built = await catalog();
    const [listShows, getShow] = built.apps[0].services[0].methods;

    expect(listShows.example).toContain('import { Shows } from "theatre"');
    expect(listShows.example).toContain("Shows.ListShows({})");
    // Nothing in this request is required, so nothing is written out — including the
    // enum, whose import goes with it.
    expect(listShows.example).not.toContain("pageSize");
    expect(listShows.example).not.toContain("Sort");

    expect(getShow.example).toContain("Shows.GetShow(");
    expect(getShow.example).toContain('showId: ""');
    expect(getShow.example).not.toContain("fields");
  });

  it("leaves out an app that has not compiled", async () => {
    expect(buildMcpCatalog([await loadTheatre("pending")]).apps).toHaveLength(0);
  });

  // The kaja module is the other half of what a script is written against, and
  // the half that used to be described from memory in the guide rather than
  // carried. It rides along even when nothing compiled — how a script says what
  // it produced doesn't depend on an app.
  it("carries the kaja runtime declaration, with this workspace's variables", () => {
    const built = buildMcpCatalog([], ["API_BASE_URL"]);

    expect(built.apps).toHaveLength(0);
    expect(built.runtime).toContain("export declare const kaja: {");
    expect(built.runtime).toContain("table(columns: string[], rows?: RowSource, options?: { pageSize?: number }): Table;");
    // Including the verbs on the handle it hands back — the total is a number
    // only the script's source has, so an agent has to be able to read that it
    // is wanted.
    expect(built.runtime).toContain("total(count: number | undefined): void;");
    expect(built.runtime).toContain('"API_BASE_URL": string;');
    // The rule the type system can't state, said where the declaration is read.
    expect(built.runtime).toContain("a top-level `return` is an error");
  });
});

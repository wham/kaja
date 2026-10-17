import { describe, expect, it } from "bun:test";
import { loadApp } from "./appLoader";
import { buildMcpCatalog } from "./mcpCatalog";
import type { Manifest } from "./sources";

// createClients reads window.location for the base URL; provide it as the browser would.
(globalThis as any).window = { location: { href: "http://localhost/" } };

// A manifest in the shape protoc-gen-kaja writes for an OpenAPI app: the services
// and the types a script writes against, declared as an agent reads them.
const manifest: Manifest = {
  version: 2,
  modules: [
    {
      path: "proto/theatre.ts",
      editorText: "",
      messages: [
        {
          name: "Show",
          typeName: "theatre.Show",
          fields: [
            { no: 1, name: "id", kind: "scalar", T: 9, options: { "kaja.http_required": true } },
            { no: 2, name: "venue", kind: "message", T: "theatre.Venue" },
            { no: 3, name: "extras", kind: "message", T: "google.protobuf.Value" },
          ],
        },
        { name: "Venue", typeName: "theatre.Venue", fields: [{ no: 1, name: "name", kind: "scalar", T: 9 }] },
        {
          name: "ListShowsRequest",
          typeName: "theatre.ListShowsRequest",
          fields: [
            { no: 1, name: "page_size", kind: "scalar", T: 5, options: { "kaja.http_in": "query" } },
            { no: 2, name: "sort", kind: "enum", T: "theatre.Sort" },
          ],
        },
        {
          name: "ListShowsResponse",
          typeName: "theatre.ListShowsResponse",
          fields: [{ no: 1, name: "items", kind: "message", repeat: 2, T: "theatre.Show", options: { "kaja.http_payload": "HTTP_PAYLOAD_ITEMS" } }],
        },
        {
          name: "GetShowRequest",
          typeName: "theatre.GetShowRequest",
          fields: [
            { no: 1, name: "show_id", kind: "scalar", T: 9, options: { "kaja.http_in": "path", "kaja.http_required": true } },
            { no: 2, name: "fields", kind: "scalar", repeat: 2, T: 9, options: { "kaja.http_in": "query" } },
            { no: 3, name: "status", kind: "scalar", T: 9, options: { "kaja.enum_values": ["onSale", "cancelled"] } },
          ],
        },
      ],
      enums: [
        {
          name: "Sort",
          typeName: "theatre.Sort",
          values: [
            ["UNSPECIFIED", 0],
            ["NEWEST", 1],
          ],
          prefix: "SORT_",
        },
      ],
      services: [
        {
          name: "Shows",
          typeName: "theatre.Shows",
          methods: [
            {
              name: "ListShows",
              input: "ListShowsRequest",
              output: "ListShowsResponse",
              I: "theatre.ListShowsRequest",
              O: "theatre.ListShowsResponse",
              options: { "kaja.http_request": "GET /shows" },
              doc: "Lists the shows on sale.",
            },
            {
              name: "GetShow",
              input: "GetShowRequest",
              output: "Show",
              I: "theatre.GetShowRequest",
              O: "theatre.Show",
              options: { "kaja.http_request": "GET /shows/{showId}" },
            },
          ],
        },
      ],
      declarations: [
        {
          name: "Show",
          text: [
            "/** A show in the catalog. */",
            "export interface Show {",
            "    /** Unique slug of the show. [required] */",
            "    id: string;",
            "    venue?: Venue;",
            "    extras?: Value;",
            "}",
          ].join("\n"),
          references: ["Venue", "Value"],
        },
        { name: "Venue", text: "export interface Venue {\n    name: string;\n}", references: [] },
        { name: "ListShowsRequest", text: "export interface ListShowsRequest {\n    pageSize: number;\n    sort: Sort;\n}", references: ["Sort"] },
        { name: "ListShowsResponse", text: "export interface ListShowsResponse {\n    items: Show[];\n}", references: ["Show"] },
        { name: "GetShowRequest", text: "export interface GetShowRequest {\n    showId: string;\n}", references: [] },
        { name: "Sort", text: "export enum Sort {\n    UNSPECIFIED = 0,\n    NEWEST = 1,\n}", references: [] },
      ],
    },
    {
      path: "google/protobuf/struct.ts",
      editorText: "",
      messages: [{ name: "Value", typeName: "google.protobuf.Value", fields: [] }],
      enums: [],
      services: [],
      declarations: [],
    },
  ],
};

async function loadTheatre(status: "success" | "pending" = "success") {
  const app = await loadApp(manifest, { name: "theatre", app: { oneofKind: "openapi" } } as any);
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

  it("carries the declarations the app was generated with", async () => {
    const built = await catalog();
    const declarations = built.apps[0].declarations;

    expect(Object.keys(declarations).sort()).toEqual(["GetShowRequest", "ListShowsRequest", "ListShowsResponse", "Show", "Sort", "Venue"]);
    expect(declarations["Show"]).toEqual(manifest.modules[0].declarations[0]);
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

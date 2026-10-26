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
      path: "proto/github.ts",
      editorText: "",
      messages: [
        {
          name: "Repo",
          typeName: "github.Repo",
          fields: [
            { no: 1, name: "full_name", kind: "scalar", T: 9, options: { "kaja.http_required": true } },
            { no: 2, name: "owner", kind: "message", T: "github.Owner" },
            { no: 3, name: "extras", kind: "message", T: "google.protobuf.Value" },
          ],
        },
        { name: "Owner", typeName: "github.Owner", fields: [{ no: 1, name: "login", kind: "scalar", T: 9 }] },
        {
          name: "ReposListForAuthenticatedUserRequest",
          typeName: "github.ReposListForAuthenticatedUserRequest",
          fields: [
            { no: 1, name: "per_page", kind: "scalar", T: 5, options: { "kaja.http_in": "query" } },
            { no: 2, name: "sort", kind: "enum", T: "github.Sort" },
          ],
        },
        {
          name: "ReposListForAuthenticatedUserResponse",
          typeName: "github.ReposListForAuthenticatedUserResponse",
          fields: [{ no: 1, name: "items", kind: "message", repeat: 2, T: "github.Repo", options: { "kaja.http_payload": "HTTP_PAYLOAD_ITEMS" } }],
        },
        {
          name: "ReposGetRequest",
          typeName: "github.ReposGetRequest",
          fields: [
            { no: 1, name: "owner", kind: "scalar", T: 9, options: { "kaja.http_in": "path", "kaja.http_required": true } },
            { no: 2, name: "repo", kind: "scalar", T: 9, options: { "kaja.http_in": "path", "kaja.http_required": true } },
            { no: 3, name: "fields", kind: "scalar", repeat: 2, T: 9, options: { "kaja.http_in": "query" } },
            { no: 4, name: "visibility", kind: "scalar", T: 9, options: { "kaja.enum_values": ["public", "private"] } },
          ],
        },
      ],
      enums: [
        {
          name: "Sort",
          typeName: "github.Sort",
          values: [
            ["UNSPECIFIED", 0],
            ["NEWEST", 1],
          ],
          prefix: "SORT_",
        },
      ],
      services: [
        {
          name: "Repos",
          typeName: "github.Repos",
          methods: [
            {
              name: "ListForAuthenticatedUser",
              input: "ReposListForAuthenticatedUserRequest",
              output: "ReposListForAuthenticatedUserResponse",
              I: "github.ReposListForAuthenticatedUserRequest",
              O: "github.ReposListForAuthenticatedUserResponse",
              options: { "kaja.http_request": "GET /user/repos" },
              doc: "Lists the repositories the authenticated user can reach.",
            },
            {
              name: "Get",
              input: "ReposGetRequest",
              output: "Repo",
              I: "github.ReposGetRequest",
              O: "github.Repo",
              options: { "kaja.http_request": "GET /repos/{owner}/{repo}" },
            },
          ],
        },
      ],
      declarations: [
        {
          name: "Repo",
          text: [
            "/** A repository on GitHub. */",
            "export interface Repo {",
            "    /** The repository's owner/name. [required] */",
            "    fullName: string;",
            "    owner?: Owner;",
            "    extras?: Value;",
            "}",
          ].join("\n"),
          references: ["Owner", "Value"],
        },
        { name: "Owner", text: "export interface Owner {\n    login: string;\n}", references: [] },
        {
          name: "ReposListForAuthenticatedUserRequest",
          text: "export interface ReposListForAuthenticatedUserRequest {\n    perPage: number;\n    sort: Sort;\n}",
          references: ["Sort"],
        },
        {
          name: "ReposListForAuthenticatedUserResponse",
          text: "export interface ReposListForAuthenticatedUserResponse {\n    items: Repo[];\n}",
          references: ["Repo"],
        },
        { name: "ReposGetRequest", text: "export interface ReposGetRequest {\n    owner: string;\n    repo: string;\n}", references: [] },
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

async function loadGitHub(status: "success" | "pending" = "success") {
  const app = await loadApp(manifest, { name: "github", app: { oneofKind: "openapi" } } as any);
  app.compilation.status = status;
  return app;
}

async function catalog() {
  return buildMcpCatalog([await loadGitHub()]);
}

describe("buildMcpCatalog", () => {
  it("indexes methods by the TypeScript a script writes", async () => {
    const built = await catalog();

    expect(built.apps).toHaveLength(1);
    expect(built.apps[0].name).toBe("github");
    expect(built.apps[0].type).toBe("openapi");

    const service = built.apps[0].services[0];
    expect(service.name).toBe("Repos");
    // The app declares Repos once, so the app is the whole import.
    expect(service.importPath).toBe("github");

    const method = service.methods[0];
    expect(method.name).toBe("ListForAuthenticatedUser");
    // Input<T> is the request with every field optional, which is what the call the
    // agent is handed leans on.
    expect(method.signature).toBe("ListForAuthenticatedUser(input: Input<ReposListForAuthenticatedUserRequest>): Call<ReposListForAuthenticatedUserResponse>");
    expect(method.input).toBe("ReposListForAuthenticatedUserRequest");
    expect(method.output).toBe("ReposListForAuthenticatedUserResponse");
    expect(method.doc).toBe("Lists the repositories the authenticated user can reach.");
    // The HTTP request is what says the method reads rather than writes.
    expect(method.http).toBe("GET /user/repos");
  });

  it("carries the declarations the app was generated with", async () => {
    const built = await catalog();
    const declarations = built.apps[0].declarations;

    expect(Object.keys(declarations).sort()).toEqual([
      "Owner",
      "Repo",
      "ReposGetRequest",
      "ReposListForAuthenticatedUserRequest",
      "ReposListForAuthenticatedUserResponse",
      "Sort",
    ]);
    expect(declarations["Repo"]).toEqual(manifest.modules[0].declarations[0]);
  });

  // The call Kaja writes into a draft spells out every field, because that is where
  // a person meets the request. Here the declarations are printed right above it, so
  // the same page of `""` and `0` says nothing the reader hasn't just read and reads
  // as values being sent — only the fields the API insists on are written out.
  it("carries the call Kaja itself writes for the method, required fields only", async () => {
    const built = await catalog();
    const [listRepos, getRepo] = built.apps[0].services[0].methods;

    expect(listRepos.example).toContain('import { Repos } from "github"');
    expect(listRepos.example).toContain("Repos.ListForAuthenticatedUser({})");
    // Nothing in this request is required, so nothing is written out — including the
    // enum, whose import goes with it.
    expect(listRepos.example).not.toContain("perPage");
    expect(listRepos.example).not.toContain("Sort");

    expect(getRepo.example).toContain("Repos.Get(");
    expect(getRepo.example).toContain('owner: ""');
    expect(getRepo.example).toContain('repo: ""');
    expect(getRepo.example).not.toContain("fields");
  });

  it("leaves out an app that has not compiled", async () => {
    expect(buildMcpCatalog([await loadGitHub("pending")]).apps).toHaveLength(0);
  });

  // The kaja module is the other half of what a script is written against, and
  // the half that used to be described from memory in the guide rather than
  // carried. It rides along even when nothing compiled — how a script says what
  // it produced doesn't depend on an app.
  it("carries the kaja runtime declaration, with this workspace's variables", () => {
    const built = buildMcpCatalog([], ["API_BASE_URL"]);

    expect(built.apps).toHaveLength(0);
    expect(built.runtime).toContain("export declare const kaja: {");
    expect(built.runtime).toContain("table(options?: TableOptions): Table;");
    // Including the verbs on the handle it hands back — the total is a number
    // only the script's source has, so an agent has to be able to read that it
    // is wanted.
    expect(built.runtime).toContain("total(count: number | undefined): void;");
    expect(built.runtime).toContain('"API_BASE_URL": string;');
    // The rule the type system can't state, said where the declaration is read.
    expect(built.runtime).toContain("a top-level `return` is an error");
  });
});

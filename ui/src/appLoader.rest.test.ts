import { describe, it, expect } from "bun:test";
import { generateMethodEditorCode, loadApp } from "./appLoader";
import type { Source as ApiSource } from "./server/api";

(globalThis as any).window = { location: { href: "http://localhost/" } };

// An app whose methods carry the HTTP request they transcode to — what
// server/pkg/apps/openapi writes onto every method it generates.
const serviceTs = `
import { ServiceType } from "@protobuf-ts/runtime-rpc";
export interface ListShowsRequest { pageSize: number; }
export interface ListShowsResponse { items: string[]; }
export interface GetShowRequest { showId: string; expand: string; }
export interface CreateShowRequest { title: string; }
export interface Show { id: string; }
export const Shows = new ServiceType("Shows", []);
`;

const clientTs = `
import type { RpcOptions, UnaryCall } from "@protobuf-ts/runtime-rpc";
import type { ListShowsRequest, ListShowsResponse, GetShowRequest, CreateShowRequest, Show } from "./service";
export interface IShowsClient {
    /**
     * List every show in the season.
     */
    listShows(input: ListShowsRequest, options?: RpcOptions): UnaryCall<ListShowsRequest, ListShowsResponse>;
    /**
     * Fetch one show by its id.
     */
    getShow(input: GetShowRequest, options?: RpcOptions): UnaryCall<GetShowRequest, Show>;
    /**
     * Create a show.
     */
    createShow(input: CreateShowRequest, options?: RpcOptions): UnaryCall<CreateShowRequest, Show>;
}
`;

// The field options are what the app writes where protobuf has no shape for what it
// needs to say: which fields travel in the path, and which the API insists on.
const stubCode = `
export const proto$service = {
  Shows: {
    typeName: "theatre.Shows",
    methods: [
      { name: "ListShows", options: { "kaja.http_request": "GET /shows" },
        I: { fields: [{ localName: "pageSize", options: { "kaja.http_in": "query" } }] } },
      { name: "GetShow", options: { "kaja.http_request": "GET /shows/{showId}" },
        I: { fields: [{ localName: "showId", options: { "kaja.http_in": "path", "kaja.http_required": true } },
                      { localName: "expand", options: { "kaja.http_in": "query" } }] } },
      { name: "CreateShow", options: { "kaja.http_request": "POST /shows" },
        I: { fields: [{ localName: "title", options: { "kaja.http_required": true } }] } },
    ],
  },
};
export const proto$service$client = { ShowsClient: class { listShows() {} getShow() {} createShow() {} } };
`;

async function restApp() {
  const apiSources: ApiSource[] = [
    { path: "proto/service.ts", content: serviceTs },
    { path: "proto/service.client.ts", content: clientTs },
  ] as ApiSource[];
  return loadApp(apiSources, stubCode, { name: "theatre" } as any, "kaja-app://x", "grpc" as any);
}

describe("the REST door", () => {
  it("writes one overload per operation, addressed by the API's own path", async () => {
    const app = await restApp();
    const text = app.sources.find((s) => s.serviceNames.includes("Shows"))!.file.text;

    expect(text).toContain("export const api: {");
    expect(text).toContain(`get(path: "/shows", request?: Input<ListShowsRequest>, options?: CallOptions): Call<ListShowsResponse>;`);
    expect(text).toContain(`get(path: "/shows/{showId}", request: WithPath<GetShowRequest, "showId">, options?: CallOptions): Call<Show>;`);
    expect(text).toContain(`post(path: "/shows", request: Input<CreateShowRequest>, options?: CallOptions): Call<Show>;`);
  });

  // An overload is the only encoding that carries the API's description into the
  // editor's hover and signature help, which is the whole reason the door is written
  // as one rather than as a map keyed on the path.
  it("carries the API's own description onto each overload", async () => {
    const text = (await restApp()).sources.find((s) => s.serviceNames.includes("Shows"))!.file.text;
    expect(text).toContain("/** Fetch one show by its id. */");
    expect(text).toContain("/** List every show in the season. */");
  });

  it("insists on a path parameter and offers the request where nothing is insisted on", async () => {
    const text = (await restApp()).sources.find((s) => s.serviceNames.includes("Shows"))!.file.text;
    // Nothing required, so the request is optional and `api.get("/shows")` is the call.
    expect(text).toContain(`get(path: "/shows", request?:`);
    // A path parameter and a required body field each make it required.
    expect(text).toContain(`get(path: "/shows/{showId}", request:`);
    expect(text).toContain(`post(path: "/shows", request:`);
  });

  it("declares the door beside the services, so the module is one import", async () => {
    const app = await restApp();
    const source = app.sources.find((s) => s.serviceNames.includes("Shows"))!;
    expect(source.restDoor).toBe(true);
    // The door spells WithPath, so the module's type import carries it.
    expect(source.file.text).toContain('import type { Call, CallOptions, Input, WithPath } from "kaja";');
    // The service door is untouched: both address the same methods.
    expect(source.file.text).toContain("export const Shows = {");
  });

  it("writes no door for an app whose methods stand for no HTTP request", async () => {
    const plainStub = stubCode.replace(/"kaja.http_request": "[^"]*"/g, '"x": ""');
    const apiSources: ApiSource[] = [
      { path: "proto/service.ts", content: serviceTs },
      { path: "proto/service.client.ts", content: clientTs },
    ] as ApiSource[];
    const app = await loadApp(apiSources, plainStub, { name: "theatre" } as any, "kaja-app://x", "grpc" as any);
    const source = app.sources.find((s) => s.serviceNames.includes("Shows"))!;
    expect(source.restDoor).toBeFalsy();
    expect(source.file.text).not.toContain("export const api");
    expect(source.file.text).toContain('import type { Call, CallOptions, Input } from "kaja";');
  });
});

describe("the code a REST method generates", () => {
  it("writes the call the way the API addresses it, under the app's own name", async () => {
    const app = await restApp();
    const service = app.services.find((s) => s.name === "Shows")!;
    const code = generateMethodEditorCode(
      app,
      service,
      service.methods.find((m) => m.name === "GetShow")!,
    );

    expect(code).toContain('import { api as theatre } from "theatre";');
    expect(code).toContain('theatre.get("/shows/{showId}", {');
    expect(code).toContain("showId:");
    // The generated name is nowhere in it — the path is the name.
    expect(code).not.toContain("GetShow");
  });

  it("writes the verb the operation is, not the one it reads like", async () => {
    const app = await restApp();
    const service = app.services.find((s) => s.name === "Shows")!;
    const code = generateMethodEditorCode(
      app,
      service,
      service.methods.find((m) => m.name === "CreateShow")!,
    );
    expect(code).toContain('theatre.post("/shows", {');
  });

  it("leaves a method that stands for no HTTP request on the service door", async () => {
    const plainStub = stubCode.replace(/"kaja.http_request": "[^"]*"/g, '"x": ""');
    const app = await loadApp(
      [
        { path: "proto/service.ts", content: serviceTs },
        { path: "proto/service.client.ts", content: clientTs },
      ] as ApiSource[],
      plainStub,
      { name: "theatre" } as any,
      "kaja-app://x",
      "grpc" as any,
    );
    const service = app.services.find((s) => s.name === "Shows")!;
    const code = generateMethodEditorCode(
      app,
      service,
      service.methods.find((m) => m.name === "GetShow")!,
    );
    expect(code).toContain('import { Shows } from "theatre";');
    expect(code).toContain("Shows.GetShow({");
  });

  // The alias is what keeps two REST apps in one script readable, so an app whose name
  // could not be one falls back to the export's own name rather than to broken code.
  it("keeps the plain name where the app's name is no identifier", async () => {
    const app = await loadApp(
      [
        { path: "proto/service.ts", content: serviceTs },
        { path: "proto/service.client.ts", content: clientTs },
      ] as ApiSource[],
      stubCode,
      { name: "grpcb.in" } as any,
      "kaja-app://x",
      "grpc" as any,
    );
    const service = app.services.find((s) => s.name === "Shows")!;
    const code = generateMethodEditorCode(
      app,
      service,
      service.methods.find((m) => m.name === "ListShows")!,
    );
    expect(code).toContain('import { api } from "grpcb.in";');
    expect(code).toContain('api.get("/shows", {');
  });
});

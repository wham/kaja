import { describe, expect, it, test } from "bun:test";
import ts from "typescript";
import { generateMethodEditorCode, loadApp } from "./appLoader";
import { DEPRECATION_NOTE, isDeprecated } from "./deprecation";
import type { Source as ApiSource } from "./server/api";

// createClients reads window.location for the base URL; provide it as the browser would.
(globalThis as any).window = { location: { href: "http://localhost/" } };

test("the tag counts on a line of its own, and the word in a sentence does not", () => {
  const file = ts.createSourceFile(
    "t.ts",
    [
      "/**",
      " * Finds pets by tags.",
      " * @deprecated",
      " */",
      "declare const marked: number;",
      "/** Use tags instead — @deprecated is coming. */",
      "declare const prose: number;",
      "declare const plain: number;",
    ].join("\n"),
    ts.ScriptTarget.Latest,
  );
  const [marked, prose, plain] = file.statements;
  expect(isDeprecated(marked, file)).toBe(true);
  expect(isDeprecated(prose, file)).toBe(false);
  expect(isDeprecated(plain, file)).toBe(false);
});

// One method the API asks callers off, one it says nothing about. `@deprecated` is
// what every app says it with: protoc-gen-kaja writes it for `option deprecated =
// true` on an rpc, which is what an OpenAPI `deprecated: true` becomes.
const serviceTs = `
import { ServiceType } from "@protobuf-ts/runtime-rpc";
export interface FindByTagsRequest { tags: string[]; }
export interface FindByStatusRequest { status: string; }
export interface Pets { items: string[]; }
export const Pet = new ServiceType("Pet", []);
`;

const clientTs = `
import type { RpcOptions, UnaryCall } from "@protobuf-ts/runtime-rpc";
import type { FindByStatusRequest, FindByTagsRequest, Pets } from "./pet";
export interface IPetClient {
    /**
     * Finds Pets by tags.
     *
     * @deprecated
     * @generated from protobuf rpc: FindByTags
     */
    findByTags(input: FindByTagsRequest, options?: RpcOptions): UnaryCall<FindByTagsRequest, Pets>;
    /**
     * Finds Pets by status.
     *
     * @generated from protobuf rpc: FindByStatus
     */
    findByStatus(input: FindByStatusRequest, options?: RpcOptions): UnaryCall<FindByStatusRequest, Pets>;
}
`;

const stubCode = `
export const proto$pet = {
  Pet: {
    typeName: "petstore.Pet",
    methods: [
      { name: "FindByTags", I: { typeName: "petstore.FindByTagsRequest", fields: [] } },
      { name: "FindByStatus", I: { typeName: "petstore.FindByStatusRequest", fields: [] } },
    ],
  },
};
export const proto$pet$client = { PetClient: class {} };
`;

async function petstore() {
  const apiSources: ApiSource[] = [
    { path: "proto/pet.ts", content: serviceTs },
    { path: "proto/pet.client.ts", content: clientTs },
  ] as ApiSource[];
  return loadApp(apiSources, stubCode, { name: "petstore", app: { oneofKind: "openapi" } } as any);
}

describe("a method the API deprecated", () => {
  it("is read off the generated declaration, and only where the tag is", async () => {
    const app = await petstore();
    const service = app.services.find((s) => s.name === "Pet")!;

    expect(service.methods.find((m) => m.name === "FindByTags")!.deprecated).toBe(true);
    expect(service.methods.find((m) => m.name === "FindByStatus")!.deprecated).toBeUndefined();
  });

  it("still writes its call, under the sentence saying who deprecated it", async () => {
    const app = await petstore();
    const service = app.services.find((s) => s.name === "Pet")!;

    const code = generateMethodEditorCode(
      app,
      service,
      service.methods.find((m) => m.name === "FindByTags")!,
    );
    expect(code).toContain(`// ${DEPRECATION_NOTE}`);
    expect(code).toContain("Pet.FindByTags(");
    expect(code.indexOf("// Deprecated")).toBeGreaterThan(code.indexOf("import"));

    const plain = generateMethodEditorCode(
      app,
      service,
      service.methods.find((m) => m.name === "FindByStatus")!,
    );
    expect(plain).not.toContain("Deprecated");
  });
});

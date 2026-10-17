import { describe, expect, it } from "bun:test";
import { generateMethodEditorCode, loadApp } from "./appLoader";
import { DEPRECATION_NOTE } from "./deprecation";
import type { Manifest } from "./sources";

// createClients reads window.location for the base URL; provide it as the browser would.
(globalThis as any).window = { location: { href: "http://localhost/" } };

// One method the API asks callers off, one it says nothing about. protoc-gen-kaja
// marks a method for `option deprecated = true` on an rpc, which is what an OpenAPI
// `deprecated: true` becomes.
const empty = (name: string) => ({ name, typeName: `petstore.${name}`, fields: [] });

const manifest: Manifest = {
  version: 2,
  modules: [
    {
      path: "proto/pet.ts",
      editorText: "",
      messages: [empty("FindByTagsRequest"), empty("FindByStatusRequest"), empty("Pets")],
      enums: [],
      services: [
        {
          name: "Pet",
          typeName: "petstore.Pet",
          methods: [
            {
              name: "FindByTags",
              input: "FindByTagsRequest",
              output: "Pets",
              I: "petstore.FindByTagsRequest",
              O: "petstore.Pets",
              doc: "Finds Pets by tags.",
              deprecated: true,
            },
            {
              name: "FindByStatus",
              input: "FindByStatusRequest",
              output: "Pets",
              I: "petstore.FindByStatusRequest",
              O: "petstore.Pets",
              doc: "Finds Pets by status.",
            },
          ],
        },
      ],
      declarations: [],
    },
  ],
};

async function petstore() {
  return loadApp(manifest, { name: "petstore", app: { oneofKind: "openapi" } } as any);
}

describe("a method the API deprecated", () => {
  it("is read off the manifest, and only where it is marked", async () => {
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

import { describe, it, expect, beforeEach } from "bun:test";
import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import { App } from "./apps";
import { clearTypeMemory, rememberValues } from "./typeMemory";
import { resolveValuePosition, suggestValues } from "./valueCompletions";

function messageType(typeName: string, fields: any[]): IMessageType<any> {
  return {
    typeName,
    fields: fields.map((field, index) => ({ no: index + 1, localName: field.name, ...field })),
  } as unknown as IMessageType<any>;
}

const license = messageType("repos.v1.License", [{ name: "name", kind: "scalar", T: ScalarType.STRING }]);

const repo = messageType("repos.v1.Repo", [
  { name: "id", kind: "scalar", T: ScalarType.STRING },
  { name: "stars", kind: "scalar", T: ScalarType.INT32 },
  { name: "license", kind: "message", T: () => license },
  { name: "labels", kind: "map", K: ScalarType.STRING, V: { kind: "scalar", T: ScalarType.STRING } },
]);

const getRepoRequest = messageType("repos.v1.GetRepoRequest", [{ name: "id", kind: "scalar", T: ScalarType.STRING }]);

// The app said this field takes one of three words, the way an OpenAPI app carries
// a document's enum.
const searchReposRequest = messageType("repos.v1.SearchReposRequest", [
  { name: "state", kind: "scalar", T: ScalarType.STRING, options: { "kaja.enum_values": ["open", "closed", "all"] } },
]);

const updateRepoRequest = messageType("repos.v1.UpdateRepoRequest", [{ name: "repo", kind: "message", T: () => repo }]);

// An app exposing ReposService.GetRepo and ReposService.UpdateRepo, shaped
// the way loadApp builds one.
function reposApp(): App {
  const path = "demo/proto/repos.ts";
  return {
    services: [{ name: "ReposService", packageName: "repos.v1", sourcePath: "demo/proto/repos", typeName: "repos.v1.Repos", methods: [] }],
    reflection: {
      messages: new Map(),
      enums: new Map(),
      services: new Map([
        [
          "repos.v1.Repos",
          {
            typeName: "repos.v1.Repos",
            methods: [
              { name: "GetRepo", I: getRepoRequest, O: repo },
              { name: "UpdateRepo", I: updateRepoRequest, O: repo },
              { name: "SearchRepos", I: searchReposRequest, O: repo },
            ],
          },
        ],
      ]),
    },
    sources: [
      {
        path,
        importPath: "demo/proto/repos",
        serviceNames: ["ReposService"],
        interfaces: {},
        enums: {},
      },
    ],
  } as unknown as App;
}

const imports = `import { ReposService } from "demo/proto/repos";\n\n`;

// Split code at the | marking the cursor, into the code without it and its offset.
function atMarker(code: string): { code: string; offset: number } {
  const offset = code.indexOf("|");
  return { code: code.slice(0, offset) + code.slice(offset + 1), offset };
}

function resolveAt(marked: string, apps: App[] = [reposApp()]) {
  const { code, offset } = atMarker(marked);
  return resolveValuePosition(code, offset, apps);
}

describe("resolveValuePosition", () => {
  it("resolves a scalar field inside a string literal", () => {
    const position = resolveAt(`${imports}ReposService.GetRepo({ id: "|" });`);

    expect(position?.typeName).toBe("repos.v1.GetRepoRequest");
    expect(position?.fieldName).toBe("id");
    expect(position?.scalarType).toBe(ScalarType.STRING);
    expect(position?.stringRange).toBeDefined();
  });

  it("resolves a number field outside a string literal", () => {
    const position = resolveAt(`${imports}ReposService.UpdateRepo({ repo: { stars: 0| } });`);

    expect(position?.typeName).toBe("repos.v1.Repo");
    expect(position?.fieldName).toBe("stars");
    expect(position?.scalarType).toBe(ScalarType.INT32);
    expect(position?.stringRange).toBeUndefined();
  });

  it("resolves a field of a nested message", () => {
    const position = resolveAt(`${imports}ReposService.UpdateRepo({ repo: { license: { name: "|" } } });`);

    expect(position?.typeName).toBe("repos.v1.License");
    expect(position?.fieldName).toBe("name");
  });

  it("resolves a map value to the map field", () => {
    const position = resolveAt(`${imports}ReposService.UpdateRepo({ repo: { labels: { key: "|" } } });`);

    expect(position?.typeName).toBe("repos.v1.Repo");
    expect(position?.fieldName).toBe("labels");
    expect(position?.scalarType).toBe(ScalarType.STRING);
  });

  it("reads the values the app declared for the field", () => {
    const position = resolveAt(`${imports}ReposService.SearchRepos({ state: "|" });`);

    expect(position?.declared).toEqual(["open", "closed", "all"]);
  });

  it("declares nothing for a field the app said nothing about", () => {
    expect(resolveAt(`${imports}ReposService.GetRepo({ id: "|" });`)?.declared).toEqual([]);
  });

  it("ignores the property name side", () => {
    expect(resolveAt(`${imports}ReposService.GetRepo({ i|d: "" });`)).toBeUndefined();
  });

  it("ignores a field that is not a scalar", () => {
    expect(resolveAt(`${imports}ReposService.UpdateRepo({ repo: {| } });`)).toBeUndefined();
  });

  it("ignores calls to an unknown service", () => {
    expect(resolveAt(`${imports}OtherService.GetRepo({ id: "|" });`)).toBeUndefined();
  });

  it("ignores a service imported from another app", () => {
    const code = `import { ReposService } from "other/proto/repos";\n\nReposService.GetRepo({ id: "|" });`;
    expect(resolveAt(code)).toBeUndefined();
  });

  it("resolves a service without an import, as scripts may write it", () => {
    const position = resolveAt(`ReposService.GetRepo({ id: "|" });`);
    expect(position?.fieldName).toBe("id");
  });
});

describe("suggestValues", () => {
  beforeEach(() => {
    clearTypeMemory();
  });

  function suggestAt(marked: string) {
    const { code, offset } = atMarker(marked);
    return suggestValues(code, offset, [reposApp()]);
  }

  it("offers nothing when nothing has been called yet", () => {
    expect(suggestAt(`${imports}ReposService.GetRepo({ id: "|" });`)).toBeUndefined();
  });

  it("offers the ids a response came back with", () => {
    rememberValues("repos.v1.Repo", { id: "repo-7" }, repo, { method: "ReposService.ListRepos", origin: "response" });

    const suggested = suggestAt(`${imports}ReposService.GetRepo({ id: "|" });`);

    expect(suggested?.values.map((value) => value.value)).toEqual(["repo-7"]);
    expect(suggested?.values[0].origin).toBe("response");
    expect(suggested?.values[0].typeName).toBe("repos.v1.Repo");
  });

  it("offers the values the API declares before anything has been called", () => {
    const suggested = suggestAt(`${imports}ReposService.SearchRepos({ state: "|" });`);

    expect(suggested?.position.declared).toEqual(["open", "closed", "all"]);
    expect(suggested?.values).toEqual([]);
  });

  it("leaves a declared value to the API rather than offering it twice", () => {
    rememberValues("repos.v1.SearchReposRequest", { state: "closed" }, searchReposRequest, { method: "ReposService.SearchRepos", origin: "request" });

    const suggested = suggestAt(`${imports}ReposService.SearchRepos({ state: "|" });`);

    expect(suggested?.position.declared).toEqual(["open", "closed", "all"]);
    expect(suggested?.values).toEqual([]);
  });

  it("puts what was sent to this exact field first", () => {
    rememberValues("repos.v1.Repo", { id: "from-response" }, repo, { method: "ReposService.ListRepos", origin: "response" });
    rememberValues("repos.v1.GetRepoRequest", { id: "from-request" }, getRepoRequest, { method: "ReposService.GetRepo", origin: "request" });

    const suggested = suggestAt(`${imports}ReposService.GetRepo({ id: "|" });`);

    expect(suggested?.values.map((value) => value.value)).toEqual(["from-request", "from-response"]);
  });
});

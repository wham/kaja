import { describe, expect, it } from "bun:test";
import type { CallExpression, Node } from "@babel/types";
import { buildApp } from "../appTypes";
import { readInputKeys } from "../scriptInputs";
import { readRunReferences } from "../scriptRuns";
import { parseScript, walk } from "../scriptSyntax";
import { collectionFor, collections, instantiateStory, linkedStory, storyById, storyId, storyServices } from "./index";

const github = collections.find((collection) => collection.id === "github")!;
const benchling = collections.find((collection) => collection.id === "benchling")!;

function runCalls(code: string): { name: string; keys: string[] }[] {
  const calls: { name: string; keys: string[] }[] = [];
  walk(parseScript(code)!.program, (node: Node) => {
    if (node.type !== "CallExpression") return;
    const call = node as CallExpression;
    if (call.callee.type !== "MemberExpression" || call.callee.property.type !== "Identifier" || call.callee.property.name !== "run") return;
    const [name, input] = call.arguments;
    if (name?.type !== "StringLiteral") return;
    const keys =
      input?.type === "ObjectExpression"
        ? input.properties.flatMap((property) => (property.type === "ObjectProperty" && property.key.type === "Identifier" ? [property.key.name] : []))
        : [];
    calls.push({ name: name.value, keys });
  });
  return calls;
}

describe("the collections", () => {
  for (const collection of collections) {
    for (const story of collection.stories) {
      describe(`${collection.id}/${story.name}`, () => {
        it("parses", () => {
          expect(parseScript(story.code)).toBeDefined();
        });

        it("imports kaja and the collection's app and nothing else", () => {
          const modules = parseScript(story.code)!.program.body.flatMap((statement) =>
            statement.type === "ImportDeclaration" ? [statement.source.value] : [],
          );
          expect(modules.filter((module) => module !== "kaja" && module !== collection.importName)).toEqual([]);
        });

        it("runs only stories of its own collection, with keys they read", () => {
          for (const call of runCalls(story.code)) {
            const target = linkedStory(collection, call.name);
            expect(target).toBeDefined();
            const read = readInputKeys(target!.code) ?? [];
            for (const key of call.keys) expect(read).toContain(key);
          }
        });

        it("names the services it calls", () => {
          expect(storyServices(collection, story).length).toBeGreaterThan(0);
        });
      });
    }
  }

  it("gives every story a name of its own", () => {
    for (const collection of collections) {
      const names = collection.stories.map((story) => story.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

describe("collectionFor", () => {
  const openapi = (parameters: { [key: string]: string }) => buildApp("whatever", "openapi", parameters, {});

  it("matches the server the app calls", () => {
    expect(collectionFor(openapi({ specUrl: "https://example.com/spec.json", baseUrl: "https://api.github.com" }))).toBe(github);
  });

  it("reads the server the way a token's resource is read", () => {
    expect(collectionFor(openapi({ specUrl: "", baseUrl: "HTTPS://API.GITHUB.COM/" }))).toBe(github);
  });

  it("matches the known document when the app names no server", () => {
    expect(collectionFor(openapi({ specUrl: github.document, baseUrl: "" }))).toBe(github);
  });

  it("goes by the document whatever server the app calls", () => {
    expect(collectionFor(openapi({ specUrl: benchling.document, baseUrl: "https://acme.benchling.com/api/v3" }))).toBe(benchling);
    expect(collectionFor(openapi({ specUrl: github.document, baseUrl: "https://github.example.com/api/v3" }))).toBe(github);
  });

  it("is not reached through a server it doesn't name", () => {
    expect(collectionFor(openapi({ specUrl: "https://example.com/spec.json", baseUrl: "https://acme.benchling.com/api/v3" }))).toBeUndefined();
  });

  it("is not fooled by the name", () => {
    expect(collectionFor(buildApp("github", "openapi", { specUrl: "https://example.com/spec.json", baseUrl: "https://example.com" }, {}))).toBeUndefined();
  });

  it("belongs to an OpenAPI app only", () => {
    expect(collectionFor(buildApp("github", "mcp", { endpoint: "https://api.githubcopilot.com/mcp/" }, {}))).toBeUndefined();
  });
});

describe("instantiateStory", () => {
  const story = github.stories.find((candidate) => candidate.name === "my-pull-requests")!;

  it("imports the app under the name it was added as", () => {
    const code = instantiateStory(github, story, "work-github");
    expect(code).toContain(`from "work-github"`);
    expect(code).not.toContain(`from "github"`);
    expect(code).toContain(`from "kaja"`);
  });

  it("leaves the text alone under the collection's own name", () => {
    expect(instantiateStory(github, story, "github")).toBe(story.code);
  });
});

describe("story lookup", () => {
  it("finds a story by the id a draft records", () => {
    const story = github.stories[0];
    expect(storyById(storyId(github, story))).toEqual({ collection: github, story });
    expect(storyById("github/nothing")).toBeUndefined();
  });

  it("reaches a story by the name a kaja.run writes", () => {
    expect(linkedStory(github, "repo-pulse")?.name).toBe("repo-pulse");
    expect(linkedStory(github, "repo-pulse.ts")?.name).toBe("repo-pulse");
    expect(linkedStory(github, "nothing")).toBeUndefined();
  });

  it("sees the kaja.run the editor sees", () => {
    const story = github.stories.find((candidate) => candidate.name === "where-ive-been")!;
    expect(readRunReferences(story.code)?.map((reference) => reference.name)).toEqual(["repo-pulse"]);
  });

  it("reads the services off the imports", () => {
    const story = github.stories.find((candidate) => candidate.name === "my-pull-requests")!;
    expect(storyServices(github, story)).toEqual(["Pulls", "Search"]);
  });
});

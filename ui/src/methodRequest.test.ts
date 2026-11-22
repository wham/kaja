import { describe, expect, test } from "bun:test";
import { App } from "./apps";
import { parseMethodRequest, pathParts, readRequestHints } from "./methodRequest";

function app(): App {
  const methods = [
    { name: "Get", options: { "kaja.http_request": "GET /items/{id}" } },
    { name: "Remove", options: { "kaja.http_request": "DELETE /items/{id}" } },
    { name: "Plain" },
  ];
  return {
    configuration: { name: "store" },
    services: [{ name: "Items", packageName: "store", sourcePath: "store", typeName: "store.Items", methods: [] }],
    reflection: { messages: new Map(), enums: new Map(), services: new Map([["store.Items", { typeName: "store.Items", methods }]]) },
    sources: [{ path: "store.ts", importPath: "store", serviceNames: ["Items"], interfaces: {}, enums: {} }],
  } as unknown as App;
}

describe("parseMethodRequest", () => {
  test("tells a read from a write by the verb", () => {
    expect(parseMethodRequest("GET /items")).toEqual({ verb: "GET", path: "/items", write: false });
    expect(parseMethodRequest("patch /items/{id}")).toEqual({ verb: "PATCH", path: "/items/{id}", write: true });
  });

  test("has nothing to say about a method with no request", () => {
    expect(parseMethodRequest(undefined)).toBeUndefined();
    expect(parseMethodRequest("")).toBeUndefined();
  });
});

test("pathParts sets the parameters apart", () => {
  expect(pathParts("/a/{b}/c/{d}")).toEqual([
    { text: "/a/", parameter: false },
    { text: "{b}", parameter: true },
    { text: "/c/", parameter: false },
    { text: "{d}", parameter: true },
  ]);
});

describe("readRequestHints", () => {
  test("hints each call where the method's name ends, nested ones included", () => {
    const code = `import { Items } from "store";\nawait kaja.approve(Items.Remove({ id }));\nawait Promise.all([Items.Get({ id }), Items.Plain({})]);\n`;
    const hints = readRequestHints(code, [app()])!;
    expect(
      hints.map((hint) => [
        code
          .slice(0, hint.at)
          .split(/\s|\(|\[/)
          .pop(),
        hint.line.verb,
      ]),
    ).toEqual([
      ["Items.Remove", "DELETE"],
      ["Items.Get", "GET"],
    ]);
  });

  test("leaves a name the imports did not bind to the app alone", () => {
    expect(readRequestHints(`import { Items } from "elsewhere";\nItems.Get({});\n`, [app()])).toEqual([]);
  });

  test("has nothing to say about a file that doesn't parse", () => {
    expect(readRequestHints(`Items.Get(`, [app()])).toBeUndefined();
  });
});

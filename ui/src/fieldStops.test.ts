import { describe, expect, it } from "bun:test";
import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import { App } from "./apps";
import { fieldStops, hop, stopAt } from "./fieldStops";

const request = {
  typeName: "issues.v1.CreateRequest",
  fields: [
    { no: 1, localName: "owner", jsonName: "owner", kind: "scalar", T: ScalarType.STRING },
    { no: 2, localName: "repo", jsonName: "repo", kind: "scalar", T: ScalarType.STRING },
    { no: 3, localName: "count", jsonName: "count", kind: "scalar", T: ScalarType.INT32 },
  ],
} as unknown as IMessageType<any>;

const apps = [
  {
    configuration: { name: "issues" },
    services: [{ name: "Issues", packageName: "issues.v1", sourcePath: "issues", typeName: "issues.v1.Issues", methods: [] }],
    reflection: {
      messages: new Map(),
      enums: new Map(),
      services: new Map([["issues.v1.Issues", { typeName: "issues.v1.Issues", methods: [{ name: "Create", I: request, O: request }] }]]),
    },
    sources: [{ path: "issues.ts", importPath: "issues", serviceNames: ["Issues"], interfaces: {}, enums: {} }],
  } as unknown as App,
];

const script = `import { Issues } from "issues";

await Issues.Create({
  owner: kaja.input.owner,
  repo: "",
  count: 0,
});
`;

describe("fieldStops", () => {
  const stops = fieldStops(script, apps);

  it("stops inside a string's quotes and on a number whole, leaving what is computed", () => {
    expect(stops.map((stop) => [stop.key, script.slice(stop.from - 1, stop.to + 1)])).toEqual([
      ["repo", '""'],
      ["count", " 0,"],
    ]);
  });

  it("knows the stop the caret is in", () => {
    expect(stopAt(stops, stops[1].to)).toBe(1);
    expect(stopAt(stops, 0)).toBeUndefined();
  });

  it("hops from the stop the caret is in, or from where it stands", () => {
    expect(hop(stops, stops[0].from, true)).toBe(1);
    expect(hop(stops, stops[1].from, true)).toBeUndefined();
    expect(hop(stops, stops[0].from, false)).toBeUndefined();
    expect(hop(stops, 0, true)).toBe(0);
    expect(hop(stops, script.length, false)).toBe(1);
    expect(hop(stops, 0, false)).toBeUndefined();
  });
});

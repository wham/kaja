import { beforeEach, describe, expect, it } from "bun:test";
import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import { App } from "./apps";
import { controlFor, requestValues } from "./requestValues";
import { clearTypeMemory, rememberValues } from "./typeMemory";

function messageType(typeName: string, fields: any[]): IMessageType<any> {
  return {
    typeName,
    fields: fields.map((field, index) => ({ no: index + 1, localName: field.name, jsonName: field.name, ...field })),
  } as unknown as IMessageType<any>;
}

enum State {
  UNSPECIFIED = 0,
  OPEN = 1,
  CLOSED = 2,
}

const filter = messageType("issues.v1.Filter", [
  { name: "milestone", kind: "scalar", T: ScalarType.STRING },
  { name: "draft", kind: "scalar", T: ScalarType.BOOL },
]);

const listRequest = messageType("issues.v1.ListRequest", [
  { name: "owner", kind: "scalar", T: ScalarType.STRING },
  { name: "repo", kind: "scalar", T: ScalarType.STRING },
  { name: "state", kind: "enum", T: () => ["issues.v1.State", State, "STATE_"] },
  { name: "sort", kind: "scalar", T: ScalarType.STRING, options: { "kaja.enum_values": ["created", "updated"] } },
  { name: "perPage", kind: "scalar", T: ScalarType.INT32 },
  { name: "since", kind: "scalar", T: ScalarType.STRING },
  { name: "cursor", kind: "scalar", T: ScalarType.INT64 },
  { name: "filter", kind: "message", T: () => filter },
]);

function issuesApp(): App {
  return {
    configuration: { name: "issues" },
    services: [{ name: "Issues", packageName: "issues.v1", sourcePath: "issues", typeName: "issues.v1.Issues", methods: [] }],
    reflection: {
      messages: new Map(),
      enums: new Map(),
      services: new Map([["issues.v1.Issues", { typeName: "issues.v1.Issues", methods: [{ name: "List", I: listRequest, O: listRequest }] }]]),
    },
    sources: [{ path: "issues.ts", importPath: "issues", serviceNames: ["Issues"], interfaces: {}, enums: { State: { object: State } } }],
  } as unknown as App;
}

const apps = [issuesApp()];

const script = `import { Issues, State } from "issues";

const issues = await Issues.List({
  owner: kaja.input.owner,
  repo: 'kaja',
  state: State.OPEN,
  sort: "updated",
  perPage: 30,
  since: "2026-10-01T00:00:00Z",
  cursor: "10",
  filter: { milestone: "v2.4" },
});

await Issues.List(request);
`;

beforeEach(() => clearTypeMemory());

describe("requestValues", () => {
  it("lists every literal a request sends, at any depth, leaving what is computed", () => {
    const values = requestValues(script, apps);
    expect(values.map((value) => [value.key, script.slice(value.start, value.end)])).toEqual([
      ["repo", "'kaja'"],
      ["state", "State.OPEN"],
      ["sort", '"updated"'],
      ["perPage", "30"],
      ["since", '"2026-10-01T00:00:00Z"'],
      ["cursor", '"10"'],
      ["milestone", '"v2.4"'],
    ]);
    expect(new Set(values.map((value) => value.call))).toEqual(new Set([script.indexOf("Issues.List")]));
  });
});

describe("controlFor", () => {
  const value = (key: string) => requestValues(script, apps).find((candidate) => candidate.key === key)!;

  it("offers an enum's members, written through the name it was imported under", () => {
    const control = controlFor(value("state"), script);
    if (control?.kind !== "choice") throw new Error("expected a choice");
    expect(control.choices.map((choice) => [choice.label, choice.text, choice.selected])).toEqual([
      ["UNSPECIFIED", "State.UNSPECIFIED", false],
      ["OPEN", "State.OPEN", true],
      ["CLOSED", "State.CLOSED", false],
    ]);
  });

  it("offers the values an API declared, and a field for anything else", () => {
    const control = controlFor(value("sort"), script);
    if (control?.kind !== "choice") throw new Error("expected a choice");
    expect(control.choices.map((choice) => [choice.text, choice.selected])).toEqual([
      ['"created"', false],
      ['"updated"', true],
    ]);
    expect(control.other?.write("pushed")).toBe('"pushed"');
  });

  it("keeps the quote a string was written in", () => {
    const control = controlFor(value("repo"), script);
    if (control?.kind !== "text") throw new Error("expected text");
    expect(control.write("it's")).toBe("'it\\'s'");
  });

  it("refuses a number that isn't one", () => {
    const control = controlFor(value("perPage"), script);
    if (control?.kind !== "number") throw new Error("expected a number");
    expect(control.write("50")).toBe("50");
    expect(control.write("fifty")).toBeUndefined();
  });

  it("writes a 64-bit integer as the string it is sent as", () => {
    const control = controlFor(value("cursor"), script);
    if (control?.kind !== "number") throw new Error("expected a number");
    expect(control.write("12")).toBe('"12"');
    expect(control.write("1.5")).toBeUndefined();
  });

  it("suggests what earlier calls sent, but not what is already written", () => {
    rememberValues("issues.v1.Filter", { milestone: "v2.3" }, filter, { method: "Issues.List", origin: "request" });
    rememberValues("issues.v1.Filter", { milestone: "v2.4" }, filter, { method: "Issues.List", origin: "request" });
    const control = controlFor(value("milestone"), script);
    if (control?.kind !== "text") throw new Error("expected text");
    expect(control.suggestions).toEqual(["v2.3"]);
  });
});

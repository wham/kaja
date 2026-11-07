import { beforeEach, describe, expect, it } from "bun:test";
import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import { App } from "./apps";
import { addField, controlFor, editableRows, readRequestCalls, readRequestLevel, removeField, replaceValue, rowAt } from "./requestEdits";
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

describe("readRequestCalls", () => {
  it("finds every call to an app, literal or not", () => {
    const calls = readRequestCalls(script, apps);
    expect(calls.map((call) => [call.label, call.line, call.object !== undefined])).toEqual([
      ["Issues.List", 3, true],
      ["Issues.List", 14, false],
    ]);
    expect(script.slice(calls[1].argument!.start, calls[1].argument!.end)).toBe("request");
  });
});

describe("readRequestLevel", () => {
  it("reads the written properties in source order and the fields left unset", () => {
    const level = readRequestLevel(script, apps, 0, [])!;
    expect(level.rows.map((row) => [row.key, row.value.kind])).toEqual([
      ["owner", "expression"],
      ["repo", "string"],
      ["state", "enum"],
      ["sort", "string"],
      ["perPage", "number"],
      ["since", "string"],
      ["cursor", "string"],
      ["filter", "object"],
    ]);
    expect(level.unset).toEqual([]);
  });

  it("walks into a nested message", () => {
    const level = readRequestLevel(script, apps, 0, ["filter"])!;
    expect(level.rows.map((row) => row.key)).toEqual(["milestone"]);
    expect(level.unset.map((field) => field.localName)).toEqual(["draft"]);
  });

  it("lets go of a path that no longer leads to a literal", () => {
    expect(readRequestLevel(script, apps, 0, ["repo"])).toBeUndefined();
    expect(readRequestLevel(script, apps, 1, [])).toBeUndefined();
  });
});

describe("controlFor", () => {
  const row = (key: string, path: string[] = []) => readRequestLevel(script, apps, 0, path)!.rows.find((candidate) => candidate.key === key)!;

  it("offers an enum's members, written through the name it was imported under", () => {
    const control = controlFor(row("state"), script);
    expect(control?.kind).toBe("choice");
    if (control?.kind !== "choice") return;
    expect(control.choices.map((choice) => [choice.label, choice.text, choice.selected])).toEqual([
      ["UNSPECIFIED", "State.UNSPECIFIED", false],
      ["OPEN", "State.OPEN", true],
      ["CLOSED", "State.CLOSED", false],
    ]);
  });

  it("offers the values an API declared, and a field for anything else", () => {
    const control = controlFor(row("sort"), script);
    if (control?.kind !== "choice") throw new Error("expected a choice");
    expect(control.choices.map((choice) => [choice.text, choice.selected])).toEqual([
      ['"created"', false],
      ['"updated"', true],
    ]);
    expect(control.other?.write("pushed")).toBe('"pushed"');
  });

  it("keeps the quote a string was written in", () => {
    const control = controlFor(row("repo"), script);
    if (control?.kind !== "text") throw new Error("expected text");
    expect(control.write("it's")).toBe("'it\\'s'");
  });

  it("refuses a number that isn't one", () => {
    const control = controlFor(row("perPage"), script);
    if (control?.kind !== "number") throw new Error("expected a number");
    expect(control.write("50")).toBe("50");
    expect(control.write("fifty")).toBeUndefined();
  });

  it("writes a 64-bit integer as the string it is sent as", () => {
    const control = controlFor(row("cursor"), script);
    if (control?.kind !== "number") throw new Error("expected a number");
    expect(control.write("12")).toBe('"12"');
    expect(control.write("1.5")).toBeUndefined();
  });

  it("reads an instant as one, and writes it back in the shape it was", () => {
    const control = controlFor(row("since"), script);
    if (control?.kind !== "instant") throw new Error("expected an instant");
    expect(control.write(new Date("2026-11-07T10:00:00Z"))).toBe('"2026-11-07T10:00:00Z"');
  });

  it("suggests what earlier calls sent, but not what is already written", () => {
    rememberValues("issues.v1.Filter", { milestone: "v2.3" }, filter, { method: "Issues.List", origin: "request" });
    rememberValues("issues.v1.Filter", { milestone: "v2.4" }, filter, { method: "Issues.List", origin: "request" });
    const control = controlFor(row("milestone", ["filter"]), script);
    if (control?.kind !== "text") throw new Error("expected text");
    expect(control.suggestions).toEqual(["v2.3"]);
  });
});

describe("editableRows", () => {
  it("lists every literal a picker can change, at any depth", () => {
    expect(editableRows(script, apps).map((row) => row.key)).toEqual(["repo", "state", "sort", "perPage", "since", "cursor", "milestone"]);
  });

  it("finds the row under an offset", () => {
    expect(rowAt(script, apps, script.indexOf("v2.4"))?.key).toBe("milestone");
    expect(rowAt(script, apps, script.indexOf("kaja.input"))).toBeUndefined();
  });
});

describe("edits", () => {
  it("splices one value and nothing else", () => {
    const row = rowAt(script, apps, script.indexOf("30"))!;
    expect(replaceValue(script, row.value, "50")).toBe(script.replace("perPage: 30", "perPage: 50"));
  });

  it("adds a field to a multiline literal on a line of its own", () => {
    const code = `import { Issues } from "issues";\n\nIssues.List({\n  owner: "a",\n  repo: "b",\n});\n`;
    const level = readRequestLevel(code, apps, 0, [])!;
    const { code: added, offset } = addField(
      code,
      level,
      level.unset.find((field) => field.localName === "perPage")!,
    );
    expect(added).toBe(`import { Issues } from "issues";\n\nIssues.List({\n  owner: "a",\n  repo: "b",\n  perPage: 0,\n});\n`);
    expect(added.slice(offset, offset + 1)).toBe("0");
  });

  it("adds a field to a one-line literal, importing what its value needs", () => {
    const code = `import { Issues } from "issues";\n\nIssues.List({ owner: "a" });\n`;
    const level = readRequestLevel(code, apps, 0, [])!;
    const { code: added, offset } = addField(
      code,
      level,
      level.unset.find((field) => field.localName === "state")!,
    );
    expect(added).toBe(`import { Issues, State } from "issues";\n\nIssues.List({ owner: "a", state: State.OPEN });\n`);
    expect(added.slice(offset, offset + "State.OPEN".length)).toBe("State.OPEN");
  });

  it("starts a field the API declares values for at the first of them", () => {
    const code = `import { Issues } from "issues";\n\nIssues.List({ owner: "a" });\n`;
    const level = readRequestLevel(code, apps, 0, [])!;
    const { code: added } = addField(
      code,
      level,
      level.unset.find((field) => field.localName === "sort")!,
    );
    expect(added).toContain(`{ owner: "a", sort: "created" }`);
  });

  it("adds a field to an empty literal", () => {
    const code = `import { Issues } from "issues";\n\nIssues.List({});\n`;
    const level = readRequestLevel(code, apps, 0, [])!;
    const { code: added } = addField(code, level, level.unset[0]);
    expect(added).toBe(`import { Issues } from "issues";\n\nIssues.List({ owner: "" });\n`);
  });

  it("removes a field with the line it was on", () => {
    const row = rowAt(script, apps, script.indexOf("30"))!;
    expect(removeField(script, row)).toBe(script.replace("  perPage: 30,\n", ""));
  });

  it("removes a field from a one-line literal with its separator", () => {
    const code = `import { Issues } from "issues";\n\nIssues.List({ owner: "a", repo: "b" });\n`;
    const level = readRequestLevel(code, apps, 0, [])!;
    expect(removeField(code, level.rows[0])).toBe(code.replace(`owner: "a", `, ""));
    expect(removeField(code, level.rows[1])).toBe(code.replace(`, repo: "b"`, ""));
  });

  it("leaves an empty literal tidy", () => {
    const code = `import { Issues } from "issues";\n\nIssues.List({ owner: "a" });\n`;
    const level = readRequestLevel(code, apps, 0, [])!;
    expect(removeField(code, level.rows[0])).toBe(code.replace(`{ owner: "a" }`, "{}"));
  });
});

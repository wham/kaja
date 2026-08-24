import { describe, it, expect } from "bun:test";
import { AskBlock } from "./blocks";
import { Kaja } from "./kaja";
import { App, createPendingApp } from "./apps";
import { Source } from "./sources";
import { runScriptCaptured } from "./scriptRunner";
import { LogLevel } from "./server/api";

function makeKaja(answer: (question: AskBlock) => string = () => ""): Kaja {
  return new Kaja({
    onMethodCallUpdate: () => {},
    onAsk: async (question) => answer(question),
    onApprove: async () => "approved" as const,
    onBlockUpdate: () => {},
    onLog: () => {},
  });
}

// An app with one source and one service, which is all the import resolution reads.
function teamsApp(): App {
  const app = createPendingApp({ name: "teams", app: { oneofKind: undefined } });
  app.services = [{ name: "Teams", packageName: "teams", sourcePath: "teams/teams", clientStubModuleId: "", methods: [] }];
  app.sources = [{ importPath: "teams/teams", serviceNames: ["Teams"], enums: {} } as unknown as Source];
  app.clients["teams.Teams"] = { methodsFor: () => ({ GetAllTeams: () => undefined }) } as any;
  return app;
}

describe("kaja.variables injection", () => {
  it("exposes configured variables to scripts", async () => {
    const kaja = makeKaja();
    kaja.variables = { API_BASE_URL: "https://api.example.com", TEAM_ID: "42" };

    const run = await runScriptCaptured(`import { kaja } from "kaja";\nreturn kaja.variables.API_BASE_URL + " / " + kaja.variables.TEAM_ID;`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("https://api.example.com / 42");
  });

  it("resolves the kaja import from the relative ./kaja path", async () => {
    const kaja = makeKaja();
    kaja.variables = { HELLO: "world" };

    const run = await runScriptCaptured(`import { kaja } from "./kaja";\nreturn kaja.variables.HELLO;`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("world");
  });

  it("reflects updates to variables on the shared kaja object", async () => {
    const kaja = makeKaja();
    kaja.variables = { TOKEN: "old" };
    let run = await runScriptCaptured(`import { kaja } from "kaja";\nreturn kaja.variables.TOKEN;`, kaja, []);
    expect(run.result).toBe("old");

    // Updating the same instance (as applyConfiguration does) is visible to the next run.
    kaja.variables = { TOKEN: "new" };
    run = await runScriptCaptured(`import { kaja } from "kaja";\nreturn kaja.variables.TOKEN;`, kaja, []);
    expect(run.result).toBe("new");
  });
});

describe("TypeScript execution", () => {
  it("runs scripts with type annotations and generics", async () => {
    const kaja = makeKaja();

    const run = await runScriptCaptured(
      `import { kaja } from "kaja";
function pick<T>(items: T[]): T {
  return items[0];
}
const base: number = 41;
return pick<number>([base]) + 1;`,
      kaja,
      [],
    );

    expect(run.error).toBeUndefined();
    expect(run.result).toBe(42);
  });

  it("supports top-level await in scripts without imports", async () => {
    const run = await runScriptCaptured(`const value: string = await Promise.resolve("ok");\nreturn value;`, makeKaja(), []);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("ok");
  });

  it("reports syntax errors with the line in the script", async () => {
    const run = await runScriptCaptured(`const a = 1;\nconst b = ;`, makeKaja(), []);

    expect(run.result).toBeUndefined();
    expect(run.error).toContain("Line 2");
  });

  it("captures runtime errors", async () => {
    const run = await runScriptCaptured(`const items: string[] = [];\nreturn items[0].length;`, makeKaja(), []);

    expect(run.error).toBeDefined();
  });
});

describe("orphaned imports", () => {
  it("reports a clear error when the imported app no longer exists", async () => {
    const run = await runScriptCaptured(`import { Teams } from "teams/teams";\nTeams.GetAllTeams({});`, makeKaja(), []);

    expect(run.result).toBeUndefined();
    expect(run.error).toContain(`app "teams" was not found`);
  });
});

describe("import forms that bind nothing", () => {
  it("names the kaja import a default clause never made", async () => {
    const run = await runScriptCaptured(`import kaja from "kaja";\nreturn kaja.uuidV4();`, makeKaja(), []);

    expect(run.result).toBeUndefined();
    expect(run.error).toBe(`Cannot resolve import "kaja": a default import does not resolve. Use a named import: import { kaja } from "kaja".`);
  });

  it("names the kaja import a namespace clause never made", async () => {
    const run = await runScriptCaptured(`import * as kaja from "./kaja";\nreturn kaja.uuidV4();`, makeKaja(), []);

    expect(run.error).toBe(`Cannot resolve import "./kaja": a namespace import does not resolve. Use a named import: import { kaja } from "./kaja".`);
  });

  it("suggests a service the source declares when an app is imported as a namespace", async () => {
    const run = await runScriptCaptured(`import * as teams from "teams/teams";\nteams.Teams.GetAllTeams({});`, makeKaja(), [teamsApp()]);

    expect(run.error).toBe(
      `Cannot resolve import "teams/teams": a namespace import does not resolve. Use a named import: import { Teams } from "teams/teams".`,
    );
  });

  it("resolves a service under the app's own name", async () => {
    const run = await runScriptCaptured(`import { Teams } from "teams";\nreturn typeof Teams;`, makeKaja(), [teamsApp()]);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("object");
  });

  it("names the modules to choose between when the app declares the name twice", async () => {
    const app = teamsApp();
    app.services.push({ name: "Teams", packageName: "teams.v2", sourcePath: "teams/v2", clientStubModuleId: "", methods: [] });
    app.sources.push({ importPath: "teams/v2", serviceNames: ["Teams"], enums: {} } as unknown as Source);

    const run = await runScriptCaptured(`import { Teams } from "teams";\nTeams.GetAllTeams({});`, makeKaja(), [app]);

    expect(run.error).toBe(`Cannot resolve "Teams" from "teams": app "teams" declares it in "teams/teams" and "teams/v2". Import it from one of those.`);
  });

  it("binds nothing for a type imported alongside a service", async () => {
    const run = await runScriptCaptured(`import { Teams, GetAllTeamsRequest } from "teams";\nreturn typeof Teams;`, makeKaja(), [teamsApp()]);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("object");
  });

  it("leaves a named import alone", async () => {
    const kaja = makeKaja();
    kaja.variables = { HELLO: "world" };

    const run = await runScriptCaptured(`import { kaja as runtime } from "kaja";\nreturn runtime.variables.HELLO;`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("world");
  });
});

describe("the ask verbs", () => {
  it("hands back the kind of thing it asked for", async () => {
    const asked: AskBlock[] = [];
    const kaja = makeKaja((question) => {
      asked.push(question);
      return question.answerType === "int" ? "42" : "june";
    });

    const run = await runScriptCaptured(
      `import { kaja } from "kaja";\nconst name = await kaja.askStr("Which ledger?");\nconst count = await kaja.askInt("How many?");\nreturn [name, count, typeof count].join(" ");`,
      kaja,
      [],
    );

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("june 42 number");
    expect(asked.map((question) => question.answerType)).toEqual(["str", "int"]);
  });

  it("offers a select's labels and resolves to the value beside the one picked", async () => {
    const asked: AskBlock[] = [];
    const kaja = makeKaja((question) => {
      asked.push(question);
      return "Europe";
    });

    const run = await runScriptCaptured(
      `import { kaja } from "kaja";\nconst region = await kaja.askSelect("Where?", [{ label: "US", value: "us" }, { label: "Europe", value: "eu" }]);\nreturn region;`,
      kaja,
      [],
    );

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("eu");
    expect(asked[0].choices).toEqual(["US", "Europe"]);
  });

  it("refuses a select with nothing to pick", async () => {
    const kaja = makeKaja();

    const run = await runScriptCaptured(`import { kaja } from "kaja";\nreturn await kaja.askSelect("Where?", []);`, kaja, []);

    expect(run.error).toContain("options must not be empty");
  });
});

describe("kaja.uuidV4", () => {
  it("generates a version 4 UUID from scripts", async () => {
    const kaja = makeKaja();

    const run = await runScriptCaptured(`import { kaja } from "kaja";\nreturn kaja.uuidV4();`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(run.result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique values", () => {
    const kaja = makeKaja();
    expect(kaja.uuidV4()).not.toBe(kaja.uuidV4());
  });
});

// The shape protoc-gen-kaja generates for google/protobuf/struct.proto. The
// builders are only useful if what they return drops into a generated request,
// so the assignments below are the test - tsc fails if they drift apart.
enum GeneratedNullValue {
  NULL_VALUE = 0,
}
interface GeneratedValue {
  kind:
    | { oneofKind: "nullValue"; nullValue: GeneratedNullValue }
    | { oneofKind: "numberValue"; numberValue: number }
    | { oneofKind: "stringValue"; stringValue: string }
    | { oneofKind: "boolValue"; boolValue: boolean }
    | { oneofKind: "structValue"; structValue: GeneratedStruct }
    | { oneofKind: "listValue"; listValue: GeneratedListValue }
    | { oneofKind: undefined };
}
interface GeneratedStruct {
  fields: { [key: string]: GeneratedValue };
}
interface GeneratedListValue {
  values: GeneratedValue[];
}

describe("kaja.value", () => {
  it("builds a Value from each JSON type", () => {
    const kaja = makeKaja();

    expect(kaja.value("held")).toEqual({ kind: { oneofKind: "stringValue", stringValue: "held" } });
    expect(kaja.value(3)).toEqual({ kind: { oneofKind: "numberValue", numberValue: 3 } });
    expect(kaja.value(true)).toEqual({ kind: { oneofKind: "boolValue", boolValue: true } });
    expect(kaja.value(null)).toEqual({ kind: { oneofKind: "nullValue", nullValue: 0 } });
  });

  it("converts objects and arrays all the way down", () => {
    const kaja = makeKaja();

    expect(kaja.value({ tags: ["a"], nested: { n: 1 } })).toEqual({
      kind: {
        oneofKind: "structValue",
        structValue: {
          fields: {
            tags: { kind: { oneofKind: "listValue", listValue: { values: [{ kind: { oneofKind: "stringValue", stringValue: "a" } }] } } },
            nested: { kind: { oneofKind: "structValue", structValue: { fields: { n: { kind: { oneofKind: "numberValue", numberValue: 1 } } } } } },
          },
        },
      },
    });
  });

  it("builds a Struct and a ListValue", () => {
    const kaja = makeKaja();

    expect(kaja.struct({ region: "eu" })).toEqual({ fields: { region: { kind: { oneofKind: "stringValue", stringValue: "eu" } } } });
    expect(kaja.listValue([1])).toEqual({ values: [{ kind: { oneofKind: "numberValue", numberValue: 1 } }] });
    expect(kaja.struct({})).toEqual({ fields: {} });
    expect(kaja.listValue([])).toEqual({ values: [] });
  });

  it("returns values a generated request field accepts", () => {
    const kaja = makeKaja();

    const value: GeneratedValue = kaja.value({ rows: ["F", "G"], accessible: true, holds: null });
    const struct: GeneratedStruct = kaja.struct({ region: "eu" });
    const list: GeneratedListValue = kaja.listValue(["a", 1, true]);

    expect([value, struct, list]).toHaveLength(3);
  });

  it("builds values from scripts", async () => {
    const kaja = makeKaja();

    const run = await runScriptCaptured(`import { kaja } from "kaja";\nreturn kaja.value(["a", 1]);`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(run.result).toEqual({
      kind: {
        oneofKind: "listValue",
        listValue: {
          values: [{ kind: { oneofKind: "stringValue", stringValue: "a" } }, { kind: { oneofKind: "numberValue", numberValue: 1 } }],
        },
      },
    });
  });
});

describe("the console a script sees", () => {
  function withSink(): { kaja: Kaja; lines: { level: LogLevel; message: string }[] } {
    const lines: { level: LogLevel; message: string }[] = [];
    const kaja = new Kaja({
      onMethodCallUpdate: () => {},
      onAsk: async () => "",
      onApprove: async () => "approved" as const,
      onBlockUpdate: () => {},
      onLog: (level, message) => void lines.push({ level, message }),
    });
    return { kaja, lines };
  }

  it("reports what the script printed, at the level it printed it", async () => {
    const { kaja, lines } = withSink();

    const run = await runScriptCaptured(`console.log("42 shows");\nconsole.error("gave up");`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(lines).toEqual([
      { level: LogLevel.LEVEL_INFO, message: "42 shows" },
      { level: LogLevel.LEVEL_ERROR, message: "gave up" },
    ]);
    // The agent's report gets the same lines, since a snippet is answered as well
    // as recorded.
    expect(run.console).toEqual(["42 shows", "gave up"]);
  });

  it("hands the script every console method, not only the five levels", async () => {
    const { kaja } = withSink();

    const run = await runScriptCaptured(`console.table([{ id: 1 }]);\nreturn typeof console.table;`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("function");
  });

  /**
   * The shadow is lexical, so a closure the script defines keeps it however late
   * it fires — which is what makes a line printed from a callback land in the run
   * that started it.
   */
  it("is kept by callbacks the script defines", async () => {
    const { kaja, lines } = withSink();

    const run = await runScriptCaptured(`await new Promise((done) => setTimeout(() => { console.log("later"); done(undefined); }, 0));`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(lines).toEqual([{ level: LogLevel.LEVEL_INFO, message: "later" }]);
  });

  it("does not capture logging from outside the script", async () => {
    const { kaja, lines } = withSink();

    console.log("this is Kaja debugging itself");
    await runScriptCaptured(`console.log("this is the script");`, kaja, []);

    expect(lines).toEqual([{ level: LogLevel.LEVEL_INFO, message: "this is the script" }]);
  });
});

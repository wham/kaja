import { describe, it, expect } from "bun:test";
import { AskBlock } from "./blocks";
import { Kaja } from "./kaja";
import { runTaskCaptured } from "./taskRunner";

function makeKaja(answer: (question: AskBlock) => string = () => ""): Kaja {
  return new Kaja(
    () => {},
    async (question) => answer(question),
    async () => "approved" as const,
    () => {},
  );
}

describe("kaja.variables injection", () => {
  it("exposes configured variables to scripts", async () => {
    const kaja = makeKaja();
    kaja.variables = { API_BASE_URL: "https://api.example.com", TEAM_ID: "42" };

    const run = await runTaskCaptured(`import { kaja } from "kaja";\nreturn kaja.variables.API_BASE_URL + " / " + kaja.variables.TEAM_ID;`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("https://api.example.com / 42");
  });

  it("resolves the kaja import from the relative ./kaja path", async () => {
    const kaja = makeKaja();
    kaja.variables = { HELLO: "world" };

    const run = await runTaskCaptured(`import { kaja } from "./kaja";\nreturn kaja.variables.HELLO;`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("world");
  });

  it("reflects updates to variables on the shared kaja object", async () => {
    const kaja = makeKaja();
    kaja.variables = { TOKEN: "old" };
    let run = await runTaskCaptured(`import { kaja } from "kaja";\nreturn kaja.variables.TOKEN;`, kaja, []);
    expect(run.result).toBe("old");

    // Updating the same instance (as applyConfiguration does) is visible to the next run.
    kaja.variables = { TOKEN: "new" };
    run = await runTaskCaptured(`import { kaja } from "kaja";\nreturn kaja.variables.TOKEN;`, kaja, []);
    expect(run.result).toBe("new");
  });
});

describe("TypeScript execution", () => {
  it("runs scripts with type annotations and generics", async () => {
    const kaja = makeKaja();

    const run = await runTaskCaptured(
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
    const run = await runTaskCaptured(`const value: string = await Promise.resolve("ok");\nreturn value;`, makeKaja(), []);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("ok");
  });

  it("reports syntax errors with the line in the script", async () => {
    const run = await runTaskCaptured(`const a = 1;\nconst b = ;`, makeKaja(), []);

    expect(run.result).toBeUndefined();
    expect(run.error).toContain("Line 2");
  });

  it("captures runtime errors", async () => {
    const run = await runTaskCaptured(`const items: string[] = [];\nreturn items[0].length;`, makeKaja(), []);

    expect(run.error).toBeDefined();
  });
});

describe("orphaned imports", () => {
  it("reports a clear error when the imported app no longer exists", async () => {
    const run = await runTaskCaptured(`import { Teams } from "teams/teams";\nTeams.GetAllTeams({});`, makeKaja(), []);

    expect(run.result).toBeUndefined();
    expect(run.error).toContain(`app "teams" was not found`);
  });
});

describe("the ask verbs", () => {
  it("hands back the kind of thing it asked for", async () => {
    const asked: AskBlock[] = [];
    const kaja = makeKaja((question) => {
      asked.push(question);
      return question.answerType === "int" ? "42" : "june";
    });

    const run = await runTaskCaptured(
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

    const run = await runTaskCaptured(
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

    const run = await runTaskCaptured(`import { kaja } from "kaja";\nreturn await kaja.askSelect("Where?", []);`, kaja, []);

    expect(run.error).toContain("options must not be empty");
  });
});

describe("kaja.uuidV4", () => {
  it("generates a version 4 UUID from scripts", async () => {
    const kaja = makeKaja();

    const run = await runTaskCaptured(`import { kaja } from "kaja";\nreturn kaja.uuidV4();`, kaja, []);

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

    const run = await runTaskCaptured(`import { kaja } from "kaja";\nreturn kaja.value(["a", 1]);`, kaja, []);

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

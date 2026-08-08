import { describe, expect, it } from "bun:test";
import { CanvasEntry, foldCalls, groupDuration, groupFailures, groupKeyLabel } from "./callGroups";
import { MethodCall } from "./kaja";
import { ConsoleItem } from "./runs";
import { LogLevel } from "./server/api";

const NOW = 1_700_000_000_000;

function call(id: string, method: string, changes: Partial<MethodCall> = {}): ConsoleItem {
  const methodCall = {
    id,
    appName: "app",
    service: { name: "Shows" },
    method: { name: method },
    input: {},
    output: {},
    timestamp: NOW,
    durationMs: 100,
    ...changes,
  } as MethodCall;
  return { id, runId: "r", timestamp: methodCall.timestamp, call: methodCall };
}

function text(id: string): ConsoleItem {
  return { id, runId: "r", timestamp: NOW, block: { kind: "text", text: "hello" } };
}

function logs(id: string): ConsoleItem {
  return { id, runId: "r", timestamp: NOW, logs: [{ level: LogLevel.LEVEL_INFO, message: "hello" }] };
}

function shape(entries: CanvasEntry[]): string[] {
  return entries.map((entry) => (entry.kind === "calls" ? `${entry.name}×${entry.items.length}` : entry.item.id));
}

describe("foldCalls", () => {
  it("leaves a run shorter than the minimum as its own cards", () => {
    expect(shape(foldCalls([call("a", "ListShows"), call("b", "ListShows")]))).toEqual(["a", "b"]);
  });

  it("folds consecutive calls to one method into a single entry", () => {
    const entries = foldCalls([call("a", "ListShows"), call("b", "ListShows"), call("c", "ListShows")]);

    expect(shape(entries)).toEqual(["Shows.ListShows×3"]);
    expect(entries[0].id).toBe("a");
  });

  it("does not fold across a different method", () => {
    const items = [call("a", "ListShows"), call("b", "ListShows"), call("c", "ListShows"), call("d", "GetShow"), call("e", "ListShows")];

    expect(shape(foldCalls(items))).toEqual(["Shows.ListShows×3", "d", "e"]);
  });

  it("breaks a group on anything the script drew between the calls", () => {
    const items = [call("a", "ListShows"), call("b", "ListShows"), text("t"), call("c", "ListShows"), call("d", "ListShows"), call("e", "ListShows")];

    expect(shape(foldCalls(items))).toEqual(["a", "b", "t", "Shows.ListShows×3"]);
  });

  it("breaks a group on the log too, so the story keeps its order", () => {
    const items = [call("a", "ListShows"), call("b", "ListShows"), call("c", "ListShows"), logs("l"), call("d", "ListShows")];

    expect(shape(foldCalls(items))).toEqual(["Shows.ListShows×3", "l", "d"]);
  });

  it("keeps blocks and calls in emission order", () => {
    expect(shape(foldCalls([text("t1"), call("a", "GetShow"), text("t2")]))).toEqual(["t1", "a", "t2"]);
  });

  it("folds nothing when there is nothing", () => {
    expect(foldCalls([])).toEqual([]);
  });
});

describe("groupDuration", () => {
  it("is the wall time of the group, not the sum of its calls", () => {
    const concurrent = [
      call("a", "GetShow", { timestamp: NOW, durationMs: 300 }),
      call("b", "GetShow", { timestamp: NOW + 10, durationMs: 300 }),
      call("c", "GetShow", { timestamp: NOW + 20, durationMs: 300 }),
    ];

    expect(groupDuration(concurrent)).toBe(320);
  });

  it("adds up when the calls ran one after another", () => {
    const sequential = [
      call("a", "GetShow", { timestamp: NOW, durationMs: 100 }),
      call("b", "GetShow", { timestamp: NOW + 100, durationMs: 100 }),
      call("c", "GetShow", { timestamp: NOW + 200, durationMs: 100 }),
    ];

    expect(groupDuration(sequential)).toBe(300);
  });

  it("has no answer while a call is still in flight", () => {
    expect(groupDuration([call("a", "GetShow"), call("b", "GetShow", { durationMs: undefined })])).toBeUndefined();
  });
});

describe("groupFailures", () => {
  it("counts the calls that failed, so a fold never hides one", () => {
    const items = [call("a", "GetShow"), call("b", "GetShow", { error: { code: "NOT_FOUND" } }), call("c", "GetShow")];

    expect(groupFailures(items)).toBe(1);
  });
});

describe("groupKeyLabel", () => {
  it("says nothing when nothing in the requests identifies anything", () => {
    expect(groupKeyLabel([call("a", "ListShows"), call("b", "ListShows")])).toBeUndefined();
  });

  it("states a key the whole group shares once", () => {
    const items = [call("a", "GetShow", { input: { id: "vera-lune" } }), call("b", "GetShow", { input: { id: "vera-lune" } })];

    expect(groupKeyLabel(items)).toBe("vera-lune");
  });

  it("names the keys until they stop fitting", () => {
    const items = [
      call("a", "GetShow", { input: { id: "vera-lune" } }),
      call("b", "GetShow", { input: { id: "moth-lantern" } }),
      call("c", "GetShow", { input: { id: "salt-choir" } }),
      call("d", "GetShow", { input: { id: "amber-hour" } }),
    ];

    expect(groupKeyLabel(items)).toBe("vera-lune, moth-lantern +2");
  });
});

import { describe, expect, it } from "bun:test";
import { MethodCall } from "./kaja";
import { Block } from "./blocks";
import { awaitingItem, callCount, callItems, ConsoleItem, defaultView, followSelection, groupRuns, hasDrawing, Run, slowestCall, worstStatus } from "./runs";
import { LogLevel } from "./server/api";

const NOW = 1_700_000_000_000;

function run(id: string, changes: Partial<Run> = {}): Run {
  return { id, title: id, startedAt: NOW, ...changes };
}

function call(id: string, runId: string, changes: Partial<MethodCall> = {}): ConsoleItem {
  const methodCall = {
    id,
    appName: "app",
    service: { name: "Shows" },
    method: { name: "ListShows" },
    input: {},
    output: {},
    timestamp: NOW,
    ...changes,
  } as MethodCall;
  return { id, runId, timestamp: methodCall.timestamp, call: methodCall };
}

function logs(id: string, runId: string, level: LogLevel): ConsoleItem {
  return { id, runId, timestamp: NOW, logs: [{ level, message: "hello" }] };
}

function block(id: string, runId: string, block: Block): ConsoleItem {
  return { id, runId, timestamp: NOW, block };
}

describe("worstStatus", () => {
  it("is pending when the run has produced nothing yet", () => {
    expect(worstStatus([])).toBe("pending");
  });

  it("is success only when everything in it passed", () => {
    expect(worstStatus([call("a", "r"), call("b", "r")])).toBe("success");
  });

  it("takes the worst status it contains", () => {
    expect(worstStatus([call("a", "r"), call("b", "r", { error: { code: "UNAUTHENTICATED" } })])).toBe("error");
  });

  it("counts a script error as a failure of the run", () => {
    expect(worstStatus([call("a", "r"), logs("b", "r", LogLevel.LEVEL_ERROR)])).toBe("error");
  });

  it("is pending while a call is still in flight", () => {
    expect(worstStatus([call("a", "r"), call("b", "r", { output: undefined })])).toBe("pending");
  });
});

describe("groupRuns", () => {
  it("nests calls under the run that made them, oldest run first", () => {
    const groups = groupRuns(
      [run("r2", { startedAt: NOW + 100 }), run("r1")],
      [call("a", "r1"), call("b", "r2"), call("c", "r1", { error: { code: "NOT_FOUND" } })],
    );

    expect(groups.map((group) => group.run.id)).toEqual(["r1", "r2"]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["a", "c"]);
    expect(groups[0].status).toBe("error");
    expect(groups[0].failures).toBe(1);
    expect(groups[1].status).toBe("success");
  });

  it("keeps a run whose calls are gone, because the header is what says it happened", () => {
    const groups = groupRuns([run("r1", { stale: true, payloadsExpired: true })], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual([]);
    expect(groups[0].inFlight).toBe(false);
  });

  it("never reports a stale run as in flight", () => {
    const groups = groupRuns([run("r1", { stale: true })], [call("a", "r1", { output: undefined })]);
    expect(groups[0].inFlight).toBe(false);
  });

  it("reports a live run with a call still in flight", () => {
    const groups = groupRuns([run("r1")], [call("a", "r1", { output: undefined })]);
    expect(groups[0].inFlight).toBe(true);
  });
});

describe("callCount", () => {
  it("counts calls, not the log lines the script printed", () => {
    const [group] = groupRuns([run("r1")], [call("a", "r1"), logs("b", "r1", LogLevel.LEVEL_INFO)]);
    expect(callCount(group)).toBe(1);
  });
});

describe("followSelection", () => {
  const history = groupRuns([run("r1", { startedAt: NOW }), run("r2", { startedAt: NOW + 1 })], [call("a", "r1"), call("b", "r2"), call("c", "r2")]);

  it("opens a run that has just arrived, whichever run was being read", () => {
    expect(followSelection({ runId: "r1", itemId: "a" }, history, true)).toEqual({ runId: "r2", itemId: "c" });
  });

  it("opens the first run there is", () => {
    expect(followSelection(null, groupRuns([run("r1")], [call("a", "r1")]), true)).toEqual({ runId: "r1", itemId: "a" });
  });

  it("follows the newest call inside the run being watched, so one in flight is selected as it is issued", () => {
    expect(followSelection({ runId: "r2", itemId: "b" }, history, false)).toEqual({ runId: "r2", itemId: "c" });
  });

  it("leaves a run stepped back to alone when a call lands in a later one", () => {
    expect(followSelection({ runId: "r1", itemId: "a" }, history, false)).toEqual({ runId: "r1", itemId: "a" });
  });

  it("follows the newest run when the selected one has gone", () => {
    expect(followSelection({ runId: "gone", itemId: "x" }, history, false)).toEqual({ runId: "r2", itemId: "c" });
  });

  it("selects the header of a run that has produced nothing yet", () => {
    expect(followSelection(null, groupRuns([run("r3")], []), true)).toEqual({ runId: "r3", itemId: undefined });
  });

  it("has nothing to select once the history is cleared", () => {
    expect(followSelection({ runId: "r1", itemId: "a" }, [], true)).toBeNull();
  });
});

describe("the two views", () => {
  const table: Block = { kind: "table", columns: ["id"], rows: [["ac_1"]] };

  // A row is a call and only a call — that is what stops the log and the canvas
  // saying the same thing twice.
  it("keeps everything but calls out of the log", () => {
    const [group] = groupRuns([run("r1")], [call("a", "r1"), block("b", "r1", table), logs("c", "r1", LogLevel.LEVEL_INFO)]);
    expect(callItems(group).map((item) => item.id)).toEqual(["a"]);
    expect(callCount(group)).toBe(1);
  });

  it("opens a run that drew something on its canvas", () => {
    const [group] = groupRuns([run("r1")], [call("a", "r1"), block("b", "r1", table)]);
    expect(hasDrawing(group)).toBe(true);
    expect(defaultView(group)).toBe("canvas");
  });

  // A run that only called has a canvas of call cards, which is a true but
  // redundant view of its log — not what the console should open on.
  it("opens a run that only made calls on its log", () => {
    const [group] = groupRuns([run("r1")], [call("a", "r1"), call("b", "r1")]);
    expect(defaultView(group)).toBe("list");
  });

  it("opens on the log when there is no run at all", () => {
    expect(defaultView(undefined)).toBe("list");
  });
});

describe("a run parked on a question", () => {
  const asked: Block = { kind: "ask", question: "Which ledger?", answerType: "str" };
  const answered: Block = { kind: "ask", question: "Which ledger?", answerType: "str", answer: "june" };

  it("is still in flight, though nothing is in the air", () => {
    const [group] = groupRuns([run("r1")], [call("a", "r1"), block("b", "r1", asked)]);
    expect(group.inFlight).toBe(true);
    expect(group.status).toBe("pending");
    expect(awaitingItem(group)?.id).toBe("b");
  });

  it("is over once the question has been answered", () => {
    const [group] = groupRuns([run("r1")], [call("a", "r1"), block("b", "r1", answered)]);
    expect(group.inFlight).toBe(false);
    expect(group.status).toBe("success");
    expect(awaitingItem(group)).toBeUndefined();
  });

  // A run read back from the store happened in an earlier session: whatever it
  // was waiting for is long gone.
  it("is never live again once it has been read back from the store", () => {
    const [group] = groupRuns([run("r1", { stale: true })], [block("b", "r1", asked)]);
    expect(group.inFlight).toBe(false);
  });
});

describe("slowestCall", () => {
  it("is what every duration bar is drawn against", () => {
    const [group] = groupRuns([run("r1")], [call("a", "r1", { durationMs: 120 }), call("b", "r1", { durationMs: 690 })]);
    expect(slowestCall(group)).toBe(690);
  });

  // A bar only means something against another bar, so a run of one gets none.
  it("has nothing to compare in a run of one call", () => {
    const [group] = groupRuns([run("r1")], [call("a", "r1", { durationMs: 120 })]);
    expect(slowestCall(group)).toBeUndefined();
  });

  it("ignores a call that has not finished yet", () => {
    const [group] = groupRuns([run("r1")], [call("a", "r1", { durationMs: 120 }), call("b", "r1", { output: undefined })]);
    expect(slowestCall(group)).toBeUndefined();
  });
});

import { describe, expect, it } from "bun:test";
import { MethodCall } from "./kaja";
import { callCount, ConsoleItem, groupRuns, isSingleItemRun, Run, worstStatus } from "./runs";
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
    expect(isSingleItemRun(group)).toBe(false);
  });

  it("treats a run of one as a single row, so the common case gains no chrome", () => {
    const [group] = groupRuns([run("r1")], [call("a", "r1")]);
    expect(isSingleItemRun(group)).toBe(true);
  });
});

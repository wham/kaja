import { describe, expect, it } from "bun:test";
import { MethodCall } from "./kaja";
import { Block } from "./blocks";
import { ConsoleItem, ItemStats, itemStatus, slowestOf, worstStatus } from "./runs";
import { LogLevel } from "./server/api";

const NOW = 1_700_000_000_000;

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

describe("slowestOf", () => {
  it("is what every duration bar is drawn against", () => {
    expect(slowestOf([call("a", "r", { durationMs: 120 }), call("b", "r", { durationMs: 690 })])).toBe(690);
  });

  // A bar only means something against another bar, so a run of one gets none.
  it("has nothing to compare in a run of one call", () => {
    expect(slowestOf([call("a", "r", { durationMs: 120 })])).toBeUndefined();
  });

  it("ignores a call that has not finished yet", () => {
    expect(slowestOf([call("a", "r", { durationMs: 120 }), call("b", "r", { output: undefined })])).toBeUndefined();
  });
});

/**
 * A run counts what it holds as its items arrive rather than walking them on
 * every repaint. This is what keeps that fast path and the rule it stands for
 * from drifting apart: over the same items, counting must say what deriving
 * would have said.
 */
describe("ItemStats", () => {
  function statsOf(items: ConsoleItem[]): ItemStats {
    const stats = new ItemStats();
    for (const item of items) stats.add(item);
    return stats;
  }

  it("says what worstStatus and slowestOf would", () => {
    const runs: ConsoleItem[][] = [
      [],
      [call("a", "r"), call("b", "r")],
      [call("a", "r"), call("b", "r", { error: { code: "UNAUTHENTICATED" } })],
      [call("a", "r"), logs("b", "r", LogLevel.LEVEL_ERROR)],
      [call("a", "r"), call("b", "r", { output: undefined })],
      [call("a", "r", { durationMs: 120 }), call("b", "r", { durationMs: 690 })],
      [call("a", "r", { durationMs: 120 })],
      [call("a", "r", { durationMs: 120 }), call("b", "r", { output: undefined })],
    ];

    for (const items of runs) {
      const stats = statsOf(items);
      expect(stats.status).toBe(worstStatus(items));
      expect(stats.slowest).toBe(slowestOf(items));
    }
  });

  it("counts a call once however often it is reported", () => {
    const item = call("a", "r", { output: undefined, durationMs: undefined });
    const stats = new ItemStats();
    stats.add(item);

    expect(stats.status).toBe("pending");
    expect(stats.inFlight).toBe(true);

    item.call!.output = {};
    item.call!.durationMs = 40;
    stats.add(item);
    stats.add(item);

    expect(stats.size).toBe(1);
    expect(stats.status).toBe("success");
    expect(stats.inFlight).toBe(false);
    expect(stats.duration).toBe(40);
  });

  /**
   * A run parked on a question has nothing in the air, but it is not over
   * either — the script is stopped inside it waiting to be answered.
   */
  it("keeps a run parked on a question in flight", () => {
    const question: Block = { kind: "ask", question: "which?", answerType: "str" };
    const item = block("b1", "r", question);
    const stats = new ItemStats();
    stats.add(item);

    expect(stats.inFlight).toBe(true);
    expect(itemStatus(item)).toBe("pending");

    item.block = { ...question, answer: "this one" };
    stats.add(item);

    expect(stats.inFlight).toBe(false);
  });

  it("reports wall time, not the sum of its calls", () => {
    const concurrent = [
      call("a", "r", { timestamp: NOW, durationMs: 300 }),
      { ...call("b", "r", { timestamp: NOW + 10, durationMs: 300 }), timestamp: NOW + 10 },
      { ...call("c", "r", { timestamp: NOW + 20, durationMs: 300 }), timestamp: NOW + 20 },
    ];

    expect(statsOf(concurrent).duration).toBe(320);
  });
});

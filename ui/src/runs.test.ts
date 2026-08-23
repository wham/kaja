import { describe, expect, it } from "bun:test";
import { MethodCall } from "./kaja";
import { Block } from "./blocks";
import { callRows, callStatus, ConsoleItem, ItemStats, itemStatus, presentRun, printedCounts, printedLevel, RunGroup, slowestOf, worstStatus } from "./runs";
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

  // The bars compare what the rows show: the upstream exchange once Kaja measured
  // it, not the round trip that carried it here.
  it("compares upstream durations where Kaja measured them", () => {
    expect(slowestOf([call("a", "r", { durationMs: 900, upstreamDurationMs: 120 }), call("b", "r", { durationMs: 700, upstreamDurationMs: 650 })])).toBe(650);
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
      [call("a", "r", { durationMs: 900, upstreamDurationMs: 120 }), call("b", "r", { durationMs: 700, upstreamDurationMs: 650 })],
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

describe("callStatus", () => {
  function methodCall(changes: Partial<MethodCall>): MethodCall {
    return { id: "c", appName: "app", service: { name: "S" }, method: { name: "M" }, input: {}, timestamp: NOW, ...changes } as MethodCall;
  }

  it("reads a response that arrived as success", () => {
    expect(callStatus(methodCall({ output: { id: 1 } }))).toBe("success");
  });

  it("has not answered until an output is set", () => {
    expect(callStatus(methodCall({}))).toBe("pending");
  });

  // A REST operation can answer with a bare scalar — the HTTP envelope exists
  // for exactly that — so a falsy payload is a response, not a missing one.
  // Testing presence rather than truthiness is what tells the two apart.
  it.each([[null], [0], [""], [false]])("treats the falsy response %p as a response", (output) => {
    expect(callStatus(methodCall({ output }))).toBe("success");
  });

  it("reports an error over anything else", () => {
    expect(callStatus(methodCall({ output: { id: 1 }, error: { message: "nope" } }))).toBe("error");
  });

  it("is streaming until the stream completes", () => {
    expect(callStatus(methodCall({ streamOutputs: [] }))).toBe("streaming");
    expect(callStatus(methodCall({ streamOutputs: [], streamComplete: true, output: {} }))).toBe("success");
  });
});

function printed(id: string, at: number, level: LogLevel, message = "hello"): ConsoleItem {
  return { id, runId: "run-1", timestamp: at, logs: [{ level, message }], printed: true };
}

// `callRows` reads the run's emission order off `items`, so a fixture states that
// order and the two sub-lists are derived from it — the same way the store builds
// them.
function group(...items: ConsoleItem[]): RunGroup {
  return { items, calls: items.filter((item) => item.call), printed: items.filter((item) => item.printed) } as RunGroup;
}

describe("printed items", () => {
  /**
   * A script that prints `console.error("retry 2")` in a loop and finishes is not
   * a failed run. Only a verdict Kaja wrote about the run colours its dot.
   */
  it("never colour the run's status, at any level", () => {
    expect(itemStatus(printed("p1", NOW, LogLevel.LEVEL_ERROR))).toBe("success");
    expect(worstStatus([call("c1", "run-1"), printed("p1", NOW, LogLevel.LEVEL_ERROR)])).toBe("success");
  });

  // A script error is a verdict and goes on saying so.
  it("leave a script error's verdict alone", () => {
    expect(itemStatus(logs("l1", "run-1", LogLevel.LEVEL_ERROR))).toBe("error");
  });

  it("report the worst level they hold", () => {
    expect(printedLevel(printed("p1", NOW, LogLevel.LEVEL_WARN))).toBe(LogLevel.LEVEL_WARN);
    expect(printedLevel({ id: "p2", runId: "run-1", timestamp: NOW, printed: true, logs: [] })).toBe(LogLevel.LEVEL_DEBUG);
  });
});

describe("callRows", () => {
  const run = () =>
    group(
      printed("p1", NOW + 10, LogLevel.LEVEL_INFO),
      call("c1", "run-1", { timestamp: NOW + 10 }),
      printed("p2", NOW + 20, LogLevel.LEVEL_ERROR),
      call("c2", "run-1", { timestamp: NOW + 20 }),
    );

  it("is calls and only calls with the floor off", () => {
    expect(callRows(run(), "off")).toEqual(run().calls);
  });

  /**
   * Every timestamp here is shared with the call beside it, which is what a log
   * line printed immediately before a call actually looks like. Emission order is
   * the answer; a timestamp tie-break would decide it by accident.
   */
  it("keeps the order things happened in, ties and all", () => {
    expect(callRows(run(), "all").map((item) => item.id)).toEqual(["p1", "c1", "p2", "c2"]);
  });

  it("admits a level and everything above it", () => {
    expect(callRows(run(), "error").map((item) => item.id)).toEqual(["c1", "p2", "c2"]);
    expect(callRows(run(), "warn").map((item) => item.id)).toEqual(["c1", "p2", "c2"]);
  });

  it("returns the calls themselves when nothing is admitted, so the memo holds", () => {
    const only = group(call("c1", "run-1"), printed("p1", NOW + 20, LogLevel.LEVEL_INFO));
    expect(callRows(only, "error")).toBe(only.calls);
  });

  /**
   * A line printed while a call is in flight sits after that call's row, not
   * after its response: a call's row goes in when it was issued, which is what
   * the log has always meant by order.
   */
  it("places a line printed during a call after that call", () => {
    const during = group(call("c1", "run-1", { timestamp: NOW, durationMs: 500 }), printed("p1", NOW + 100, LogLevel.LEVEL_INFO));
    expect(callRows(during, "all").map((item) => item.id)).toEqual(["c1", "p1"]);
  });

  // Blocks belong to the canvas and are never rows here.
  it("leaves out what the run drew", () => {
    const drew = group(call("c1", "run-1"), block("b1", "run-1", { kind: "text", text: "hello" }), printed("p1", NOW, LogLevel.LEVEL_INFO));
    expect(callRows(drew, "all").map((item) => item.id)).toEqual(["c1", "p1"]);
  });

  it("keeps every line when there are no calls at all", () => {
    const only = group(printed("p1", NOW, LogLevel.LEVEL_INFO), printed("p2", NOW, LogLevel.LEVEL_ERROR));
    expect(callRows(only, "all").map((item) => item.id)).toEqual(["p1", "p2"]);
  });
});

describe("printedCounts", () => {
  it("counts the lines and the errors among them", () => {
    const only = group(printed("p1", NOW, LogLevel.LEVEL_INFO), printed("p2", NOW, LogLevel.LEVEL_ERROR), printed("p3", NOW, LogLevel.LEVEL_ERROR));
    expect(printedCounts(only)).toEqual({ lines: 3, errors: 2 });
  });
});

describe("presentRun", () => {
  const running = (changes: Partial<RunGroup> = {}) => ({ drew: false, running: true, ...changes }) as RunGroup;

  // The canvas is the only thing there is to present, so a run that has drawn
  // nothing yet waits for its first block rather than opening on empty space.
  it("waits for the run to arrive, and then for it to draw", () => {
    expect(presentRun(undefined)).toBe("wait");
    expect(presentRun(running())).toBe("wait");
  });

  it("presents the run the moment it draws", () => {
    expect(presentRun(running({ drew: true }))).toBe("present");
    // Still worth presenting once it is over: the output is why it was launched.
    expect(presentRun(running({ drew: true, running: false }))).toBe("present");
  });

  // A script that only made calls reads as an ordinary run, in the console it
  // already landed in.
  it("drops a run that ended without drawing", () => {
    expect(presentRun(running({ running: false }))).toBe("drop");
  });
});

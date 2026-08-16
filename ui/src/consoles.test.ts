import { beforeEach, describe, expect, it } from "bun:test";
import { Block } from "./blocks";
import { Consoles } from "./consoles";
import { MethodCall } from "./kaja";
import { defaultView, followSelection, Run, RunSelection, slowestOf, worstStatus } from "./runs";
import { LogLevel } from "./server/api";

const NOW = 1_700_000_000_000;

let store: Consoles;
// The store notifies on the frame; tests run the queue by hand so a call and
// what it does to the console are one step.
let frames: (() => void)[];

beforeEach(() => {
  store = new Consoles();
  frames = [];
  store.schedule = (run) => frames.push(run);
});

function paint(): void {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame();
}

function run(id: string, fileId: string | undefined, changes: Partial<Run> = {}): Run {
  return { id, title: id, fileId, startedAt: NOW, ...changes };
}

let calls = 0;
function call(method: string, changes: Partial<MethodCall> = {}): MethodCall {
  calls++;
  return {
    id: `call-${calls}`,
    appName: "app",
    service: { name: "Shows" },
    method: { name: method },
    input: {},
    output: {},
    timestamp: NOW + calls,
    durationMs: 10,
    ...changes,
  } as MethodCall;
}

function start(fileId: string, id = `run-${fileId}`): Run {
  const created = run(id, fileId);
  store.startRun(created, NOW);
  return created;
}

describe("startRun", () => {
  it("lands a run in the console of the file it was pressed on", () => {
    start("a.ts");

    expect(store.file("a.ts").runs).toHaveLength(1);
  });

  it("keeps one file's runs out of another's", () => {
    start("a.ts");
    start("b.ts");

    expect(store.file("a.ts").runs).toHaveLength(1);
    expect(store.file("b.ts").runs).toHaveLength(1);
  });

  it("does not keep a run with no file of its own", () => {
    store.startRun(run("loose", undefined), NOW);

    expect(store.file(undefined).runs).toHaveLength(0);
  });

  it("drops the oldest runs of a file past the cap, and their calls with them", () => {
    for (let i = 0; i < 30; i++) {
      const created = start("a.ts", `run-${i}`);
      store.recordCall("a.ts", created.id, call("ListShows"), NOW);
    }
    paint();

    const file = store.file("a.ts");
    expect(file.runs).toHaveLength(25);
    expect(file.runs[0].id).toBe("run-5");
    expect(file.allItems()).toHaveLength(25);
  });

  it("holds fifty files and lets go of the least recently run", () => {
    for (let i = 0; i < 60; i++) start(`file-${i}.ts`, `run-${i}`);

    expect(store.file("file-0.ts").runs).toHaveLength(0);
    expect(store.file("file-59.ts").runs).toHaveLength(1);
  });
});

describe("recordCall", () => {
  it("updates a call already in the run rather than appending it again", () => {
    const created = start("a.ts");
    const issued = call("GetShow", { output: undefined, durationMs: undefined });
    store.recordCall("a.ts", created.id, issued, NOW);
    issued.output = { id: "vera-lune" };
    issued.durationMs = 42;
    store.recordCall("a.ts", created.id, issued, NOW);
    paint();

    const group = store.file("a.ts").groups[0];
    expect(group.calls).toHaveLength(1);
    expect(group.calls[0].call?.durationMs).toBe(42);
    expect(group.status).toBe("success");
  });

  it("keeps calls in the order they started", () => {
    const created = start("a.ts");
    store.recordCall("a.ts", created.id, call("First"), NOW);
    store.recordCall("a.ts", created.id, call("Second"), NOW);
    paint();

    expect(store.file("a.ts").groups[0].calls.map((item) => item.call?.method.name)).toEqual(["First", "Second"]);
  });

  it("reads what identifies the call once, when it is issued", () => {
    const created = start("a.ts");
    store.recordCall("a.ts", created.id, call("GetShow", { input: { id: "vera-lune" } }), NOW);
    paint();

    expect(store.file("a.ts").groups[0].calls[0].key).toBe("vera-lune");
  });
});

describe("a run of a thousand calls", () => {
  it("keeps every row, because the log is the audit record", () => {
    const created = start("a.ts");
    for (let i = 0; i < 1000; i++) store.recordCall("a.ts", created.id, call("GetShow", { input: { id: `show-${i}` } }), NOW);
    paint();

    const group = store.file("a.ts").groups[0];
    expect(group.calls).toHaveLength(1000);
    expect(group.dropped).toBe(0);
  });

  it("lets the oldest payloads go and says so on the row that lost one", () => {
    const created = start("a.ts");
    for (let i = 0; i < 700; i++) store.recordCall("a.ts", created.id, call("GetShow", { input: { id: `show-${i}` }, output: { seats: [1, 2, 3] } }), NOW);
    paint();

    const calls = store.file("a.ts").groups[0].calls;
    expect(calls[0].payloadsDropped).toBe(true);
    expect(calls[0].call?.output).toBeUndefined();
    // The row is still the record that the call happened, and still says which
    // pass through the loop it was.
    expect(calls[0].key).toBe("show-0");
    expect(calls[699].payloadsDropped).toBeUndefined();
    expect(calls[699].call?.output).toBeDefined();
  });

  it("repaints once a frame, not once a call", () => {
    const created = start("a.ts");
    let notified = 0;
    store.subscribeFile("a.ts", () => notified++);

    for (let i = 0; i < 500; i++) store.recordCall("a.ts", created.id, call("GetShow"), NOW);
    expect(notified).toBe(0);
    paint();

    expect(notified).toBe(1);
  });

  it("keeps calls off the canvas and states them on the strip", () => {
    const created = start("a.ts");
    for (let i = 0; i < 200; i++) store.recordCall("a.ts", created.id, call("GetShow", { input: { id: `show-${i}` } }), NOW);
    store.recordBlock("a.ts", created.id, "block-1", { kind: "text", text: "done" }, NOW);
    paint();

    const group = store.file("a.ts").groups[0];
    expect(group.drawn).toHaveLength(1);
    expect(group.strip.calls).toBe(200);
    expect(group.strip.methodLabel).toBe("Shows.GetShow ×200");
  });
});

describe("what a script printed", () => {
  // The canvas is what the run drew, and printing is not drawing.
  it("never reaches the canvas", () => {
    const created = start("a.ts");
    store.recordPrinted("a.ts", created.id, LogLevel.LEVEL_INFO, "tick", NOW);
    paint();

    const group = store.file("a.ts").groups[0];
    expect(group.drawn).toHaveLength(0);
    expect(group.drew).toBe(false);
  });

  // A loop that logs each iteration would otherwise speak for every failure it
  // logged past.
  it("does not report a failure on the script's behalf", () => {
    const created = start("a.ts");
    store.recordCall("a.ts", created.id, call("GetShow", { error: { code: "NOT_FOUND" } }), NOW);
    store.recordPrinted("a.ts", created.id, LogLevel.LEVEL_INFO, "tick", NOW);
    paint();

    expect(store.file("a.ts").groups[0].unreported).toHaveLength(1);
  });
});

describe("failures the run said nothing about", () => {
  it("names a failed call nothing was drawn after", () => {
    const created = start("a.ts");
    store.recordCall("a.ts", created.id, call("GetShow", { error: { code: "NOT_FOUND", message: "no such show" } }), NOW);
    paint();

    expect(store.file("a.ts").groups[0].unreported).toEqual([
      { itemId: expect.any(String), method: "Shows.GetShow", count: 1, code: "NOT_FOUND", message: "no such show" },
    ]);
  });

  it("stays quiet about one the script drew past", () => {
    const created = start("a.ts");
    store.recordCall("a.ts", created.id, call("GetShow", { error: { code: "NOT_FOUND" } }), NOW);
    store.recordBlock("a.ts", created.id, "block-1", { kind: "table", columns: ["id", "result"], rows: [["show-1", "404"]] }, NOW);
    paint();

    expect(store.file("a.ts").groups[0].unreported).toHaveLength(0);
  });

  it("stays quiet about one a table drew past long after it was emitted", () => {
    const created = start("a.ts");
    const table: Block = { kind: "table", columns: ["id", "result"], rows: [] };
    store.recordBlock("a.ts", created.id, "block-1", table, NOW);
    store.recordCall("a.ts", created.id, call("GetShow", { error: { code: "NOT_FOUND" } }), NOW);
    store.recordBlock("a.ts", created.id, "block-1", { ...table, rows: [["show-1", "404"]] }, NOW);
    paint();

    expect(store.file("a.ts").groups[0].unreported).toHaveLength(0);
  });

  it("says one row for a method that failed the same way ten times", () => {
    const created = start("a.ts");
    for (let i = 0; i < 10; i++) store.recordCall("a.ts", created.id, call("GetShow", { error: { code: "NOT_FOUND" } }), NOW);
    paint();

    const [notice] = store.file("a.ts").groups[0].unreported;
    expect(notice.count).toBe(10);
  });
});

describe("what a run says about itself", () => {
  it("says the same as deriving it from the items would", () => {
    const created = start("a.ts");
    store.recordCall("a.ts", created.id, call("GetShow", { durationMs: 40 }), NOW);
    store.recordCall("a.ts", created.id, call("GetShow", { durationMs: 300 }), NOW);
    store.recordCall("a.ts", created.id, call("GetShow", { durationMs: 90, error: { code: "NOT_FOUND" } }), NOW);
    paint();

    const group = store.file("a.ts").groups[0];
    expect(group.status).toBe(worstStatus(group.items));
    expect(group.stats.slowest).toBe(slowestOf(group.items));
    expect(group.failures).toBe(1);
  });

  it("is pending while a call is still in flight", () => {
    const created = start("a.ts");
    store.recordCall("a.ts", created.id, call("GetShow", { output: undefined, durationMs: undefined }), NOW);
    paint();

    const group = store.file("a.ts").groups[0];
    expect(group.status).toBe("pending");
    expect(group.inFlight).toBe(true);
  });

  it("counts a script error as a failure of the run", () => {
    const created = start("a.ts");
    store.recordLogs("a.ts", created.id, [{ level: LogLevel.LEVEL_ERROR, message: "boom" }], NOW);
    paint();

    expect(store.file("a.ts").groups[0].status).toBe("error");
  });

  it("never reports a run read back from the store as in flight", () => {
    store.adoptStoredRuns("a.ts", { runs: [run("old", "a.ts", { stale: true })], items: [] }, NOW);

    expect(store.file("a.ts").groups[0].inFlight).toBe(false);
  });
});

describe("settleRun", () => {
  it("gives the run its wall duration", () => {
    const created = start("a.ts");
    store.settleRun("a.ts", created.id, 1200, NOW);

    expect(store.file("a.ts").runs[0].durationMs).toBe(1200);
  });

  it("leaves a file alone when the run has already gone", () => {
    start("a.ts");

    expect(store.settleRun("a.ts", "gone", 10, NOW)).toBe(false);
  });
});

describe("hasWorkInFlight", () => {
  it("is what the settle check waits on", () => {
    const created = start("a.ts");
    const issued = call("GetShow", { output: undefined, durationMs: undefined });
    store.recordCall("a.ts", created.id, issued, NOW);

    expect(store.hasWorkInFlight("a.ts", created.id)).toBe(true);

    issued.output = {};
    store.recordCall("a.ts", created.id, issued, NOW);

    expect(store.hasWorkInFlight("a.ts", created.id)).toBe(false);
  });

  it("keeps a run parked on a question open, however its script returned", () => {
    const created = start("a.ts");
    const question: Block = { kind: "ask", question: "which?", answerType: "str" };
    store.recordBlock("a.ts", created.id, "block-1", question, NOW);

    expect(store.hasWorkInFlight("a.ts", created.id)).toBe(true);

    store.recordBlock("a.ts", created.id, "block-1", { ...question, answer: "this one" }, NOW);

    expect(store.hasWorkInFlight("a.ts", created.id)).toBe(false);
  });

  it("tells the settle check the moment a run goes quiet", () => {
    const created = start("a.ts");
    const quiet: string[] = [];
    store.subscribeQuiet((fileId, runId) => quiet.push(`${fileId}:${runId}`));
    const issued = call("GetShow", { output: undefined, durationMs: undefined });
    store.recordCall("a.ts", created.id, issued, NOW);

    expect(quiet).toEqual([]);

    issued.output = {};
    store.recordCall("a.ts", created.id, issued, NOW);

    expect(quiet).toEqual([`a.ts:${created.id}`]);
  });
});

describe("recordBlock", () => {
  it("keeps a block where it was emitted as it fills in", () => {
    const created = start("a.ts");
    store.recordBlock("a.ts", created.id, "table-1", { kind: "table", columns: ["a"], rows: [] }, NOW);
    store.recordCall("a.ts", created.id, call("GetShow"), NOW);
    store.recordBlock("a.ts", created.id, "table-1", { kind: "table", columns: ["a"], rows: [["1"]] }, NOW);
    paint();

    const items = store.file("a.ts").groups[0].items;
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("table-1");
    expect(items[0].block).toEqual({ kind: "table", columns: ["a"], rows: [["1"]] });
  });

  it("has nowhere to put a block from a run with no console", () => {
    store.recordBlock(undefined, "run-1", "block-1", { kind: "text", text: "hello" }, NOW);

    expect(store.file(undefined).runs).toHaveLength(0);
  });

  it("says which files are stopped waiting for an answer", () => {
    const created = start("a.ts");
    start("b.ts");
    store.recordBlock("a.ts", created.id, "block-1", { kind: "ask", question: "which?", answerType: "str" }, NOW);

    expect([...store.flagSets().waiting]).toEqual(["a.ts"]);
  });
});

describe("the sidebar's three sets", () => {
  it("name the files with a run that has not settled", () => {
    const created = start("a.ts");
    start("b.ts", "run-b");
    store.settleRun("b.ts", "run-b", 10, NOW);

    expect([...store.flagSets().running]).toEqual(["a.ts"]);

    store.settleRun("a.ts", created.id, 10, NOW);

    expect([...store.flagSets().running]).toEqual([]);
  });

  it("say which of those an agent is driving", () => {
    store.startRun(run("run-a", "a.ts", { origin: "agent" }), NOW);
    start("b.ts");

    expect([...store.flagSets().agent]).toEqual(["a.ts"]);
  });

  it("never count a run read back from the store", () => {
    store.adoptStoredRuns("a.ts", { runs: [run("old", "a.ts", { stale: true })], items: [] }, NOW);

    expect([...store.flagSets().running]).toEqual([]);
  });

  it("are not disturbed by the calls a run makes", () => {
    const created = start("a.ts");
    let flips = 0;
    store.subscribeFlags(() => flips++);

    for (let i = 0; i < 100; i++) store.recordCall("a.ts", created.id, call("GetShow"), NOW);

    expect(flips).toBe(0);
  });
});

describe("adoptStoredRuns", () => {
  it("puts stored runs underneath what has been run since", () => {
    const created = start("a.ts");
    store.adoptStoredRuns("a.ts", { runs: [run("old", "a.ts", { stale: true })], items: [] }, NOW);

    expect(store.file("a.ts").runs.map((r) => r.id)).toEqual(["old", created.id]);
  });

  it("reads the store once, so a second visit does not put back what was cleared", () => {
    store.adoptStoredRuns("a.ts", { runs: [run("old", "a.ts", { stale: true })], items: [] }, NOW);
    store.clearFile("a.ts", NOW);
    store.adoptStoredRuns("a.ts", { runs: [run("old", "a.ts", { stale: true })], items: [] }, NOW);

    expect(store.file("a.ts").runs).toHaveLength(0);
  });

  it("marks a file with nothing stored as read", () => {
    store.adoptStoredRuns("a.ts", undefined, NOW);

    expect(store.file("a.ts").loaded).toBe(true);
  });

  it("brings a stored run's items back with it", () => {
    const stored = run("old", "a.ts", { stale: true });
    store.adoptStoredRuns("a.ts", { runs: [stored], items: [{ id: "i1", runId: "old", timestamp: NOW, call: call("GetShow") }] }, NOW);

    expect(store.file("a.ts").groups[0].calls).toHaveLength(1);
  });
});

describe("selection, tab and view", () => {
  it("are kept per file, so coming back finds the console as it was left", () => {
    start("a.ts");
    start("b.ts");
    store.setSelection("a.ts", { runId: "run-a.ts", itemId: "i1" }, NOW);
    store.setTab("a.ts", "request", NOW);
    store.setView("a.ts", "canvas", NOW);

    expect(store.file("a.ts").selection).toEqual({ runId: "run-a.ts", itemId: "i1" });
    expect(store.file("a.ts").tab).toBe("request");
    expect(store.file("a.ts").view).toBe("canvas");
    expect(store.file("b.ts").tab).toBe("response");
    expect(store.file("b.ts").view).toBeUndefined();
  });

  it("start on the response tab with nothing selected", () => {
    start("a.ts");

    expect(store.file("a.ts").tab).toBe("response");
    expect(store.file("a.ts").selection).toBeNull();
  });

  it("sticks to the file across later runs", () => {
    start("a.ts", "run-1");
    store.setView("a.ts", "calls", NOW);
    start("a.ts", "run-2");

    expect(store.file("a.ts").view).toBe("calls");
  });
});

describe("run numbering", () => {
  it("counts a file's runs from one", () => {
    start("a.ts", "run-1");
    start("a.ts", "run-2");

    expect(store.file("a.ts").runs.map((r) => r.number)).toEqual([1, 2]);
  });

  it("never reuses a number the trimmed runs already spent", () => {
    for (let i = 0; i < 30; i++) start("a.ts", `run-${i}`);

    const numbers = store.file("a.ts").runs.map((r) => r.number);
    expect(numbers[0]).toBe(6);
    expect(numbers[numbers.length - 1]).toBe(30);
  });

  it("numbers each file's runs on its own", () => {
    start("a.ts", "run-a1");
    start("b.ts", "run-b1");

    expect(store.file("b.ts").runs[0].number).toBe(1);
  });
});

describe("renaming, taking and dropping a file", () => {
  it("moves a console to the name the file now has", () => {
    const created = start("draft-1");
    store.renameFile("draft-1", "/scripts/show.ts");

    expect(store.file("draft-1").runs).toHaveLength(0);
    expect(store.file("/scripts/show.ts").runs[0].id).toBe(created.id);
    expect(store.file("/scripts/show.ts").runs[0].fileId).toBe("/scripts/show.ts");
  });

  it("leaves a store with nothing under that name alone", () => {
    start("a.ts");
    store.renameFile("gone", "b.ts");

    expect(store.file("b.ts").runs).toHaveLength(0);
  });

  it("hands the console back so a discard can be undone", () => {
    start("draft-1");
    const taken = store.takeFile("draft-1");

    expect(store.file("draft-1").runs).toHaveLength(0);
    expect(taken?.runs).toHaveLength(1);

    store.putFile("draft-1", taken!);

    expect(store.file("draft-1").runs).toHaveLength(1);
  });

  it("drops a file outright", () => {
    start("a.ts");
    store.dropFile("a.ts");

    expect(store.file("a.ts").runs).toHaveLength(0);
  });
});

describe("the view a run opens in", () => {
  it("opens a run that drew something on its canvas", () => {
    const created = start("a.ts");
    store.recordBlock("a.ts", created.id, "b1", { kind: "text", text: "hello" }, NOW);
    paint();

    expect(defaultView(store.file("a.ts").groups[0])).toBe("canvas");
  });

  it("opens a run that only made calls on its log", () => {
    const created = start("a.ts");
    store.recordCall("a.ts", created.id, call("GetShow"), NOW);
    paint();

    expect(defaultView(store.file("a.ts").groups[0])).toBe("calls");
  });

  it("opens on the log when there is no run at all", () => {
    expect(defaultView(undefined)).toBe("calls");
  });
});

describe("followSelection", () => {
  function groupsWith(...counts: number[]) {
    for (const [index, count] of counts.entries()) {
      const created = start("a.ts", `run-${index}`);
      for (let i = 0; i < count; i++) store.recordCall("a.ts", created.id, call("GetShow"), NOW);
    }
    paint();
    return store.file("a.ts").groups;
  }

  const at = (runId: string, itemId?: string): RunSelection => ({ runId, itemId });

  it("opens a run that has just arrived, whichever run was being read", () => {
    const groups = groupsWith(1, 1);
    expect(followSelection(at("run-0"), groups, true, false)?.runId).toBe("run-1");
  });

  it("opens the first run there is", () => {
    expect(followSelection(null, groupsWith(1), true, true)?.runId).toBe("run-0");
  });

  it("follows the newest call while the log is at the bottom", () => {
    const groups = groupsWith(2);
    const newest = groups[0].calls[1].id;
    expect(followSelection(at("run-0", groups[0].calls[0].id), groups, false, true)?.itemId).toBe(newest);
  });

  it("leaves the cursor where it is once the log has been scrolled off the bottom", () => {
    const groups = groupsWith(2);
    const first = groups[0].calls[0].id;
    expect(followSelection(at("run-0", first), groups, false, false)?.itemId).toBe(first);
  });

  it("leaves a run stepped back to alone when a call lands in a later one", () => {
    const groups = groupsWith(1, 1);
    expect(followSelection(at("run-0"), groups, false, true)?.runId).toBe("run-0");
  });

  it("follows the newest run when the selected one has gone", () => {
    const groups = groupsWith(1, 1);
    expect(followSelection(at("gone"), groups, false, false)?.runId).toBe("run-1");
  });

  it("selects the header of a run that has produced nothing yet", () => {
    const groups = groupsWith(0);
    expect(followSelection(null, groups, true, true)).toEqual({ runId: "run-0", itemId: undefined });
  });

  it("has nothing to select once the history is cleared", () => {
    expect(followSelection(at("run-0"), [], false, true)).toBeNull();
  });
});

describe("clearing a file", () => {
  it("leaves it with an empty console rather than no console", () => {
    start("a.ts");
    store.clearFile("a.ts", NOW);

    expect(store.file("a.ts").runs).toHaveLength(0);
    expect(store.file("a.ts").loaded).toBe(true);
  });
});

describe("findBlock", () => {
  it("says which run drew a block, so a page fetched later lands in it", () => {
    const created = start("a.ts");
    store.recordBlock("a.ts", created.id, "table-1", { kind: "table", columns: ["a"], rows: [] }, NOW);

    expect(store.findBlock("table-1")?.run.id).toBe(created.id);
    expect(store.findBlock("table-1")?.fileId).toBe("a.ts");
    expect(store.findBlock("nothing")).toBeUndefined();
  });
});

describe("what a script printed", () => {
  it("is kept beside the calls rather than among them", () => {
    const created = start("a.ts");
    store.recordCall("a.ts", created.id, call("GetShow"), NOW);
    store.recordPrinted("a.ts", created.id, LogLevel.LEVEL_INFO, "42 shows", NOW + 1);
    paint();

    const group = store.file("a.ts").groups[0];
    expect(group.calls).toHaveLength(1);
    expect(group.printed).toHaveLength(1);
    // Both are still items, which is what puts them in one order.
    expect(group.items).toHaveLength(2);
  });

  /**
   * A script whose only output is `console.log` would otherwise open on a canvas
   * with nothing on it. Printing is not drawing.
   */
  it("does not count as something drawn", () => {
    const created = start("a.ts");
    store.recordPrinted("a.ts", created.id, LogLevel.LEVEL_INFO, "42 shows", NOW);
    paint();

    expect(store.file("a.ts").groups[0].drew).toBe(false);
    expect(defaultView(store.file("a.ts").groups[0])).toBe("calls");
  });

  it("does not fail a run, even at error level", () => {
    const created = start("a.ts");
    store.recordCall("a.ts", created.id, call("GetShow"), NOW);
    store.recordPrinted("a.ts", created.id, LogLevel.LEVEL_ERROR, "gave up on page 3", NOW + 1);
    paint();

    expect(store.file("a.ts").groups[0].status).toBe("success");
    expect(store.file("a.ts").groups[0].failures).toBe(0);
  });

  // A script error is a verdict Kaja wrote, and goes on being one.
  it("leaves a script error failing the run", () => {
    const created = start("a.ts");
    store.recordLogs("a.ts", created.id, [{ level: LogLevel.LEVEL_ERROR, message: "boom" }], NOW);
    paint();

    expect(store.file("a.ts").groups[0].status).toBe("error");
  });
});

describe("the log floor", () => {
  it("is off until it is asked for, and then sticks to the file", () => {
    start("a.ts");
    expect(store.file("a.ts").logFloor).toBe("off");

    store.setLogFloor("a.ts", "all", NOW);
    expect(store.file("a.ts").logFloor).toBe("all");
    // Another file is another decision.
    start("b.ts");
    expect(store.file("b.ts").logFloor).toBe("off");
  });
});

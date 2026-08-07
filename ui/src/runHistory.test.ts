import { describe, expect, it } from "bun:test";
import { MethodCall } from "./kaja";
import {
  adoptStoredRuns,
  clearFile,
  dropFile,
  fileConsole,
  hasCallsInFlight,
  putFile,
  recordCall,
  recordLogs,
  renameFile,
  RunHistory,
  runningFileIds,
  setSelection,
  setTab,
  settleRun,
  startRun,
  takeFile,
} from "./runHistory";
import { Run } from "./runs";
import { LogLevel } from "./server/api";

const NOW = 1_700_000_000_000;

function run(id: string, fileId?: string, startedAt = NOW): Run {
  return { id, title: id, fileId, startedAt };
}

function call(id: string, output?: unknown): MethodCall {
  return { id, appName: "theatre", service: { name: "Shows" }, method: { name: "ListShows" }, output, timestamp: NOW } as MethodCall;
}

describe("startRun", () => {
  it("lands a run in the console of the file it was pressed on", () => {
    const history = startRun({}, run("r1", "a"), NOW);
    expect(fileConsole(history, "a").runs.map((r) => r.id)).toEqual(["r1"]);
    expect(fileConsole(history, "b").runs).toEqual([]);
  });

  it("keeps one file's runs out of another's", () => {
    let history: RunHistory = {};
    history = startRun(history, run("r1", "a"), NOW);
    history = startRun(history, run("r2", "b"), NOW);
    history = startRun(history, run("r3", "a"), NOW);
    expect(fileConsole(history, "a").runs.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(fileConsole(history, "b").runs.map((r) => r.id)).toEqual(["r2"]);
  });

  it("does not keep a run with no file of its own", () => {
    expect(startRun({}, run("r1"), NOW)).toEqual({});
  });

  it("drops the oldest runs of a file past the cap, and their calls with them", () => {
    let history: RunHistory = {};
    for (let index = 0; index < 30; index++) {
      history = startRun(history, run(`r${index}`, "a"), NOW + index);
      history = recordCall(history, "a", `r${index}`, call(`c${index}`), NOW + index);
    }
    const file = fileConsole(history, "a");
    expect(file.runs).toHaveLength(25);
    expect(file.runs[0].id).toBe("r5");
    expect(file.items.every((item) => item.runId !== "r0")).toBe(true);
  });

  it("holds fifty files and lets go of the least recently run", () => {
    let history: RunHistory = {};
    for (let index = 0; index < 60; index++) {
      history = startRun(history, run(`r${index}`, `f${index}`, NOW + index), NOW + index);
    }
    expect(Object.keys(history)).toHaveLength(50);
    expect(history.f0).toBeUndefined();
    expect(history.f59).toBeDefined();
  });
});

describe("recordCall", () => {
  it("replaces a call already in the run rather than appending it again", () => {
    let history = startRun({}, run("r1", "a"), NOW);
    history = recordCall(history, "a", "r1", call("c1"), NOW);
    history = recordCall(history, "a", "r1", call("c1", { shows: [] }), NOW);
    const file = fileConsole(history, "a");
    expect(file.items).toHaveLength(1);
    expect(file.items[0].call?.output).toEqual({ shows: [] });
  });

  it("keeps calls in the order they started", () => {
    let history = startRun({}, run("r1", "a"), NOW);
    history = recordCall(history, "a", "r1", call("c1"), NOW);
    history = recordCall(history, "a", "r1", call("c2"), NOW);
    history = recordCall(history, "a", "r1", call("c1", { done: true }), NOW);
    expect(fileConsole(history, "a").items.map((item) => item.call?.id)).toEqual(["c1", "c2"]);
  });
});

describe("settleRun", () => {
  it("gives the run its wall duration", () => {
    let history = startRun({}, run("r1", "a"), NOW);
    history = settleRun(history, "a", "r1", 212, NOW);
    expect(fileConsole(history, "a").runs[0].durationMs).toBe(212);
  });

  it("leaves a file alone when the run has already gone", () => {
    const history = startRun({}, run("r1", "a"), NOW);
    expect(settleRun(history, "a", "gone", 1, NOW)).toBe(history);
  });
});

describe("adoptStoredRuns", () => {
  it("puts stored runs underneath what has been run since", () => {
    let history = startRun({}, run("live", "a"), NOW + 100);
    history = adoptStoredRuns(history, "a", { runs: [{ ...run("old", "a"), stale: true }], items: [] }, NOW);
    expect(fileConsole(history, "a").runs.map((r) => r.id)).toEqual(["old", "live"]);
  });

  it("reads the store once, so a second visit does not put back what was cleared", () => {
    const stored = { runs: [{ ...run("old", "a"), stale: true }], items: [] };
    let history = adoptStoredRuns({}, "a", stored, NOW);
    history = clearFile(history, "a", NOW);
    history = adoptStoredRuns(history, "a", stored, NOW);
    expect(fileConsole(history, "a").runs).toEqual([]);
  });

  it("marks a file with nothing stored as read", () => {
    const history = adoptStoredRuns({}, "a", undefined, NOW);
    expect(fileConsole(history, "a").loaded).toBe(true);
  });
});

describe("selection and tab", () => {
  it("are kept per file, so coming back finds the console as it was left", () => {
    let history = startRun({}, run("r1", "a"), NOW);
    history = startRun(history, run("r2", "b"), NOW);
    history = setSelection(history, "a", { runId: "r1", itemId: "i1" }, NOW);
    history = setTab(history, "a", "headers", NOW);
    history = setTab(history, "b", "request", NOW);

    expect(fileConsole(history, "a").selection).toEqual({ runId: "r1", itemId: "i1" });
    expect(fileConsole(history, "a").tab).toBe("headers");
    expect(fileConsole(history, "b").selection).toBeNull();
    expect(fileConsole(history, "b").tab).toBe("request");
  });

  it("start on the response tab with nothing selected", () => {
    const file = fileConsole({}, "never-run");
    expect(file.selection).toBeNull();
    expect(file.tab).toBe("response");
  });
});

describe("renameFile", () => {
  it("moves a console to the name the file now has", () => {
    let history = startRun({}, run("r1", "scratch-1"), NOW);
    history = renameFile(history, "scratch-1", "/scripts/shows.ts");
    expect(history["scratch-1"]).toBeUndefined();
    expect(fileConsole(history, "/scripts/shows.ts").runs[0].fileId).toBe("/scripts/shows.ts");
  });

  it("leaves a history with nothing under that name alone", () => {
    const history = startRun({}, run("r1", "a"), NOW);
    expect(renameFile(history, "b", "c")).toBe(history);
  });
});

describe("taking a console out and putting it back", () => {
  it("hands the console back so a discard can be undone", () => {
    const history = recordLogs(startRun({}, run("r1", "a"), NOW), "a", "r1", [{ level: LogLevel.LEVEL_ERROR, message: "boom" }], NOW);
    const [without, taken] = takeFile(history, "a");
    expect(without.a).toBeUndefined();
    expect(taken?.items).toHaveLength(1);
    expect(fileConsole(putFile(without, "a", taken!), "a").items).toHaveLength(1);
  });

  it("drops a file outright", () => {
    expect(dropFile(startRun({}, run("r1", "a"), NOW), "a").a).toBeUndefined();
  });
});

describe("running files", () => {
  it("names the files with a run that has not settled", () => {
    let history = startRun({}, run("r1", "a"), NOW);
    history = startRun(history, run("r2", "b"), NOW);
    history = settleRun(history, "b", "r2", 10, NOW);
    expect(runningFileIds(history)).toEqual(new Set(["a"]));
  });

  it("never counts a run read back from the store", () => {
    const history = adoptStoredRuns({}, "a", { runs: [{ ...run("old", "a"), stale: true }], items: [] }, NOW);
    expect(runningFileIds(history)).toEqual(new Set());
  });
});

describe("hasCallsInFlight", () => {
  it("is what the settle check waits on", () => {
    let history = startRun({}, run("r1", "a"), NOW);
    history = recordCall(history, "a", "r1", call("c1"), NOW);
    expect(hasCallsInFlight(fileConsole(history, "a"), "r1")).toBe(true);
    history = recordCall(history, "a", "r1", call("c1", { shows: [] }), NOW);
    expect(hasCallsInFlight(fileConsole(history, "a"), "r1")).toBe(false);
  });
});

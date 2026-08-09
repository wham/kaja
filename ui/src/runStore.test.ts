import { describe, expect, it } from "bun:test";
import { MethodCall } from "./kaja";
import { ConsoleItem, Run } from "./runs";
import { deserializeFile, pruneArchive, RunArchive, serializeFile, StoredFile } from "./runStore";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const run: Run = { id: "r1", title: "ListShows", fileId: "scratch-1", startedAt: NOW, durationMs: 212 };

function call(output: unknown, runId = run.id, id = "item-1"): ConsoleItem {
  const methodCall = {
    id: `call-${id}`,
    appName: "theatre",
    service: { name: "Shows" },
    method: { name: "ListShows" },
    input: { pageSize: 20 },
    output,
    timestamp: NOW,
    durationMs: 212,
  } as MethodCall;
  return { id, runId, timestamp: NOW, call: methodCall };
}

describe("serializeFile", () => {
  it("marks what it stores as stale, so it can never come back looking live", () => {
    const stored = serializeFile([run], [call({ shows: [] })], NOW);
    expect(stored.runs[0].run.stale).toBe(true);
    expect(stored.runs[0].run.payloadsExpired).toBe(false);
  });

  it("keeps the header and drops the payloads when they are too big to hold", () => {
    const stored = serializeFile([run], [call({ blob: "x".repeat(600 * 1024) })], NOW);
    expect(stored.runs[0].items).toEqual([]);
    expect(stored.runs[0].run.payloadsExpired).toBe(true);
    expect(stored.runs[0].run.title).toBe("ListShows");
  });

  it("keeps only the newest few runs of a file", () => {
    const runs = Array.from({ length: 5 }, (_, index) => ({ ...run, id: `r${index}`, startedAt: NOW + index }));
    const stored = serializeFile(runs, [], NOW);
    expect(stored.runs.map((entry) => entry.run.id)).toEqual(["r2", "r3", "r4"]);
  });

  it("spends the payload budget on the newest run first, so what is dropped is the oldest", () => {
    const big = { blob: "x".repeat(400 * 1024) };
    const runs = [
      { ...run, id: "old", startedAt: NOW },
      { ...run, id: "new", startedAt: NOW + 1 },
    ];
    const items = [call(big, "old", "item-old"), call(big, "new", "item-new")];
    const stored = serializeFile(runs, items, NOW);
    expect(stored.runs[0].run.id).toBe("old");
    expect(stored.runs[0].run.payloadsExpired).toBe(true);
    expect(stored.runs[1].run.payloadsExpired).toBe(false);
    expect(stored.runs[1].items).toHaveLength(1);
  });

  it("round-trips a call back into something the console can render", () => {
    const loaded = deserializeFile(serializeFile([run], [call({ shows: [1, 2] })], NOW));
    expect(loaded.runs[0].id).toBe("r1");
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0].runId).toBe("r1");
    expect(loaded.items[0].call?.service.name).toBe("Shows");
    expect(loaded.items[0].call?.method.name).toBe("ListShows");
    expect(loaded.items[0].call?.output).toEqual({ shows: [1, 2] });
    expect(loaded.items[0].call?.durationMs).toBe(212);
  });
});

function archiveEntry(fileId: string, startedAt: number, storedAt: number): [string, StoredFile] {
  return [
    fileId,
    {
      runs: [{ run: { ...run, id: fileId, fileId, startedAt, stale: true }, items: [{ id: "item-1", timestamp: startedAt }] }],
      storedAt,
    },
  ];
}

describe("pruneArchive", () => {
  it("keeps a run's header past the payload cut-off, because expiry has to be a stated state", () => {
    const archive: RunArchive = Object.fromEntries([archiveEntry("a", NOW - 10 * DAY, NOW - 10 * DAY)]);
    const pruned = pruneArchive(archive, NOW);
    expect(pruned.a.runs[0].run.payloadsExpired).toBe(true);
    expect(pruned.a.runs[0].items).toEqual([]);
    expect(pruned.a.runs[0].run.title).toBe("ListShows");
  });

  it("leaves a recent run alone", () => {
    const archive: RunArchive = Object.fromEntries([archiveEntry("a", NOW - DAY, NOW - DAY)]);
    expect(pruneArchive(archive, NOW).a.runs[0].run.payloadsExpired).toBeUndefined();
    expect(pruneArchive(archive, NOW).a.runs[0].items).toHaveLength(1);
  });

  it("holds the fifty most recently run files and no more", () => {
    const entries = Array.from({ length: 60 }, (_, index) => archiveEntry(`s${index}`, NOW - index * 1000, NOW));
    const pruned = pruneArchive(Object.fromEntries(entries), NOW);
    expect(Object.keys(pruned)).toHaveLength(50);
    expect(pruned.s0).toBeDefined();
    expect(pruned.s59).toBeUndefined();
  });

  it("drops an entry written in a shape it can no longer read", () => {
    const archive = { old: { run: { ...run }, items: [], storedAt: NOW } } as unknown as RunArchive;
    expect(pruneArchive(archive, NOW)).toEqual({});
  });
});

describe("blocks in the store", () => {
  it("brings back what a run drew", () => {
    const items: ConsoleItem[] = [
      { id: "b1", runId: "r1", timestamp: NOW, block: { kind: "table", columns: ["id"], rows: [["ac_1"]] } },
      { id: "b2", runId: "r1", timestamp: NOW, block: { kind: "ask", question: "Which ledger?", answerType: "str", answer: "june" } },
    ];
    const loaded = deserializeFile(serializeFile([run], items, NOW));
    expect(loaded.items.map((item) => item.block)).toEqual([
      { kind: "table", columns: ["id"], rows: [["ac_1"]] },
      { kind: "ask", question: "Which ledger?", answerType: "str", answer: "june" },
    ]);
  });

  // The promise the question was blocking died with the session, so reading it
  // back as still waiting would offer an input nothing is listening to.
  it("stores a question nobody answered as one that was abandoned", () => {
    const items: ConsoleItem[] = [{ id: "b1", runId: "r1", timestamp: NOW, block: { kind: "ask", question: "Which ledger?", answerType: "str" } }];
    const loaded = deserializeFile(serializeFile([run], items, NOW));
    expect(loaded.items[0].block).toEqual({ kind: "ask", question: "Which ledger?", answerType: "str", cancelled: true });
  });

  // And that is the truth about the call, too: nothing ever sent it.
  it("stores a call nobody approved as one that was not approved", () => {
    const items: ConsoleItem[] = [{ id: "b1", runId: "r1", timestamp: NOW, block: { kind: "approve", method: "Shows.CreateShow", request: "{}" } }];
    const loaded = deserializeFile(serializeFile([run], items, NOW));
    expect(loaded.items[0].block).toEqual({ kind: "approve", method: "Shows.CreateShow", request: "{}", decision: "rejected" });
  });
});

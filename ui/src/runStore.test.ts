import { describe, expect, it } from "bun:test";
import { MethodCall } from "./kaja";
import { ConsoleItem, Run } from "./runs";
import { deserializeRun, pruneArchive, RunArchive, serializeRun, StoredRun } from "./runStore";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const run: Run = { id: "r1", title: "ListShows", sourceId: "scratch-1", startedAt: NOW, durationMs: 212 };

function call(output: unknown): ConsoleItem {
  const methodCall = {
    id: "call-1",
    appName: "theatre",
    service: { name: "Shows" },
    method: { name: "ListShows" },
    input: { pageSize: 20 },
    output,
    timestamp: NOW,
    durationMs: 212,
  } as MethodCall;
  return { id: "item-1", runId: run.id, timestamp: NOW, call: methodCall };
}

describe("serializeRun", () => {
  it("marks what it stores as stale, so it can never come back looking live", () => {
    const stored = serializeRun(run, [call({ shows: [] })], NOW);
    expect(stored.run.stale).toBe(true);
    expect(stored.run.payloadsExpired).toBe(false);
  });

  it("keeps the header and drops the payloads when they are too big to hold", () => {
    const stored = serializeRun(run, [call({ blob: "x".repeat(600 * 1024) })], NOW);
    expect(stored.items).toEqual([]);
    expect(stored.run.payloadsExpired).toBe(true);
    expect(stored.run.title).toBe("ListShows");
  });

  it("round-trips a call back into something the console can render", () => {
    const loaded = deserializeRun(serializeRun(run, [call({ shows: [1, 2] })], NOW));
    expect(loaded.run.id).toBe("r1");
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0].runId).toBe("r1");
    expect(loaded.items[0].call?.service.name).toBe("Shows");
    expect(loaded.items[0].call?.method.name).toBe("ListShows");
    expect(loaded.items[0].call?.output).toEqual({ shows: [1, 2] });
    expect(loaded.items[0].call?.durationMs).toBe(212);
  });
});

function archiveEntry(sourceId: string, startedAt: number, storedAt: number): [string, StoredRun] {
  return [
    sourceId,
    {
      run: { ...run, id: sourceId, sourceId, startedAt, stale: true },
      items: [call({})].map((item) => ({ id: item.id, timestamp: item.timestamp })),
      storedAt,
    },
  ];
}

describe("pruneArchive", () => {
  it("keeps a run's header past the payload cut-off, because expiry has to be a stated state", () => {
    const archive: RunArchive = Object.fromEntries([archiveEntry("a", NOW - 10 * DAY, NOW - 10 * DAY)]);
    const pruned = pruneArchive(archive, NOW);
    expect(pruned.a.run.payloadsExpired).toBe(true);
    expect(pruned.a.items).toEqual([]);
    expect(pruned.a.run.title).toBe("ListShows");
  });

  it("leaves a recent run alone", () => {
    const archive: RunArchive = Object.fromEntries([archiveEntry("a", NOW - DAY, NOW - DAY)]);
    expect(pruneArchive(archive, NOW).a.run.payloadsExpired).toBeUndefined();
    expect(pruneArchive(archive, NOW).a.items).toHaveLength(1);
  });

  it("holds the fifty most recently run files and no more", () => {
    const entries = Array.from({ length: 60 }, (_, index) => archiveEntry(`s${index}`, NOW - index * 1000, NOW));
    const pruned = pruneArchive(Object.fromEntries(entries), NOW);
    expect(Object.keys(pruned)).toHaveLength(50);
    expect(pruned.s0).toBeDefined();
    expect(pruned.s59).toBeUndefined();
  });
});

import { describe, expect, it } from "bun:test";
import { MethodCall } from "./kaja";
import { ConsoleItem } from "./runs";
import { barHeight, BAR_MAX_HEIGHT, BAR_MIN_HEIGHT, MAX_SLOTS, RunStrip, slotsFor } from "./runStrip";

const NOW = 1_700_000_000_000;

let items = 0;
function call(method: string, changes: Partial<MethodCall> = {}): ConsoleItem {
  items++;
  const methodCall = {
    id: `call-${items}`,
    appName: "app",
    service: { name: "Shows" },
    method: { name: method },
    input: {},
    output: {},
    timestamp: NOW + items,
    durationMs: 10,
    ...changes,
  } as MethodCall;
  return { id: `item-${items}`, runId: "run-1", timestamp: methodCall.timestamp, call: methodCall };
}

function filled(count: number, method = "GetShow"): RunStrip {
  const strip = new RunStrip();
  for (let index = 0; index < count; index++) strip.add(call(method));
  return strip;
}

describe("how much room the strip is given", () => {
  it("is nothing under 240px, where it would stop being able to count", () => {
    expect(slotsFor(239)).toBe(0);
    expect(slotsFor(240)).toBe(48);
  });

  it("grows with the room, one slot per 5px", () => {
    expect(slotsFor(500)).toBe(100);
  });

  it("stops at 200, past which a tick is under a pixel of information", () => {
    expect(slotsFor(4000)).toBe(MAX_SLOTS);
  });
});

describe("ticks and bars", () => {
  it("draws one mark per call while a mark can still be a call", () => {
    const view = filled(40).view(48);

    expect(view.mode).toBe("ticks");
    expect(view.slots).toHaveLength(40);
    expect(view.slots.every((slot) => slot.calls === 1)).toBe(true);
  });

  it("becomes a histogram the moment the calls outnumber the slots", () => {
    const view = filled(100).view(48);

    expect(view.mode).toBe("bars");
    expect(view.slots.length).toBeLessThanOrEqual(48);
    expect(view.slots.reduce((total, slot) => total + slot.calls, 0)).toBe(100);
  });

  it("switches on the room rather than on a count — the same run, two panels", () => {
    const strip = filled(60);

    expect(strip.view(48).mode).toBe("bars");
    expect(strip.view(MAX_SLOTS).mode).toBe("ticks");
  });

  it("keeps every call in a bucket however long the run gets", () => {
    const view = filled(5_000).view(48);

    expect(view.slots.reduce((total, slot) => total + slot.calls, 0)).toBe(5_000);
  });

  it("names the method a single call was, and only then", () => {
    const strip = filled(3, "ListShows");

    expect(strip.view(MAX_SLOTS).slots[0].method).toBe("Shows.ListShows");
    expect(strip.view(1).slots[0].method).toBeUndefined();
  });
});

describe("what the strip counts", () => {
  it("counts a call once however many times it arrives", () => {
    const strip = new RunStrip();
    const item = call("GetShow", { durationMs: undefined, output: undefined });
    strip.add(item);
    item.call!.durationMs = 40;
    item.call!.error = { code: "NOT_FOUND" };
    strip.add(item);

    expect(strip.calls).toBe(1);
    expect(strip.failures).toBe(1);
    expect(strip.view(MAX_SLOTS).slots[0].slowest).toBe(40);
  });

  it("carries a failure into the bucket it was merged into", () => {
    const strip = new RunStrip();
    strip.add(call("GetShow", { error: { code: "NOT_FOUND" } }));
    for (let index = 0; index < 500; index++) strip.add(call("GetShow"));

    const view = strip.view(48);
    expect(strip.failures).toBe(1);
    expect(view.slots.filter((slot) => slot.failures > 0)).toHaveLength(1);
  });

  it("names the two methods it called most, with counts", () => {
    const strip = new RunStrip();
    for (let index = 0; index < 42; index++) strip.add(call("Post"));
    strip.add(call("List"));
    strip.add(call("Delete"));

    expect(strip.methodLabel).toBe("Shows.Post ×42 · Shows.List");
  });

  it("says nothing about a run that has made no calls", () => {
    expect(new RunStrip().methodLabel).toBeUndefined();
    expect(new RunStrip().view(48).slots).toHaveLength(0);
  });
});

describe("how tall a bar is drawn", () => {
  it("is the bucket's slowest call against the run's", () => {
    expect(barHeight(100, 100)).toBe(BAR_MAX_HEIGHT);
    expect(barHeight(1, 100)).toBe(BAR_MIN_HEIGHT);
  });

  it("is the floor for a bucket nothing has settled in — a gap would read as no calls", () => {
    expect(barHeight(0, 100)).toBe(BAR_MIN_HEIGHT);
    expect(barHeight(40, undefined)).toBe(BAR_MIN_HEIGHT);
  });
});

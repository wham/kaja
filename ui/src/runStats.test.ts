import { describe, expect, it } from "bun:test";
import { MethodCall } from "./kaja";
import { ConsoleItem } from "./runs";
import { distributionBars, latencyBucket, latencyBucketFloor, Latencies, RunMetrics } from "./runStats";

const START = 1_700_000_000_000;

function call(
  id: string,
  { at = 0, durationMs, method = "ListShows", error, key }: { at?: number; durationMs?: number; method?: string; error?: unknown; key?: string } = {},
): ConsoleItem {
  const methodCall = {
    id,
    appName: "app",
    service: { name: "Shows" },
    method: { name: method },
    input: {},
    output: durationMs === undefined ? undefined : {},
    error,
    timestamp: START + at,
    durationMs,
  } as MethodCall;
  return { id, runId: "run-1", timestamp: methodCall.timestamp, call: methodCall, key };
}

// A call as it arrives twice: issued with nothing settled, then again with what it took.
function issueThenSettle(metrics: RunMetrics, item: ConsoleItem, durationMs: number, error?: unknown): void {
  metrics.add(item);
  item.call!.durationMs = durationMs;
  item.call!.output = {};
  if (error !== undefined) item.call!.error = error;
  metrics.add(item);
}

describe("latency buckets", () => {
  it("rises with the value and stays inside its own bounds", () => {
    for (const ms of [0.3, 1, 7, 41, 96, 214, 1_204, 60_000]) {
      const bucket = latencyBucket(ms);
      expect(latencyBucketFloor(bucket)).toBeLessThanOrEqual(ms);
      expect(latencyBucketFloor(bucket + 1)).toBeGreaterThan(ms);
    }
  });

  it("puts a zero and a negative duration at the floor rather than off the axis", () => {
    expect(latencyBucket(0)).toBe(0);
    expect(latencyBucket(-5)).toBe(0);
  });
});

describe("Latencies", () => {
  it("reports exact percentiles while the values are still kept", () => {
    const latencies = new Latencies();
    for (let value = 1; value <= 100; value++) latencies.add(value);
    expect(latencies.percentile(0.5)).toBe(50);
    expect(latencies.percentile(0.95)).toBe(95);
    expect(latencies.percentile(0.99)).toBe(99);
    expect(latencies.max).toBe(100);
    expect(latencies.min).toBe(1);
  });

  it("stays within a bucket's width once it falls back on the histogram", () => {
    const latencies = new Latencies();
    for (let index = 0; index < 10_000; index++) latencies.add(1 + (index % 500));
    const p50 = latencies.percentile(0.5)!;
    // Nearest-rank over 1..500 repeated puts the median at 250; the histogram may
    // report any value inside that bucket, and no more.
    expect(Math.abs(p50 - 250) / 250).toBeLessThan(0.05);
    expect(latencies.total).toBe(10_000);
    expect(latencies.max).toBe(500);
  });

  it("has nothing to say about an empty set", () => {
    const latencies = new Latencies();
    expect(latencies.percentile(0.5)).toBeUndefined();
    expect(latencies.max).toBeUndefined();
    expect(latencies.mean).toBeUndefined();
  });

  it("merges two sets into one that reads the same as adding them in order", () => {
    const merged = new Latencies();
    const other = new Latencies();
    for (let value = 1; value <= 50; value++) merged.add(value);
    for (let value = 51; value <= 100; value++) other.add(value);
    merged.merge(other);
    expect(merged.total).toBe(100);
    expect(merged.percentile(0.5)).toBe(50);
    expect(merged.max).toBe(100);
  });
});

describe("RunMetrics", () => {
  it("counts a call once however many times it arrives", () => {
    const metrics = new RunMetrics(START);
    const item = call("a", { at: 0 });
    issueThenSettle(metrics, item, 40);
    metrics.add(item);
    const stats = metrics.view(20, 16, 1_000);
    expect(stats.calls).toBe(1);
    expect(stats.settled).toBe(1);
    expect(stats.failures).toBe(0);
  });

  it("counts a failure once and states it as a rate over the calls", () => {
    const metrics = new RunMetrics(START);
    for (let index = 0; index < 8; index++) issueThenSettle(metrics, call(`ok-${index}`, { at: index * 10 }), 10);
    const failed = call("bad", { at: 90 });
    issueThenSettle(metrics, failed, 10, { code: "UNAVAILABLE" });
    metrics.add(failed);
    const stats = metrics.view(20, 16, 1_000);
    expect(stats.calls).toBe(9);
    expect(stats.failures).toBe(1);
    expect(stats.errorRate).toBeCloseTo(1 / 9);
  });

  it("keeps the run's own clock rather than the reach of its calls", () => {
    const metrics = new RunMetrics(START);
    issueThenSettle(metrics, call("a", { at: 0 }), 20);
    // The script slept for the rest of the run, so the calls say 20ms and the run 5s.
    const stats = metrics.view(20, 16, 5_000);
    expect(stats.spanMs).toBe(5_000);
    expect(stats.meanRps).toBeCloseTo(0.2);
  });

  it("splits a run across slices and gives each its own throughput", () => {
    const metrics = new RunMetrics(START);
    for (let index = 0; index < 100; index++) issueThenSettle(metrics, call(`c-${index}`, { at: index * 10 }), 5);
    const stats = metrics.view(10, 16, 1_000);
    expect(stats.slots.length).toBeLessThanOrEqual(10);
    expect(stats.slots.reduce((total, slot) => total + slot.calls, 0)).toBe(100);
    // A hundred calls over a second, however the slices fall.
    expect(stats.meanRps).toBeCloseTo(100);
  });

  it("holds its counts as the buckets double under a long run", () => {
    const metrics = new RunMetrics(START);
    // Far past MAX_TIME_BUCKETS at the starting resolution, so the timeline collapses
    // several times over.
    for (let index = 0; index < 400; index++) issueThenSettle(metrics, call(`c-${index}`, { at: index * 500 }), 20);
    const stats = metrics.view(60, 16, 200_000);
    expect(stats.calls).toBe(400);
    expect(stats.slots.reduce((total, slot) => total + slot.calls, 0)).toBe(400);
    expect(stats.slots.length).toBeLessThanOrEqual(60);
  });

  it("reads concurrency off calls that overlap, and one off a serial loop", () => {
    const serial = new RunMetrics(START);
    for (let index = 0; index < 20; index++) issueThenSettle(serial, call(`s-${index}`, { at: index * 100 }), 90);
    expect(serial.view(20, 16, 2_000).maxInFlight).toBe(1);

    const parallel = new RunMetrics(START);
    const items = Array.from({ length: 10 }, (unused, index) => call(`p-${index}`, { at: 0 }));
    for (const item of items) parallel.add(item);
    expect(parallel.view(20, 16, 1_000).maxInFlight).toBe(10);
  });

  it("names the slowest call and the value that identifies it", () => {
    const metrics = new RunMetrics(START);
    issueThenSettle(metrics, call("a", { at: 0, key: "page 1" }), 40);
    issueThenSettle(metrics, call("b", { at: 100, key: "vera-lune", method: "GetShow" }), 1_204);
    issueThenSettle(metrics, call("c", { at: 200, key: "page 3" }), 60);
    const stats = metrics.view(20, 16, 1_000);
    expect(stats.slowest).toMatchObject({ itemId: "b", method: "Shows.GetShow", key: "vera-lune", durationMs: 1_204 });
  });

  it("breaks the run down per method, busiest first", () => {
    const metrics = new RunMetrics(START);
    for (let index = 0; index < 6; index++) issueThenSettle(metrics, call(`l-${index}`, { at: index * 10 }), 31);
    for (let index = 0; index < 4; index++) issueThenSettle(metrics, call(`g-${index}`, { at: index * 10, method: "GetShow" }), 48);
    const failed = call("g-bad", { at: 90, method: "GetShow" });
    issueThenSettle(metrics, failed, 48, { status: 503 });
    const stats = metrics.view(20, 16, 1_000);
    expect(stats.methods.map((row) => row.method)).toEqual(["Shows.ListShows", "Shows.GetShow"]);
    expect(stats.methods[0]).toMatchObject({ calls: 6, failures: 0, p50: 31, max: 31 });
    expect(stats.methods[1]).toMatchObject({ calls: 5, failures: 1 });
  });

  it("says nothing about a run whose calls have not settled", () => {
    const metrics = new RunMetrics(START);
    metrics.add(call("a", { at: 0 }));
    const stats = metrics.view(20, 16, undefined);
    expect(stats.calls).toBe(1);
    expect(stats.settled).toBe(0);
    expect(stats.p50).toBeUndefined();
    expect(stats.distribution).toEqual([]);
    expect(stats.markers).toEqual([]);
  });

  it("uses the upstream duration where one was measured", () => {
    const metrics = new RunMetrics(START);
    const item = call("a", { at: 0 });
    metrics.add(item);
    item.call!.durationMs = 90;
    item.call!.upstreamDurationMs = 40;
    item.call!.output = {};
    metrics.add(item);
    expect(metrics.view(20, 16, 1_000).p50).toBe(40);
  });

  it("bumps its version only for something a chart would draw", () => {
    const metrics = new RunMetrics(START);
    const item = call("a", { at: 0 });
    metrics.add(item);
    const issued = metrics.version;
    metrics.add(item);
    expect(metrics.version).toBe(issued);
    item.call!.durationMs = 40;
    metrics.add(item);
    expect(metrics.version).toBeGreaterThan(issued);
  });
});

describe("distributionBars", () => {
  it("covers every sample and stays inside the room it is given", () => {
    const latencies = new Latencies();
    for (const ms of [10, 12, 14, 40, 45, 300, 1_200]) latencies.add(ms);
    const bars = distributionBars(latencies, 16);
    expect(bars.length).toBeLessThanOrEqual(16);
    expect(bars.reduce((total, bar) => total + bar.calls, 0)).toBe(7);
    expect(bars[0].position).toBe(0);
    expect(bars[bars.length - 1].position + bars[bars.length - 1].width).toBeCloseTo(1);
  });

  it("draws one bar for a run whose calls all took the same time", () => {
    const latencies = new Latencies();
    for (let index = 0; index < 5; index++) latencies.add(40);
    const bars = distributionBars(latencies, 16);
    expect(bars).toHaveLength(1);
    expect(bars[0].calls).toBe(5);
  });

  it("has nothing to draw for a run with no calls", () => {
    expect(distributionBars(new Latencies(), 16)).toEqual([]);
  });
});

describe("percentile markers", () => {
  it("says once where two percentiles landed on the same value", () => {
    const metrics = new RunMetrics(START);
    for (let index = 0; index < 12; index++) issueThenSettle(metrics, call(`c-${index}`, { at: index * 10 }), index < 6 ? 40 : 260);
    const stats = metrics.view(20, 16, 1_000);
    // Over twelve samples p95 and p99 are the same call, so one label covers both
    // rather than one being drawn silently under the other.
    expect(stats.markers.map((marker) => marker.label)).toEqual(["p50", "p95\u00b7p99"]);
  });

  it("keeps them apart where the run's tail actually separates them", () => {
    const metrics = new RunMetrics(START);
    for (let index = 0; index < 200; index++) {
      const ms = index < 180 ? 30 : index < 195 ? 400 : 3_000;
      issueThenSettle(metrics, call(`c-${index}`, { at: index * 5 }), ms);
    }
    const stats = metrics.view(40, 20, 1_000);
    expect(stats.markers.map((marker) => marker.label)).toEqual(["p50", "p95", "p99"]);
    expect(stats.markers[0].position).toBeLessThan(stats.markers[1].position);
    expect(stats.markers[1].position).toBeLessThan(stats.markers[2].position);
  });
});

describe("slicing", () => {
  it("never slices a run finer than the calls it made", () => {
    const metrics = new RunMetrics(START);
    for (let index = 0; index < 20; index++) issueThenSettle(metrics, call(`c-${index}`, { at: index * 50 }), 10);
    // Eighty slices over twenty calls is a chart that is mostly gaps.
    expect(metrics.view(80, 16, 1_000).slots.length).toBeLessThanOrEqual(20);
  });

  it("keeps a floor, so three calls still draw a timeline rather than three columns", () => {
    const metrics = new RunMetrics(START);
    for (let index = 0; index < 3; index++) issueThenSettle(metrics, call(`c-${index}`, { at: index * 300 }), 10);
    expect(metrics.view(80, 16, 1_000).slots.length).toBeGreaterThan(3);
  });
});

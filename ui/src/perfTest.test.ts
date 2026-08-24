import { describe, expect, it } from "bun:test";
import { parseDuration, PerfPlan, PerfSchedule, phaseAt, runPerfTest } from "./perfTest";

describe("parseDuration", () => {
  it("reads the unit the value names", () => {
    expect(parseDuration("500ms", "d")).toBe(500);
    expect(parseDuration("30s", "d")).toBe(30_000);
    expect(parseDuration("2m", "d")).toBe(120_000);
    expect(parseDuration("1.5s", "d")).toBe(1_500);
    expect(parseDuration("1h", "d")).toBe(3_600_000);
  });

  it("takes a number as the milliseconds it already is", () => {
    expect(parseDuration(250, "d")).toBe(250);
    expect(parseDuration(0, "d")).toBe(0);
  });

  it("refuses what it cannot read rather than guessing a unit", () => {
    expect(() => parseDuration("30", "duration")).toThrow(/duration/);
    expect(() => parseDuration("soon", "duration")).toThrow(/duration/);
    expect(() => parseDuration(-1, "duration")).toThrow(/duration/);
  });
});

describe("PerfPlan", () => {
  it("is a hundred iterations at one user when nothing is said", () => {
    const plan = new PerfPlan({});
    expect(plan.iterations).toBe(100);
    expect(plan.concurrency).toBe(1);
    expect(plan.durationMs).toBeUndefined();
  });

  it("refuses two ways of saying the same budget", () => {
    expect(() => new PerfPlan({ iterations: 10, duration: "5s" })).toThrow(/not both/);
  });

  it("refuses a ramp-down it has no room to start", () => {
    expect(() => new PerfPlan({ iterations: 100, rampDown: "5s" })).toThrow(/rampDown needs duration/);
  });

  it("refuses a shape longer than the test that holds it", () => {
    expect(() => new PerfPlan({ duration: "10s", rampUp: "8s", rampDown: "5s" })).toThrow(/longer than/);
  });

  it("refuses a concurrency that is not a count of users", () => {
    expect(() => new PerfPlan({ concurrency: 0 })).toThrow(/whole number/);
    expect(() => new PerfPlan({ concurrency: 2.5 })).toThrow(/whole number/);
  });

  it("reads a numeric warmup as iterations and a string as time", () => {
    expect(new PerfPlan({ warmup: 50 }).warmupIterations).toBe(50);
    expect(new PerfPlan({ warmup: 50 }).warmupMs).toBeUndefined();
    expect(new PerfPlan({ warmup: "5s" }).warmupMs).toBe(5_000);
    expect(new PerfPlan({ warmup: "5s" }).warmupIterations).toBeUndefined();
  });
});

describe("PerfPlan.vusAt", () => {
  it("primes at one user through the warm-up, whatever the test ramps to", () => {
    const plan = new PerfPlan({ duration: "40s", concurrency: 10, warmup: "4s", rampUp: "6s" });
    expect(plan.vusAt(0, 4_000)).toBe(1);
    expect(plan.vusAt(3_999, 4_000)).toBe(1);
  });

  it("climbs linearly to the plateau and holds there", () => {
    const plan = new PerfPlan({ duration: "40s", concurrency: 10, rampUp: "10s" });
    expect(plan.vusAt(0, 0)).toBe(1);
    expect(plan.vusAt(5_000, 0)).toBe(5);
    expect(plan.vusAt(9_000, 0)).toBe(9);
    expect(plan.vusAt(10_000, 0)).toBe(10);
    expect(plan.vusAt(25_000, 0)).toBe(10);
  });

  it("never rounds to nothing on the way up", () => {
    const plan = new PerfPlan({ duration: "40s", concurrency: 10, rampUp: "10s" });
    expect(plan.vusAt(1, 0)).toBe(1);
  });

  it("drains to nothing over the ramp-down", () => {
    const plan = new PerfPlan({ duration: "40s", concurrency: 10, rampDown: "10s" });
    expect(plan.vusAt(29_000, 0)).toBe(10);
    expect(plan.vusAt(30_000, 0)).toBe(10);
    expect(plan.vusAt(35_000, 0)).toBe(5);
    expect(plan.vusAt(40_000, 0)).toBe(0);
  });

  it("holds the plateau for a test with no ramps at all", () => {
    const plan = new PerfPlan({ iterations: 100, concurrency: 4 });
    expect(plan.vusAt(0, 0)).toBe(4);
    expect(plan.vusAt(99_000, 0)).toBe(4);
  });
});

describe("phaseAt", () => {
  it("walks warm-up, ramp-up, steady and ramp-down in order", () => {
    const plan = new PerfPlan({ duration: "40s", concurrency: 10, warmup: "4s", rampUp: "6s", rampDown: "8s" });
    expect(phaseAt(plan, 0, 4_000)).toBe("warm-up");
    expect(phaseAt(plan, 5_000, 4_000)).toBe("ramp-up");
    expect(phaseAt(plan, 20_000, 4_000)).toBe("steady");
    expect(phaseAt(plan, 35_000, 4_000)).toBe("ramp-down");
  });

  it("stays in the warm-up while its end is still unknown", () => {
    const plan = new PerfPlan({ iterations: 100, warmup: 50 });
    expect(phaseAt(plan, 10_000, undefined)).toBe("warm-up");
  });

  it("is steady the whole way for a test with no shape", () => {
    const plan = new PerfPlan({ iterations: 10 });
    expect(phaseAt(plan, 0, 0)).toBe("steady");
    expect(phaseAt(plan, 5_000, 0)).toBe("steady");
  });
});

describe("runPerfTest", () => {
  const schedules: PerfSchedule[] = [];
  const collect = (schedule: PerfSchedule) => schedules.push(schedule);

  it("runs the body exactly as many times as the budget says", async () => {
    let ran = 0;
    const outcome = await runPerfTest(() => void ran++, new PerfPlan({ iterations: 25 }), { onSchedule: collect });
    expect(ran).toBe(25);
    expect(outcome.iterations).toBe(25);
    expect(outcome.failedIterations).toBe(0);
  });

  it("hands the body its iteration and its virtual user", async () => {
    const seen: { iteration: number; vu: number }[] = [];
    await runPerfTest((context) => void seen.push(context), new PerfPlan({ iterations: 12, concurrency: 3 }), { onSchedule: collect });
    expect(seen).toHaveLength(12);
    expect([...new Set(seen.map((entry) => entry.iteration))]).toHaveLength(12);
    expect(Math.max(...seen.map((entry) => entry.vu))).toBeLessThan(3);
  });

  it("counts a thrown iteration and keeps going", async () => {
    let ran = 0;
    const outcome = await runPerfTest(
      () => {
        ran++;
        if (ran % 2 === 0) throw new Error("nope");
      },
      new PerfPlan({ iterations: 10 }),
      { onSchedule: collect },
    );
    expect(outcome.iterations).toBe(10);
    expect(outcome.failedIterations).toBe(5);
  });

  it("stamps the warm-up boundary at the iteration that ends it", async () => {
    const outcome = await runPerfTest(() => {}, new PerfPlan({ iterations: 20, warmup: 5 }), { onSchedule: collect });
    expect(outcome.schedule.warmupIterations).toBe(5);
    expect(outcome.schedule.warmupEndsAt).toBeDefined();
    expect(outcome.schedule.phases.map((phase) => phase.name)).toEqual(["warm-up", "steady"]);
  });

  it("closes every phase it opened and the schedule itself", async () => {
    const outcome = await runPerfTest(() => {}, new PerfPlan({ iterations: 8, warmup: 2 }), { onSchedule: collect });
    expect(outcome.schedule.endedAt).toBeDefined();
    expect(outcome.schedule.phases.every((phase) => phase.endedAt !== undefined)).toBe(true);
    for (const phase of outcome.schedule.phases) expect(phase.endedAt!).toBeGreaterThanOrEqual(phase.startedAt);
  });

  it("stops where it was told to, leaving the budget unspent", async () => {
    const controller = new AbortController();
    let ran = 0;
    const outcome = await runPerfTest(
      () => {
        ran++;
        if (ran === 4) controller.abort();
      },
      new PerfPlan({ iterations: 1_000 }),
      { onSchedule: collect, signal: controller.signal },
    );
    expect(outcome.iterations).toBeLessThan(1_000);
    expect(ran).toBeLessThan(20);
  });

  it("excludes nothing when it was stopped inside its own warm-up", async () => {
    const controller = new AbortController();
    let ran = 0;
    const outcome = await runPerfTest(
      () => {
        ran++;
        if (ran === 3) controller.abort();
      },
      new PerfPlan({ iterations: 1_000, warmup: 500 }),
      { onSchedule: collect, signal: controller.signal },
    );
    expect(outcome.schedule.warmupEndsAt).toBeUndefined();
    expect(outcome.schedule.warmupIterations).toBeUndefined();
  });

  it("reports the schedule as it goes, not only at the end", async () => {
    schedules.length = 0;
    await runPerfTest(() => {}, new PerfPlan({ iterations: 6, warmup: 2 }), { onSchedule: collect });
    expect(schedules.length).toBeGreaterThan(1);
    // Every report is a copy, so a caller holding an earlier one is not rewritten under.
    expect(schedules[0]).not.toBe(schedules[schedules.length - 1]);
  });

  it("ticks while it runs, which is what a live report is drawn on", async () => {
    let ticks = 0;
    await runPerfTest(() => new Promise((resolve) => setTimeout(resolve, 10)), new PerfPlan({ duration: 120, concurrency: 2 }), {
      onSchedule: collect,
      onTick: () => ticks++,
    });
    expect(ticks).toBeGreaterThan(1);
  });

  it("holds a duration budget open for its whole length", async () => {
    let ran = 0;
    const outcome = await runPerfTest(() => void ran++, new PerfPlan({ duration: 120, concurrency: 2 }), { onSchedule: collect });
    expect(ran).toBeGreaterThan(0);
    expect(outcome.schedule.durationMs).toBe(120);
    expect(outcome.schedule.endedAt! - outcome.schedule.startedAt).toBeGreaterThanOrEqual(110);
  });
});

describe("the warm-up boundary", () => {
  it("publishes a time warm-up's end before anything has run", async () => {
    const seen: (number | undefined)[] = [];
    const outcome = await runPerfTest(() => {}, new PerfPlan({ duration: 150, warmup: "50ms" }), {
      onSchedule: (schedule) => seen.push(schedule.warmupEndsAt),
    });
    // Known from the plan, so the exclusion is in force for the very first call
    // rather than stamped once the warm-up is over.
    expect(seen[0]).toBe(outcome.schedule.startedAt + 50);
    expect(outcome.schedule.warmupEndsAt).toBe(outcome.schedule.startedAt + 50);
  });

  it("cannot be given a warm-up longer than the test that holds it", () => {
    expect(() => new PerfPlan({ duration: "10s", warmup: "40s" })).toThrow(/longer than/);
  });

  it("excludes nothing when the test was stopped inside its time warm-up", async () => {
    const controller = new AbortController();
    const outcome = await runPerfTest(() => controller.abort(), new PerfPlan({ duration: "20s", warmup: "10s" }), {
      onSchedule: () => {},
      signal: controller.signal,
    });
    expect(outcome.schedule.warmupEndsAt).toBeUndefined();
  });
});

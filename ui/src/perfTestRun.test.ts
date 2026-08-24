import { describe, expect, it } from "bun:test";
import { Block, PerfBlock } from "./blocks";
import { Kaja } from "./kaja";
import { PerfSchedule } from "./perfTest";

// A Kaja whose canvas is a map and whose schedule reports are collected, so what a
// perf test draws and what it tells the console can both be read back.
function testing() {
  const blocks = new Map<string, Block>();
  // Every draw rather than the last, which is what says whether the card moved while
  // the test was running.
  const draws: PerfBlock[] = [];
  const schedules: PerfSchedule[] = [];
  const kaja = new Kaja({
    onMethodCallUpdate: () => {},
    onAsk: () => Promise.resolve("an answer"),
    onApprove: () => Promise.resolve("approved" as const),
    onBlockUpdate: (blockId, block) => {
      blocks.set(blockId, block);
      if (block.kind === "perf") draws.push(block);
    },
    onLog: () => {},
    onPerfSchedule: (schedule) => schedules.push(schedule),
  });
  const perfBlocks = (): PerfBlock[] => [...blocks.values()].filter((block): block is PerfBlock => block.kind === "perf");
  return { kaja, blocks, draws, schedules, perfBlocks };
}

describe("kaja.perfTest", () => {
  it("runs the body and reports what it did", async () => {
    const { kaja } = testing();
    let ran = 0;
    const report = await kaja.perfTest(() => void ran++, { iterations: 20 });
    expect(ran).toBe(20);
    expect(report.iterations).toBe(20);
    expect(report.failedIterations).toBe(0);
    // No calls were made, so there is nothing to have percentiles of.
    expect(report.requests).toBe(0);
    expect(report.latency.p95).toBeUndefined();
  });

  it("draws one block, and it is the same one from start to finish", async () => {
    const { kaja, perfBlocks, blocks } = testing();
    await kaja.perfTest(() => {}, { iterations: 5 });
    expect(perfBlocks()).toHaveLength(1);
    expect(blocks.size).toBe(1);
    expect(perfBlocks()[0].running).toBeUndefined();
    expect(perfBlocks()[0].schedule).toBe("5 iter · 1 vu");
  });

  it("redraws the block as the test runs rather than only when it is over", async () => {
    const { kaja, draws } = testing();
    await kaja.perfTest(() => new Promise((resolve) => setTimeout(resolve, 10)), { duration: "600ms", concurrency: 2 });
    const live = draws.slice(1, -1);
    expect(live.length).toBeGreaterThan(1);
    expect(live.every((block) => block.running === true)).toBe(true);
    expect(draws[draws.length - 1].running).toBeUndefined();
    // The card counts the test's own clock while it runs, so the header moves even
    // before a call has landed.
    expect(live[live.length - 1].durationMs!).toBeGreaterThan(live[0].durationMs!);
  });

  it("says what the schedule was in the words it was written in", async () => {
    const { kaja, perfBlocks } = testing();
    await kaja.perfTest(() => {}, { duration: "60ms", concurrency: 4 });
    expect(perfBlocks()[0].schedule).toBe("0.1s · 4 vu");
  });

  it("reports its phases to the console as it goes", async () => {
    const { kaja, schedules } = testing();
    await kaja.perfTest(() => {}, { iterations: 6, warmup: 2 });
    expect(schedules.length).toBeGreaterThan(0);
    const last = schedules[schedules.length - 1];
    expect(last.phases.map((phase) => phase.name)).toEqual(["warm-up", "steady"]);
    expect(last.endedAt).toBeDefined();
  });

  it("counts a thrown iteration without stopping the test", async () => {
    const { kaja } = testing();
    let ran = 0;
    const report = await kaja.perfTest(
      () => {
        if (++ran % 3 === 0) throw new Error("nope");
      },
      { iterations: 9 },
    );
    expect(report.iterations).toBe(9);
    expect(report.failedIterations).toBe(3);
  });

  it("refuses a question inside the body rather than parking every user on it", async () => {
    const { kaja } = testing();
    let refused: unknown;
    await kaja.perfTest(
      async () => {
        try {
          await kaja.askStr("How many?");
        } catch (error) {
          refused = error;
        }
      },
      { iterations: 1 },
    );
    expect(String(refused)).toMatch(/kaja\.ask\*/);
    expect(String(refused)).toMatch(/kaja\.input/);
  });

  it("refuses a held call inside the body for the same reason", async () => {
    const { kaja } = testing();
    let refused: unknown;
    await kaja.perfTest(
      async () => {
        try {
          await kaja.approve({ label: "Shows.CreateShow", input: {}, started: false, claim: () => {}, start: () => Promise.resolve("sent") } as never);
        } catch (error) {
          refused = error;
        }
      },
      { iterations: 1 },
    );
    expect(String(refused)).toMatch(/kaja\.approve/);
  });

  it("lets a question through once the test is over", async () => {
    const { kaja } = testing();
    await kaja.perfTest(() => {}, { iterations: 1 });
    expect(await kaja.askStr("How many?")).toBe("an answer");
  });

  it("refuses a perf test inside a perf test", async () => {
    const { kaja } = testing();
    let refused: unknown;
    await kaja.perfTest(
      async () => {
        try {
          await kaja.perfTest(() => {}, { iterations: 1 });
        } catch (error) {
          refused = error;
        }
      },
      { iterations: 1 },
    );
    expect(String(refused)).toMatch(/inside another one/);
  });

  it("lets the plan's own complaints reach the script", async () => {
    const { kaja } = testing();
    await expect(kaja.perfTest(() => {}, { iterations: 10, duration: "5s" })).rejects.toThrow(/not both/);
  });
});

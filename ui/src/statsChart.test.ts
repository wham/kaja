import { describe, expect, it } from "bun:test";
import { StatsSlot } from "./runStats";
import {
  bandPoints,
  barsFor,
  CHART_WIDTH,
  failurePositions,
  formatErrorRate,
  formatMs,
  formatRps,
  linePoints,
  niceCeiling,
  slotsFor,
  stepPoints,
  timeTicks,
} from "./statsChart";

function slot(changes: Partial<StatsSlot> = {}): StatsSlot {
  return { calls: 1, failures: 0, offsetMs: 0, widthMs: 100, rps: 10, inFlight: 1, ...changes };
}

function pairs(points: string): [number, number][] {
  return points.split(" ").map((point) => point.split(",").map(Number) as [number, number]);
}

describe("niceCeiling", () => {
  it("rounds up to a number a reader recognises", () => {
    expect(niceCeiling(0.9)).toBe(1);
    expect(niceCeiling(38)).toBe(40);
    expect(niceCeiling(124)).toBe(150);
    expect(niceCeiling(311)).toBe(400);
    expect(niceCeiling(1_204)).toBe(1_500);
  });

  it("never hands back a zero to divide by", () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(-4)).toBe(1);
  });
});

describe("linePoints", () => {
  it("spans the chart and puts the ceiling at the top", () => {
    const slots = [slot({ p50: 0 }), slot({ p50: 50 }), slot({ p50: 100 })];
    const points = pairs(linePoints(slots, (each) => each.p50, 100, 100));
    expect(points[0]).toEqual([0, 100]);
    expect(points[2]).toEqual([CHART_WIDTH, 0]);
    expect(points[1]).toEqual([CHART_WIDTH / 2, 50]);
  });

  it("leaves out a slice nothing has settled in rather than drawing it at zero", () => {
    const slots = [slot({ p50: 40 }), slot({ p50: undefined }), slot({ p50: 60 })];
    expect(pairs(linePoints(slots, (each) => each.p50, 100, 100))).toHaveLength(2);
  });

  it("clamps a value past the ceiling to the top of the box", () => {
    const points = pairs(linePoints([slot({ p50: 500 }), slot({ p50: 500 })], (each) => each.p50, 100, 100));
    expect(points.every(([, at]) => at === 0)).toBe(true);
  });
});

describe("bandPoints", () => {
  it("runs out along the lower series and back along the upper", () => {
    const slots = [slot({ p50: 20, p95: 80 }), slot({ p50: 40, p95: 60 })];
    const points = pairs(
      bandPoints(
        slots,
        (each) => each.p50,
        (each) => each.p95,
        100,
        100,
      ),
    );
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual([0, 80]);
    expect(points[1]).toEqual([CHART_WIDTH, 60]);
    expect(points[2]).toEqual([CHART_WIDTH, 40]);
    expect(points[3]).toEqual([0, 20]);
  });

  it("draws nothing where there is not a second point to close against", () => {
    expect(
      bandPoints(
        [slot({ p50: 20, p95: 80 })],
        (each) => each.p50,
        (each) => each.p95,
        100,
        100,
      ),
    ).toBe("");
    expect(
      bandPoints(
        [slot({ p50: 20 }), slot({ p50: 40 })],
        (each) => each.p50,
        (each) => each.p95,
        100,
        100,
      ),
    ).toBe("");
  });
});

describe("stepPoints", () => {
  it("holds a level until something changes it", () => {
    const points = pairs(stepPoints([slot({ inFlight: 2 }), slot({ inFlight: 6 })], 10, 100));
    expect(points).toEqual([
      [0, 80],
      [CHART_WIDTH, 80],
      [CHART_WIDTH, 40],
    ]);
  });
});

describe("failurePositions", () => {
  it("marks only the slices that failed, where they fall on the clock", () => {
    const marks = failurePositions([slot(), slot({ failures: 2 }), slot(), slot({ failures: 1 })]);
    expect(marks).toEqual([
      { position: 1 / 3, failures: 2 },
      { position: 1, failures: 1 },
    ]);
  });
});

describe("timeTicks", () => {
  it("ends on the run's own length rather than a round number past it", () => {
    const ticks = timeTicks(41_600);
    expect(ticks[0].label).toBe("0 s");
    expect(ticks[ticks.length - 1]).toEqual({ label: "41.6 s", position: 1 });
    expect(ticks.length).toBeLessThanOrEqual(6);
  });

  it("keeps its steps round and inside the run", () => {
    const ticks = timeTicks(18_200);
    expect(ticks.map((tick) => tick.label)).toEqual(["0 s", "5 s", "10 s", "15 s", "18.2 s"]);
    expect(ticks.every((tick) => tick.position >= 0 && tick.position <= 1)).toBe(true);
  });

  it("scales down to a run that took a moment", () => {
    expect(timeTicks(400).map((tick) => tick.label)).toEqual(["0 s", "0.1 s", "0.2 s", "0.3 s", "0.4 s"]);
  });

  it("has no axis to draw for a run with no length", () => {
    expect(timeTicks(0)).toEqual([]);
  });
});

describe("formatting", () => {
  it("states a latency in the unit that fits it", () => {
    expect(formatMs(41)).toBe("41 ms");
    expect(formatMs(41.4)).toBe("41 ms");
    expect(formatMs(1_204)).toBe("1.20 s");
    expect(formatMs(41_600)).toBe("41.6 s");
    expect(formatMs(undefined)).toBe("—");
  });

  it("keeps a throughput readable at both ends", () => {
    expect(formatRps(0)).toBe("0");
    expect(formatRps(2.64)).toBe("2.6");
    expect(formatRps(240.4)).toBe("240");
    expect(formatRps(1_204)).toBe("1,204");
  });

  it("never rounds a run that failed down to zero", () => {
    expect(formatErrorRate(0, 0)).toBe("0%");
    expect(formatErrorRate(0.004, 40)).toBe("0.4%");
    expect(formatErrorRate(0.00002, 1)).toBe("<0.1%");
    expect(formatErrorRate(0.5, 5)).toBe("50%");
  });
});

describe("slotsFor and barsFor", () => {
  it("give a narrow console fewer slices rather than thinner ones", () => {
    expect(slotsFor(300)).toBeLessThan(slotsFor(900));
    expect(barsFor(300)).toBeLessThan(barsFor(900));
  });

  it("stay inside their bounds however much or little room there is", () => {
    expect(slotsFor(40)).toBe(8);
    expect(slotsFor(4_000)).toBe(80);
    expect(barsFor(4_000)).toBe(28);
    expect(slotsFor(0)).toBe(0);
    expect(barsFor(0)).toBe(0);
  });
});

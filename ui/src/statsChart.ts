import { StatsSlot } from "./runStats";

/**
 * The arithmetic behind the Stats charts. Every one of them is a linear scale into a
 * fixed box — there is no axis to negotiate and no curve to fit — so the drawing is
 * plain SVG in the view and the numbers are here, where they can be tested.
 */

// The charts are drawn in these units and stretched to whatever width the console
// has (`preserveAspectRatio="none"`), so a resize costs no re-render.
export const CHART_WIDTH = 600;

/** The y axis, rounded up to a number a reader recognises. */
export function niceCeiling(max: number): number {
  if (!(max > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (max <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

function x(index: number, count: number): number {
  return count <= 1 ? 0 : (index / (count - 1)) * CHART_WIDTH;
}

function y(value: number, ceiling: number, height: number): number {
  return height - Math.min(1, Math.max(0, value / ceiling)) * height;
}

type Series = (slot: StatsSlot) => number | undefined;

/**
 * A polyline through one series, skipping the slices that have nothing to say. A
 * slice where no call has settled yet is a gap in the measurement, and joining across
 * it would draw a value nothing measured.
 */
export function linePoints(slots: StatsSlot[], series: Series, ceiling: number, height: number): string {
  const points: string[] = [];
  slots.forEach((slot, index) => {
    const value = series(slot);
    if (value === undefined) return;
    points.push(`${x(index, slots.length).toFixed(1)},${y(value, ceiling, height).toFixed(1)}`);
  });
  return points.join(" ");
}

/**
 * The polygon between two series: forward along the lower one, back along the upper.
 * Only the slices where both are known are in it, so the band ends where the
 * measurement does rather than collapsing to the floor.
 */
export function bandPoints(slots: StatsSlot[], lower: Series, upper: Series, ceiling: number, height: number): string {
  const forward: string[] = [];
  const backward: string[] = [];
  slots.forEach((slot, index) => {
    const low = lower(slot);
    const high = upper(slot);
    if (low === undefined || high === undefined) return;
    const at = x(index, slots.length).toFixed(1);
    forward.push(`${at},${y(low, ceiling, height).toFixed(1)}`);
    backward.unshift(`${at},${y(high, ceiling, height).toFixed(1)}`);
  });
  return forward.length < 2 ? "" : [...forward, ...backward].join(" ");
}

/**
 * The concurrency line, drawn as a step: the number of calls in the air holds until
 * something changes it, and a slope between two slices would claim it drifted.
 */
export function stepPoints(slots: StatsSlot[], ceiling: number, height: number): string {
  const points: string[] = [];
  let previous: number | undefined;
  slots.forEach((slot, index) => {
    const at = x(index, slots.length).toFixed(1);
    const level = y(slot.inFlight, ceiling, height);
    if (previous !== undefined) points.push(`${at},${previous.toFixed(1)}`);
    points.push(`${at},${level.toFixed(1)}`);
    previous = level;
  });
  return points.join(" ");
}

/** Where a failure sits along the run's clock, 0 to 1 — the marks on the chart floor. */
export function failurePositions(slots: StatsSlot[]): { position: number; failures: number }[] {
  return slots
    .map((slot, index) => ({ position: slots.length <= 1 ? 0 : index / (slots.length - 1), failures: slot.failures }))
    .filter((mark) => mark.failures > 0);
}

const TICK_STEPS_MS = [100, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000];

/**
 * The labels under the timeline. Round steps up to the run's own length, which is
 * stated exactly — a run is 41.6 s and rounding that to 40 makes the axis disagree
 * with the tile above it.
 */
export function timeTicks(spanMs: number): { label: string; position: number }[] {
  if (!(spanMs > 0)) return [];
  const step = TICK_STEPS_MS.find((candidate) => spanMs / candidate <= 5) ?? TICK_STEPS_MS[TICK_STEPS_MS.length - 1];
  const ticks: { label: string; position: number }[] = [];
  for (let at = 0; at < spanMs; at += step) {
    // The last round tick is dropped when the run's own length would land on top of it.
    if ((spanMs - at) / spanMs < 0.08) break;
    ticks.push({ label: formatSeconds(at), position: at / spanMs });
  }
  ticks.push({ label: formatSeconds(spanMs), position: 1 });
  return ticks;
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  if (seconds === 0) return "0 s";
  if (seconds < 1) return `${seconds.toFixed(1)} s`;
  if (seconds < 100) return `${Number(seconds.toFixed(1))} s`;
  return `${Math.round(seconds)} s`;
}

/** A latency, as the tiles and table state it: whole milliseconds, seconds past a second. */
export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms).toLocaleString()} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** The same value in a column that already says what it is, so without the unit. */
export function formatMsBare(ms: number | undefined): string {
  return ms === undefined ? "—" : Math.round(ms).toLocaleString();
}

export function formatRps(rps: number): string {
  if (rps === 0) return "0";
  if (rps < 10) return rps.toFixed(1);
  return Math.round(rps).toLocaleString();
}

/**
 * An error rate reads as zero only when nothing failed. Anything that did failed, and
 * `0.0%` over four thousand calls with forty failures in them is the one thing this
 * number must never say.
 */
export function formatErrorRate(rate: number, failures: number): string {
  if (failures === 0) return "0%";
  const percent = rate * 100;
  if (percent < 0.1) return "<0.1%";
  return `${Number(percent.toFixed(percent < 10 ? 1 : 0))}%`;
}

/**
 * How many slices the timeline is drawn in, from the room it has. All three charts
 * take the same count — one axis is the whole point of stacking them, so a slice has
 * to mean the same thing in each.
 */
export function slotsFor(width: number): number {
  if (width <= 0) return 0;
  return Math.min(80, Math.max(8, Math.floor(width / 14)));
}

/** The same question for the distribution, which is read across rather than along. */
export function barsFor(width: number): number {
  if (width <= 0) return 0;
  return Math.min(28, Math.max(6, Math.floor(width / 26)));
}

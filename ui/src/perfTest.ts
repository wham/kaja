import type { RunStats } from "./runStats";

/**
 * A run shaped for the Stats view: a body run over and over on a schedule, with
 * controlled concurrency and a warm-up that is measured but left out of the headline.
 *
 * The schedule is pure and the runner is thin over it. What the runner adds is a
 * budget, a set of virtual users it grows and drains, and the phase boundaries it
 * stamps as it crosses them — which is the only thing the perf half tells the stats
 * half about itself.
 */

/** Milliseconds as a number, or `"30s"` / `"2m"` / `"500ms"` as a string. */
export type Duration = number | string;

export type PerfPhaseName = "warm-up" | "ramp-up" | "steady" | "ramp-down";

export interface PerfTestOptions {
  // One of these two is the budget. Iterations counts runs of the body; duration is
  // the whole test, ramps and warm-up included.
  iterations?: number;
  duration?: Duration;
  // Virtual users at the plateau. Each runs the body in a loop.
  concurrency?: number;
  // A number is iterations, a string is time — the unit a warm-up is naturally said
  // in depends on which one you are trying to prime.
  warmup?: number | Duration;
  rampUp?: Duration;
  rampDown?: Duration;
}

export interface PerfContext {
  // Zero-based and unique across the test, so a body can vary its request data.
  iteration: number;
  vu: number;
}

export type PerfBody = (context: PerfContext) => unknown;

/**
 * A stretch of the test, in epoch milliseconds. Absolute rather than relative because
 * the stats draw them against the run's clock, which started before the test did.
 */
export interface PerfPhase {
  name: PerfPhaseName;
  startedAt: number;
  // Absent while the phase is the one being run.
  endedAt?: number;
}

/** What the perf half tells the stats half. Stored with the run, so a stale one still draws its bands. */
export interface PerfSchedule {
  concurrency: number;
  iterations?: number;
  durationMs?: number;
  startedAt: number;
  phases: PerfPhase[];
  // Calls issued before this are warm-up: counted everywhere, left out of the
  // percentiles. Absent until the warm-up is over.
  warmupEndsAt?: number;
  // How many iterations the warm-up covered, which is what the tile strip states.
  warmupIterations?: number;
  endedAt?: number;
}

const DURATION_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)\s*$/;
const UNIT_MS: { [unit: string]: number } = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

/**
 * A duration in milliseconds. A number is already that; a string names its own unit.
 * `verb` is who is asking, so the error names the call the author wrote.
 */
export function parseDuration(value: Duration, field: string, verb = "kaja.perfTest"): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${verb}: ${field} must be a duration, got ${value}.`);
    return value;
  }
  const match = DURATION_PATTERN.exec(value);
  if (!match) throw new Error(`${verb}: ${field} must be a duration like "30s", "2m" or "500ms", got ${JSON.stringify(value)}.`);
  return Number(match[1]) * UNIT_MS[match[2]];
}

/**
 * The shape of the test before it is run: what concurrency to hold at each moment,
 * and the phases that shape describes. A plan is made once and never adjusts to what
 * the run turns out to do — a schedule that chased the observed rate would report the
 * server's behaviour as if it were the test's.
 */
export class PerfPlan {
  readonly concurrency: number;
  readonly iterations?: number;
  readonly durationMs?: number;
  readonly warmupMs?: number;
  readonly warmupIterations?: number;
  readonly rampUpMs: number;
  readonly rampDownMs: number;

  constructor(options: PerfTestOptions) {
    const concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`kaja.perfTest: concurrency must be a whole number of virtual users, got ${options.concurrency}.`);
    }
    if (options.iterations !== undefined && options.duration !== undefined) {
      throw new Error("kaja.perfTest: give iterations or duration, not both. They are two ways to say the same budget.");
    }
    if (options.iterations !== undefined && (!Number.isInteger(options.iterations) || options.iterations < 1)) {
      throw new Error(`kaja.perfTest: iterations must be a whole number above zero, got ${options.iterations}.`);
    }

    this.concurrency = concurrency;
    this.iterations = options.duration === undefined ? (options.iterations ?? DEFAULT_ITERATIONS) : undefined;
    this.durationMs = options.duration === undefined ? undefined : parseDuration(options.duration, "duration");
    this.rampUpMs = options.rampUp === undefined ? 0 : parseDuration(options.rampUp, "rampUp");
    this.rampDownMs = options.rampDown === undefined ? 0 : parseDuration(options.rampDown, "rampDown");

    if (typeof options.warmup === "number") {
      if (!Number.isInteger(options.warmup) || options.warmup < 0) {
        throw new Error(`kaja.perfTest: a numeric warmup is a count of iterations, got ${options.warmup}.`);
      }
      this.warmupIterations = options.warmup;
    } else if (options.warmup !== undefined) {
      this.warmupMs = parseDuration(options.warmup, "warmup");
    }

    // Draining takes time the test has to have. With a budget in iterations there is
    // no moment to start draining from — the last iteration is the end.
    if (this.rampDownMs > 0 && this.durationMs === undefined) {
      throw new Error("kaja.perfTest: rampDown needs duration. With iterations the test ends when the last one does, which is nothing to ramp down from.");
    }
    const shaped = (this.warmupMs ?? 0) + this.rampUpMs + this.rampDownMs;
    if (this.durationMs !== undefined && shaped > this.durationMs) {
      throw new Error(`kaja.perfTest: warmup, rampUp and rampDown come to ${shaped} ms, which is longer than the ${this.durationMs} ms the test has.`);
    }
  }

  get warmupEndsMs(): number | undefined {
    return this.warmupMs;
  }

  // Where ramp-up gives way to the plateau. Only meaningful once the warm-up's own end
  // is known, which for an iteration warm-up is not until it happens.
  rampUpEndsMs(warmupEndedMs: number): number {
    return warmupEndedMs + this.rampUpMs;
  }

  get rampDownStartsMs(): number | undefined {
    return this.durationMs === undefined ? undefined : this.durationMs - this.rampDownMs;
  }

  /**
   * How many virtual users should be running at this point. Never below one before the
   * drain: a schedule that rounds to zero in the middle is a test that stops.
   */
  vusAt(elapsedMs: number, warmupEndedMs: number | undefined): number {
    // Priming, not loading — one user, so the first call meets a cold server alone.
    if (warmupEndedMs === undefined || elapsedMs < warmupEndedMs) return 1;

    const drainStart = this.rampDownStartsMs;
    if (drainStart !== undefined && elapsedMs >= drainStart) {
      if (this.rampDownMs <= 0) return 0;
      const left = 1 - (elapsedMs - drainStart) / this.rampDownMs;
      return Math.max(0, Math.round(this.concurrency * left));
    }

    const rampEnd = this.rampUpEndsMs(warmupEndedMs);
    if (this.rampUpMs > 0 && elapsedMs < rampEnd) {
      const through = (elapsedMs - warmupEndedMs) / this.rampUpMs;
      return Math.max(1, Math.round(this.concurrency * through));
    }
    return this.concurrency;
  }
}

// A quick check with no options at all still has to be a test rather than one call.
export const DEFAULT_ITERATIONS = 100;

// How often the supervisor re-reads the schedule. Fine enough that a ten-second ramp
// moves in ~400 steps, coarse enough to cost nothing beside the calls themselves.
const TICK_MS = 25;

export interface PerfRunnerOptions {
  signal?: AbortSignal;
  // Called whenever the schedule changes, so the bands grow as the test runs.
  onSchedule: (schedule: PerfSchedule) => void;
  // Called on every tick of the supervisor, so what has been measured so far can be
  // drawn. The supervisor's clock rather than a timer of the caller's: it runs for
  // exactly as long as the test does, and stops with it.
  onTick?: () => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PerfOutcome {
  schedule: PerfSchedule;
  iterations: number;
  // An iteration whose body threw. A failed call does not throw, so this is the
  // script's own reckoning rather than the transport's.
  failedIterations: number;
}

/**
 * Which stretch of the test this moment is in. The runner watches this rather than
 * computing boundaries in advance: an iteration warm-up has no end until it has one.
 */
export function phaseAt(plan: PerfPlan, elapsedMs: number, warmupEndedMs: number | undefined): PerfPhaseName {
  if (warmupEndedMs === undefined || elapsedMs < warmupEndedMs) return "warm-up";
  const drainStart = plan.rampDownStartsMs;
  if (drainStart !== undefined && plan.rampDownMs > 0 && elapsedMs >= drainStart) return "ramp-down";
  if (plan.rampUpMs > 0 && elapsedMs < plan.rampUpEndsMs(warmupEndedMs)) return "ramp-up";
  return "steady";
}

export async function runPerfTest(body: PerfBody, plan: PerfPlan, options: PerfRunnerOptions): Promise<PerfOutcome> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const signal = options.signal;

  const startedAt = now();
  const elapsed = () => now() - startedAt;
  const schedule: PerfSchedule = {
    concurrency: plan.concurrency,
    iterations: plan.iterations,
    durationMs: plan.durationMs,
    startedAt,
    phases: [],
  };

  // A test with no warm-up is past it before it begins, which is what lets one rule
  // cover both.
  let warmupEndedMs: number | undefined = plan.warmupIterations !== undefined ? undefined : (plan.warmupMs ?? 0);
  // A warm-up said in time knows its own end before the test starts, so the exclusion
  // is in force from the first call rather than stamped once it is over.
  if (plan.warmupMs !== undefined && plan.warmupMs > 0) schedule.warmupEndsAt = startedAt + plan.warmupMs;
  let taken = 0;
  let failedIterations = 0;
  const workers = new Map<number, Promise<void>>();

  const publish = () => options.onSchedule({ ...schedule, phases: schedule.phases.map((phase) => ({ ...phase })) });

  const enterPhase = (name: PerfPhaseName, at: number) => {
    const open = schedule.phases[schedule.phases.length - 1];
    if (open?.name === name) return;
    if (open !== undefined) open.endedAt = at;
    schedule.phases.push({ name, startedAt: at });
    publish();
  };

  const stampWarmupEnd = () => {
    warmupEndedMs = elapsed();
    schedule.warmupEndsAt = startedAt + warmupEndedMs;
    schedule.warmupIterations = taken;
    publish();
  };

  const budgetLeft = (): boolean => {
    if (signal?.aborted) return false;
    return plan.iterations !== undefined ? taken < plan.iterations : elapsed() < plan.durationMs!;
  };

  const target = () => plan.vusAt(elapsed(), warmupEndedMs);

  const worker = async (slot: number): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      // Stamped before the iteration that ends the warm-up is taken, and the warm-up
      // runs at one virtual user, so no call issued after the boundary started before
      // it.
      if (plan.warmupIterations !== undefined && warmupEndedMs === undefined && taken >= plan.warmupIterations) stampWarmupEnd();
      if (slot >= target() || !budgetLeft()) return;
      const iteration = taken++;
      try {
        await body({ iteration, vu: slot });
      } catch (error) {
        if (signal?.aborted) return;
        // A failed iteration is data, not a reason to stop: running to the end is half
        // of what a perf test is for.
        failedIterations++;
      }
    }
  };

  if (plan.warmupIterations !== undefined && plan.warmupIterations > 0) enterPhase("warm-up", startedAt);
  else if (plan.warmupMs !== undefined && plan.warmupMs > 0) enterPhase("warm-up", startedAt);
  else enterPhase(phaseAt(plan, 0, warmupEndedMs), startedAt);

  for (;;) {
    if (plan.warmupIterations !== undefined && warmupEndedMs === undefined && taken >= plan.warmupIterations) stampWarmupEnd();
    enterPhase(phaseAt(plan, elapsed(), warmupEndedMs), now());

    if (budgetLeft()) {
      const want = target();
      for (let slot = 0; slot < want; slot++) {
        if (workers.has(slot)) continue;
        const running = worker(slot).finally(() => workers.delete(slot));
        workers.set(slot, running);
      }
    } else if (workers.size === 0) {
      break;
    }
    if (signal?.aborted) break;
    options.onTick?.();
    await sleep(TICK_MS);
  }

  await Promise.all([...workers.values()]);
  const endedAt = now();
  const open = schedule.phases[schedule.phases.length - 1];
  if (open !== undefined) open.endedAt = endedAt;
  schedule.endedAt = endedAt;
  // A test stopped in its warm-up measured nothing, so nothing is excluded — the
  // alternative is a page that reports a run of no calls at all.
  if (warmupEndedMs === undefined || (schedule.warmupEndsAt !== undefined && endedAt <= schedule.warmupEndsAt)) {
    schedule.warmupEndsAt = undefined;
    schedule.warmupIterations = undefined;
  }
  publish();

  return { schedule, iterations: taken, failedIterations };
}

/** What a perf test hands back, so a script can assert its own threshold. */
export interface PerfReport {
  iterations: number;
  // An iteration whose body threw. Distinct from a failed call, which does not throw.
  failedIterations: number;
  requests: number;
  failures: number;
  errorRate: number;
  durationMs: number;
  rps: number;
  // Of the calls that succeeded outside the warm-up — the same sample set the Stats
  // page describes, so the two can never disagree.
  latency: { min?: number; p50?: number; p90?: number; p95?: number; p99?: number; max?: number; mean?: number };
  methods: { method: string; calls: number; failures: number; p50?: number; p95?: number; p99?: number; max?: number; rps: number }[];
}

/** The header note: what the schedule was, in the words it was written in. */
export function describeSchedule(plan: PerfPlan): string {
  const budget = plan.iterations !== undefined ? `${plan.iterations.toLocaleString()} iter` : formatSeconds(plan.durationMs ?? 0);
  return `${budget} · ${plan.concurrency} vu`;
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 100 ? `${Number(seconds.toFixed(1))}s` : `${Math.round(seconds)}s`;
}

export function perfReport(iterations: number, failedIterations: number, stats: RunStats): PerfReport {
  return {
    iterations,
    failedIterations,
    requests: stats.calls,
    failures: stats.failures,
    errorRate: stats.errorRate,
    durationMs: stats.spanMs,
    rps: stats.meanRps,
    latency: { min: stats.min, p50: stats.p50, p90: stats.p90, p95: stats.p95, p99: stats.p99, max: stats.max, mean: stats.mean },
    methods: stats.methods.map((row) => ({
      method: row.method,
      calls: row.calls,
      failures: row.failures,
      p50: row.p50,
      p95: row.p95,
      p99: row.p99,
      max: row.max,
      rps: row.rps,
    })),
  };
}

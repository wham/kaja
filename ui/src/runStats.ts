import { callDurationMs, callLabel } from "./kaja";
import { ConsoleItem } from "./runs";

/**
 * What a run's calls add up to: percentiles, throughput and concurrency over the
 * run's own clock, plus a breakdown per method.
 *
 * Everything here is computed from what a call already records — when it was issued,
 * how long it took, whether it failed — and maintained as the run happens, the same
 * way the strip is. A perf test run of twenty thousand calls is re-derived per repaint
 * otherwise, which is the one thing this console refuses to do.
 */

// Where a bucket starts before the run has a length to size itself against. It
// doubles from here, so boundaries stay aligned as the run outgrows them.
const START_BUCKET_MS = 50;
// Kept at twice what any chart draws, so `view` has something to merge down from and
// a narrow console does not cost the wide one its resolution.
const MAX_TIME_BUCKETS = 240;
/**
 * Below this many samples the values themselves are kept and the percentiles are
 * exact. A script making a dozen calls deserves to read its own numbers back, and
 * `p50 41 ms` from a histogram would be `p50 42 ms` for no reason anyone can see.
 */
const EXACT_LIMIT = 256;
// Fewer than this and the timeline is a handful of marks either way, so the floor
// costs nothing and keeps a short run's charts the same shape as a long one's.
const MIN_SLOTS = 8;
// Closer than this across the distribution's axis and two labels overlap.
const MARKER_GAP = 0.03;

// Eight buckets per octave: 4.4% at worst between a sample and the value reported for
// it, which is finer than the pixel it is drawn in.
const BUCKETS_PER_OCTAVE = 8;
// The floor, so that log2 of a sub-millisecond call is still an index.
const MIN_MS = 0.25;
const INDEX_OFFSET = 2 * BUCKETS_PER_OCTAVE;

/** The histogram bucket a duration falls in. Log-spaced, so the tail costs nothing. */
export function latencyBucket(ms: number): number {
  const value = ms > MIN_MS ? ms : MIN_MS;
  return Math.max(0, Math.floor(Math.log2(value) * BUCKETS_PER_OCTAVE) + INDEX_OFFSET);
}

/** The lower bound of a bucket — what the axis is labelled with. */
export function latencyBucketFloor(bucket: number): number {
  return 2 ** ((bucket - INDEX_OFFSET) / BUCKETS_PER_OCTAVE);
}

// The geometric middle of a bucket, which is the honest single value to report for
// everything that landed in it.
function latencyBucketValue(bucket: number): number {
  return latencyBucketFloor(bucket) * 2 ** (0.5 / BUCKETS_PER_OCTAVE);
}

/**
 * A set of durations, summarised. The log-scale counts are always kept — they are
 * what the distribution chart draws — and the values themselves as well while there
 * are few enough for that to be free.
 */
export class Latencies {
  readonly counts = new Map<number, number>();
  #exact: number[] | null = [];
  #sorted: number[] | null = null;
  #total = 0;
  #sum = 0;
  #min = Infinity;
  #max = 0;

  add(ms: number): void {
    const bucket = latencyBucket(ms);
    this.counts.set(bucket, (this.counts.get(bucket) ?? 0) + 1);
    this.#total++;
    this.#sum += ms;
    if (ms < this.#min) this.#min = ms;
    if (ms > this.#max) this.#max = ms;
    if (this.#exact !== null) {
      if (this.#exact.length >= EXACT_LIMIT) this.#exact = null;
      else this.#exact.push(ms);
    }
    this.#sorted = null;
  }

  merge(other: Latencies): void {
    for (const [bucket, count] of other.counts) this.counts.set(bucket, (this.counts.get(bucket) ?? 0) + count);
    this.#total += other.#total;
    this.#sum += other.#sum;
    if (other.#min < this.#min) this.#min = other.#min;
    if (other.#max > this.#max) this.#max = other.#max;
    const exact = other.#exact;
    if (this.#exact === null || exact === null || this.#exact.length + exact.length > EXACT_LIMIT) this.#exact = null;
    else this.#exact.push(...exact);
    this.#sorted = null;
  }

  get total(): number {
    return this.#total;
  }

  get max(): number | undefined {
    return this.#total === 0 ? undefined : this.#max;
  }

  get min(): number | undefined {
    return this.#total === 0 ? undefined : this.#min;
  }

  get mean(): number | undefined {
    return this.#total === 0 ? undefined : this.#sum / this.#total;
  }

  /** Nearest-rank, so every value reported is one a call actually took. */
  percentile(quantile: number): number | undefined {
    if (this.#total === 0) return undefined;
    const rank = Math.min(this.#total, Math.max(1, Math.ceil(quantile * this.#total)));
    if (this.#exact !== null) {
      if (this.#sorted === null) this.#sorted = [...this.#exact].sort((a, b) => a - b);
      return this.#sorted[rank - 1];
    }
    let seen = 0;
    for (const bucket of [...this.counts.keys()].sort((a, b) => a - b)) {
      seen += this.counts.get(bucket)!;
      if (seen >= rank) return latencyBucketValue(bucket);
    }
    return this.#max;
  }
}

/** One slice of the run's clock, as the charts read it. */
export interface StatsSlot {
  calls: number;
  failures: number;
  // Where the slice starts, in milliseconds from the run's first call.
  offsetMs: number;
  widthMs: number;
  rps: number;
  p50?: number;
  p95?: number;
  p99?: number;
  // Calls still in the air when the slice ended.
  inFlight: number;
}

interface TimeBucket {
  calls: number;
  failures: number;
  latencies: Latencies;
  // What the number of calls in flight moves by across this bucket: +1 where a call
  // was issued, −1 where it settled. Prefix-summing gives the concurrency line, and
  // summing two of them is what makes buckets mergeable.
  inFlightDelta: number;
}

function emptyBucket(): TimeBucket {
  return { calls: 0, failures: 0, latencies: new Latencies(), inFlightDelta: 0 };
}

interface Seen {
  startedAt: number;
  failed: boolean;
  settled: boolean;
}

/**
 * The run's calls over its own clock. A bucket index is derived from a timestamp
 * rather than remembered, so when the buckets double — pairwise, which halves every
 * index — a call that settles afterwards still lands where it belongs.
 */
class Timeline {
  #buckets: TimeBucket[] = [];
  #bucketMs = START_BUCKET_MS;
  #startedAt: number;
  #endedAt: number;

  constructor(startedAt: number) {
    this.#startedAt = startedAt;
    this.#endedAt = startedAt;
  }

  get bucketMs(): number {
    return this.#bucketMs;
  }

  get spanMs(): number {
    return this.#endedAt - this.#startedAt;
  }

  issued(timestamp: number): TimeBucket {
    const bucket = this.#at(timestamp);
    bucket.calls++;
    bucket.inFlightDelta++;
    return bucket;
  }

  failed(timestamp: number): void {
    this.#at(timestamp).failures++;
  }

  // Every call that settles leaves the air, whether or not its latency counts.
  drained(startedAt: number, durationMs: number): void {
    this.#at(startedAt + durationMs).inFlightDelta--;
  }

  measured(startedAt: number, reportedMs: number): void {
    this.#at(startedAt).latencies.add(reportedMs);
  }

  /**
   * The slices a chart draws, merged down to the room it has. Merging on the way out
   * rather than rebuilding is what keeps a resize a pass over at most 240 buckets.
   */
  view(slots: number): StatsSlot[] {
    if (slots <= 0 || this.#buckets.length === 0) return [];
    const factor = Math.max(1, Math.ceil(this.#buckets.length / slots));
    const widthMs = this.#bucketMs * factor;
    const merged: StatsSlot[] = [];
    let inFlight = 0;
    for (let index = 0; index < this.#buckets.length; index += factor) {
      const group = this.#buckets.slice(index, index + factor);
      const latencies = new Latencies();
      let calls = 0;
      let failures = 0;
      for (const bucket of group) {
        calls += bucket.calls;
        failures += bucket.failures;
        inFlight += bucket.inFlightDelta;
        latencies.merge(bucket.latencies);
      }
      merged.push({
        calls,
        failures,
        offsetMs: (index / factor) * widthMs,
        widthMs,
        rps: (calls * 1000) / widthMs,
        p50: latencies.percentile(0.5),
        p95: latencies.percentile(0.95),
        p99: latencies.percentile(0.99),
        // A delta can leave this below zero only if a call settled before the bucket
        // its issue landed in, which the clock does not allow.
        inFlight: Math.max(0, inFlight),
      });
    }
    return merged;
  }

  /**
   * The most calls that were ever in the air at once, read at the finest resolution
   * the timeline still holds. A coarser bucket hides a spike that opened and closed
   * inside it, so this is a floor rather than a promise.
   */
  get peakInFlight(): number {
    let inFlight = 0;
    let peak = 0;
    for (const bucket of this.#buckets) {
      inFlight += bucket.inFlightDelta;
      if (inFlight > peak) peak = inFlight;
    }
    return peak;
  }

  #at(timestamp: number): TimeBucket {
    if (timestamp > this.#endedAt) this.#endedAt = timestamp;
    let index = this.#index(timestamp);
    while (index >= MAX_TIME_BUCKETS) {
      this.#collapse();
      index = this.#index(timestamp);
    }
    while (this.#buckets.length <= index) this.#buckets.push(emptyBucket());
    return this.#buckets[index];
  }

  #index(timestamp: number): number {
    return Math.max(0, Math.floor((timestamp - this.#startedAt) / this.#bucketMs));
  }

  // Pairs, so a bucket still covers a contiguous stretch of the clock and every index
  // is exactly halved.
  #collapse(): void {
    const collapsed: TimeBucket[] = [];
    for (let index = 0; index < this.#buckets.length; index += 2) {
      const first = this.#buckets[index];
      const second = this.#buckets[index + 1];
      if (second !== undefined) {
        first.calls += second.calls;
        first.failures += second.failures;
        first.inFlightDelta += second.inFlightDelta;
        first.latencies.merge(second.latencies);
      }
      collapsed.push(first);
    }
    this.#buckets = collapsed;
    this.#bucketMs *= 2;
  }
}

/** One method's share of the run, as the table below the charts reads it. */
export interface MethodRow {
  method: string;
  calls: number;
  failures: number;
  p50?: number;
  p95?: number;
  p99?: number;
  max?: number;
  rps: number;
}

/** The one call worth naming — and the row in the log it opens. */
export interface SlowestCall {
  itemId: string;
  method: string;
  // The identifying value read off the request, which is what tells two hundred calls
  // of one method apart.
  key?: string;
  durationMs: number;
}

/** One bar of the distribution chart, over the log-scaled latency axis. */
export interface DistributionBar {
  // Where the bar sits across the axis, 0 to 1.
  position: number;
  width: number;
  calls: number;
  fromMs: number;
  toMs: number;
}

export interface RunStats {
  calls: number;
  settled: number;
  failures: number;
  errorRate: number;
  meanRps: number;
  peakRps: number;
  maxInFlight: number;
  p50?: number;
  p90?: number;
  p95?: number;
  p99?: number;
  min?: number;
  max?: number;
  mean?: number;
  // Calls left out of the percentiles and stated on the tile strip. A failed call is
  // counted everywhere else — it is the latency of a call that failed fast that would
  // poison the distribution, not its existence.
  excludedFailures: number;
  excludedWarmup: number;
  // The window the charts cover: the run's own wall clock where it has one, else how
  // far its calls reach.
  spanMs: number;
  slots: StatsSlot[];
  distribution: DistributionBar[];
  // Where the percentiles fall across the distribution's axis, 0 to 1. Absent while
  // there is nothing to place them against.
  markers: { label: string; position: number; valueMs: number }[];
  methods: MethodRow[];
  slowest?: SlowestCall;
}

/** One settled call, before it is known whether it counts. */
interface Sample {
  itemId: string;
  method: string;
  key?: string;
  startedAt: number;
  reported: number;
  failed: boolean;
}

class MethodTotals {
  calls = 0;
  failures = 0;
  readonly latencies = new Latencies();
}

/**
 * A run's statistics, accumulated as its calls arrive. `add` is called again for the
 * same item when it settles, so everything it counts is guarded by what it has already
 * seen of that item.
 */
export class RunMetrics {
  // Bumped by anything that changes what a chart would draw, which is what the view
  // memoises against rather than walking the run to find out.
  version = 0;

  readonly #timeline: Timeline;
  readonly #overall = new Latencies();
  readonly #methods = new Map<string, MethodTotals>();
  readonly #of = new Map<string, Seen>();
  #calls = 0;
  #failures = 0;
  #excludedFailures = 0;
  #excludedWarmup = 0;
  #warmupEndsAt: number | undefined;
  // Non-null only while a declared warm-up has no end yet.
  #held: Sample[] | null = null;
  #slowest: SlowestCall | undefined;

  constructor(startedAt: number) {
    this.#timeline = new Timeline(startedAt);
  }

  get calls(): number {
    return this.#calls;
  }

  get settled(): number {
    return this.#overall.total;
  }

  add(item: ConsoleItem): void {
    const call = item.call;
    if (call === undefined) return;

    const method = callLabel(call);
    let seen = this.#of.get(item.id);
    if (seen === undefined) {
      seen = { startedAt: item.timestamp, failed: false, settled: false };
      this.#of.set(item.id, seen);
      this.#calls++;
      this.#totals(method).calls++;
      this.#timeline.issued(item.timestamp);
      this.version++;
    }

    if (call.error !== undefined && !seen.failed) {
      seen.failed = true;
      this.#failures++;
      this.#totals(method).failures++;
      this.#timeline.failed(seen.startedAt);
      this.version++;
    }

    if (call.durationMs !== undefined && !seen.settled) {
      seen.settled = true;
      // What the rows and bars are drawn against everywhere else: the upstream
      // exchange where Kaja measured it, the whole round trip where nothing did.
      const reported = callDurationMs(call) ?? call.durationMs;
      this.#timeline.drained(seen.startedAt, call.durationMs);
      this.#sample({ itemId: item.id, method, key: item.key, startedAt: seen.startedAt, reported, failed: seen.failed });
      this.version++;
    }
  }

  /**
   * A warm-up whose end is not known yet — an iteration warm-up has none until it
   * happens. Samples are held rather than counted, because a sample counted under the
   * wrong phase cannot be taken back out of a histogram.
   */
  declareWarmup(): void {
    if (this.#held === null) this.#held = [];
  }

  /**
   * Where the warm-up ended, or that it never did. Either way the held samples are
   * released — a test stopped inside its own warm-up excludes nothing, since the
   * alternative is a page reporting a run of no calls at all.
   */
  resolveWarmup(endsAt: number | undefined): void {
    if (endsAt !== undefined && this.#warmupEndsAt === endsAt && this.#held === null) return;
    this.#warmupEndsAt = endsAt;
    const held = this.#held;
    this.#held = null;
    if (held !== null) for (const sample of held) this.#count(sample);
    this.version++;
  }

  #sample(sample: Sample): void {
    if (this.#held !== null) this.#held.push(sample);
    else this.#count(sample);
  }

  // The one place the sample set is decided, so the tiles, the charts, the method
  // table and the slowest row can never disagree about what they are describing.
  #count(sample: Sample): void {
    if (sample.failed) {
      this.#excludedFailures++;
      return;
    }
    if (this.#warmupEndsAt !== undefined && sample.startedAt < this.#warmupEndsAt) {
      this.#excludedWarmup++;
      return;
    }
    this.#overall.add(sample.reported);
    this.#totals(sample.method).latencies.add(sample.reported);
    this.#timeline.measured(sample.startedAt, sample.reported);
    if (this.#slowest === undefined || sample.reported > this.#slowest.durationMs) {
      this.#slowest = { itemId: sample.itemId, method: sample.method, key: sample.key, durationMs: sample.reported };
    }
  }

  /**
   * Everything the page states, in the room it has. `slots` is how many slices the
   * timeline is drawn in and `bars` how many the distribution is.
   */
  view(slots: number, bars: number, runDurationMs?: number): RunStats {
    const spanMs = Math.max(runDurationMs ?? 0, this.#timeline.spanMs);
    // Slicing a run finer than its own calls draws a chart that is mostly gaps and
    // says nothing the coarser one didn't.
    const timeline = this.#timeline.view(Math.max(MIN_SLOTS, Math.min(slots, this.#calls)));
    const methods = [...this.#methods]
      .map(([method, totals]) => ({
        method,
        calls: totals.calls,
        failures: totals.failures,
        p50: totals.latencies.percentile(0.5),
        p95: totals.latencies.percentile(0.95),
        p99: totals.latencies.percentile(0.99),
        max: totals.latencies.max,
        rps: spanMs > 0 ? (totals.calls * 1000) / spanMs : 0,
      }))
      .sort((a, b) => b.calls - a.calls || a.method.localeCompare(b.method));

    const distribution = distributionBars(this.#overall, bars);
    const percentiles: [string, number | undefined][] = [
      ["p50", this.#overall.percentile(0.5)],
      ["p95", this.#overall.percentile(0.95)],
      ["p99", this.#overall.percentile(0.99)],
    ];

    return {
      calls: this.#calls,
      settled: this.#overall.total,
      failures: this.#failures,
      errorRate: this.#calls === 0 ? 0 : this.#failures / this.#calls,
      meanRps: spanMs > 0 ? (this.#calls * 1000) / spanMs : 0,
      peakRps: timeline.reduce((peak, slot) => Math.max(peak, slot.rps), 0),
      maxInFlight: this.#timeline.peakInFlight,
      p50: percentiles[0][1],
      p90: this.#overall.percentile(0.9),
      p95: percentiles[1][1],
      p99: percentiles[2][1],
      min: this.#overall.min,
      max: this.#overall.max,
      mean: this.#overall.mean,
      excludedFailures: this.#excludedFailures,
      excludedWarmup: this.#excludedWarmup,
      spanMs,
      slots: timeline,
      distribution,
      markers: mergeMarkers(
        percentiles
          .filter((entry): entry is [string, number] => entry[1] !== undefined)
          .map(([label, valueMs]) => ({ label, valueMs, position: distributionPosition(this.#overall, valueMs) })),
      ),
      methods,
      slowest: this.#slowest,
    };
  }

  #totals(method: string): MethodTotals {
    let totals = this.#methods.get(method);
    if (totals === undefined) {
      totals = new MethodTotals();
      this.#methods.set(method, totals);
    }
    return totals;
  }
}

// The occupied stretch of the latency axis, which is what both the bars and the
// percentile markers are laid out across. One bucket wide is still a range.
function occupied(latencies: Latencies): { from: number; to: number } | undefined {
  if (latencies.total === 0) return undefined;
  const buckets = [...latencies.counts.keys()];
  return { from: Math.min(...buckets), to: Math.max(...buckets) + 1 };
}

/**
 * The distribution, binned down to the bars there is room for. The axis is the
 * histogram's own log scale, which is why a long tail reads as a tail rather than as
 * one bar at the far left and nothing else.
 */
export function distributionBars(latencies: Latencies, bars: number): DistributionBar[] {
  const range = occupied(latencies);
  if (range === undefined || bars <= 0) return [];
  const span = range.to - range.from;
  const perBar = Math.max(1, Math.ceil(span / bars));
  const count = Math.ceil(span / perBar);
  const result: DistributionBar[] = [];
  for (let index = 0; index < count; index++) {
    const from = range.from + index * perBar;
    const to = Math.min(range.to, from + perBar);
    let calls = 0;
    for (let bucket = from; bucket < to; bucket++) calls += latencies.counts.get(bucket) ?? 0;
    result.push({
      position: index / count,
      width: 1 / count,
      calls,
      fromMs: latencyBucketFloor(from),
      toMs: latencyBucketFloor(to),
    });
  }
  return result;
}

/** Where a duration falls across the distribution's axis, 0 to 1. */
export function distributionPosition(latencies: Latencies, ms: number): number {
  const range = occupied(latencies);
  if (range === undefined || range.to <= range.from) return 0;
  const at = Math.log2(Math.max(ms, MIN_MS)) * BUCKETS_PER_OCTAVE + INDEX_OFFSET;
  return Math.min(1, Math.max(0, (at - range.from) / (range.to - range.from)));
}

/**
 * Percentile markers that landed on the same place, said once. Two of them a pixel
 * apart draw one label over the other, so the lower is silently the one you cannot
 * read — `p95·p99` is what the axis actually has to say.
 */
function mergeMarkers(markers: { label: string; position: number; valueMs: number }[]): { label: string; position: number; valueMs: number }[] {
  const merged: { label: string; position: number; valueMs: number }[] = [];
  for (const marker of markers) {
    const last = merged[merged.length - 1];
    if (last !== undefined && Math.abs(marker.position - last.position) < MARKER_GAP) {
      merged[merged.length - 1] = { label: `${last.label}\u00b7${marker.label}`, position: last.position, valueMs: Math.max(last.valueMs, marker.valueMs) };
      continue;
    }
    merged.push(marker);
  }
  return merged;
}

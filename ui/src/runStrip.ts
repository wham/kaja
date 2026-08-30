import { callDurationMs, callLabel } from "./kaja";
import { ConsoleItem } from "./runs";

/**
 * The run's calls, as one row — the only place the canvas states them.
 *
 * Two modes, one rule between them: one tick per call for exactly as long as a tick
 * can still be a tick, and buckets past that. So a narrow panel turns into a histogram
 * sooner than a wide one, because the width is what decides whether sixty marks can
 * each be a call.
 */

// A tick and the gap after it. Everything about the strip's width is this number:
// the slot count is the room divided by it.
export const SLOT_WIDTH = 5;
export const TICK_WIDTH = 4;
export const TICK_HEIGHT = 9;
// A bar never disappears: a bucket whose calls were all fast still has to be hittable.
export const BAR_MIN_HEIGHT = 3;
export const BAR_MAX_HEIGHT = 11;
// Past 200 a tick is under a pixel of information and the strip stops being able to
// count, so the extra room goes to the label instead.
export const MAX_SLOTS = 200;
// Below this the strip is dropped entirely and only the counts remain.
export const MIN_STRIP_WIDTH = 240;

export function slotsFor(availableWidth: number): number {
  if (availableWidth < MIN_STRIP_WIDTH) return 0;
  return Math.min(MAX_SLOTS, Math.floor(availableWidth / SLOT_WIDTH));
}

/** One mark on the strip: a call, or a bucket of them. */
export interface StripSlot {
  // The call the mark opens in the log — the first of the bucket.
  itemId: string;
  calls: number;
  failures: number;
  // What a bar's height is drawn against. Zero while nothing under it has settled.
  slowest: number;
  // Only a mark that is one call can name one.
  method?: string;
}

export interface StripView {
  // Ticks while every call still has a mark of its own; bars once they have to share.
  mode: "ticks" | "bars";
  slots: StripSlot[];
}

interface Bucket {
  itemId: string;
  calls: number;
  failures: number;
  slowest: number;
  method?: string;
}

interface Seen {
  // Where the call sits in the run, which is what its bucket is derived from — a
  // position never moves, so merging buckets doesn't have to find anything.
  ordinal: number;
  failed: boolean;
  duration?: number;
}

/**
 * The buckets, built as the run happens. A call updates one bucket on arrival and
 * never walks the ones before it; when there are more buckets than the strip can ever
 * draw, adjacent pairs are merged and the capacity doubles — O(slots), log(N) times
 * over a run of any length.
 */
export class RunStrip {
  #buckets: Bucket[] = [];
  // One means the strip is still a list.
  #capacity = 1;
  #of = new Map<string, Seen>();
  #methods = new Map<string, number>();
  #calls = 0;
  #failures = 0;

  get calls(): number {
    return this.#calls;
  }

  get failures(): number {
    return this.#failures;
  }

  // `add` is idempotent for the same item: the second arrival is what it failed with
  // and how long it took, not another call.
  add(item: ConsoleItem): void {
    const call = item.call;
    if (call === undefined) return;

    let seen = this.#of.get(item.id);
    if (seen === undefined) {
      const method = callLabel(call);
      seen = { ordinal: this.#calls, failed: false };
      this.#of.set(item.id, seen);
      this.#calls++;
      this.#methods.set(method, (this.#methods.get(method) ?? 0) + 1);
      this.#push(item.id, method);
    }

    const bucket = this.#buckets[Math.floor(seen.ordinal / this.#capacity)];
    if (bucket === undefined) return;
    if (call.error !== undefined && !seen.failed) {
      seen.failed = true;
      this.#failures++;
      bucket.failures++;
    }
    if (call.durationMs !== undefined && seen.duration === undefined) {
      const duration = callDurationMs(call) ?? call.durationMs;
      seen.duration = duration;
      bucket.slowest = Math.max(bucket.slowest, duration);
    }
  }

  /**
   * What the strip draws in the room it has. The buckets are merged down to the slot
   * count on the way out rather than rebuilt, so resizing costs a pass over at most 200
   * buckets and never over the calls themselves.
   */
  view(slots: number): StripView {
    if (slots <= 0 || this.#buckets.length === 0) return { mode: "ticks", slots: [] };
    const factor = Math.ceil(this.#buckets.length / slots);
    const merged = factor <= 1 ? this.#buckets : mergeEvery(this.#buckets, factor);
    const single = this.#capacity === 1 && factor === 1;
    return { mode: single ? "ticks" : "bars", slots: merged.map((bucket) => ({ ...bucket, method: single ? bucket.method : undefined })) };
  }

  /**
   * The two methods the run called most — the one thing that says what a strip of two
   * hundred identical marks was actually doing. A method called once is named without a
   * count, since `×1` is noise.
   */
  get methodLabel(): string | undefined {
    if (this.#methods.size === 0) return undefined;
    return [...this.#methods]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([method, count]) => (count > 1 ? `${method} ×${count}` : method))
      .join(" · ");
  }

  #push(itemId: string, method: string): void {
    const last = this.#buckets[this.#buckets.length - 1];
    if (last !== undefined && last.calls < this.#capacity) {
      last.calls++;
      return;
    }
    if (this.#buckets.length >= MAX_SLOTS) {
      this.#merge();
      this.#push(itemId, method);
      return;
    }
    this.#buckets.push({ itemId, calls: 1, failures: 0, slowest: 0, method: this.#capacity === 1 ? method : undefined });
  }

  // Pairs, so a bucket still holds a contiguous run of calls and a call's bucket is
  // still `floor(ordinal / capacity)`.
  #merge(): void {
    this.#buckets = mergeEvery(this.#buckets, 2);
    this.#capacity *= 2;
  }
}

function mergeEvery(buckets: Bucket[], factor: number): Bucket[] {
  const merged: Bucket[] = [];
  for (let index = 0; index < buckets.length; index += factor) {
    const group = buckets.slice(index, index + factor);
    merged.push({
      itemId: group[0].itemId,
      calls: group.reduce((total, bucket) => total + bucket.calls, 0),
      failures: group.reduce((total, bucket) => total + bucket.failures, 0),
      slowest: group.reduce((slowest, bucket) => Math.max(slowest, bucket.slowest), 0),
    });
  }
  return merged;
}

/**
 * How tall a bar is drawn, against the slowest call in the run. A bucket nothing has
 * settled in yet is drawn at the floor rather than at nothing — a gap would read as
 * calls that never happened.
 */
export function barHeight(slowest: number, runSlowest: number | undefined): number {
  if (runSlowest === undefined || runSlowest <= 0 || slowest <= 0) return BAR_MIN_HEIGHT;
  const fraction = Math.min(1, slowest / runSlowest);
  return Math.max(BAR_MIN_HEIGHT, Math.round(BAR_MIN_HEIGHT + fraction * (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT)));
}

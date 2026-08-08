import { loopKey } from "./loopKey";
import { ConsoleItem, itemStatus } from "./runs";

/**
 * How many consecutive calls to one method it takes before the canvas folds them
 * into a single row. Two is not worth a fold: it saves one line and costs a
 * click.
 */
export const MIN_FOLD = 3;

// How many distinct loop keys a folded row names before it stops listing them.
const MAX_SHOWN_KEYS = 2;

/**
 * What the canvas draws, in emission order: a single item, or a run of
 * consecutive calls to one method folded into one row. Only the canvas folds —
 * the log is the audit record and stays complete at any length.
 */
export type CanvasEntry = { kind: "item"; id: string; item: ConsoleItem } | { kind: "calls"; id: string; name: string; items: ConsoleItem[] };

export function callName(item: ConsoleItem): string | undefined {
  return item.call && `${item.call.service.name}.${item.call.method.name}`;
}

/**
 * Folds consecutive calls to the same method into one entry. Consecutive is the
 * whole rule: anything the script drew between two calls breaks the group,
 * because the canvas is the run in the order it happened and gathering calls
 * that weren't next to each other would rewrite the story to fit the fold.
 */
export function foldCalls(items: ConsoleItem[], minimum: number = MIN_FOLD): CanvasEntry[] {
  const entries: CanvasEntry[] = [];
  let batch: ConsoleItem[] = [];

  const flush = () => {
    if (batch.length >= minimum) {
      entries.push({ kind: "calls", id: batch[0].id, name: callName(batch[0])!, items: batch });
    } else {
      for (const item of batch) entries.push({ kind: "item", id: item.id, item });
    }
    batch = [];
  };

  for (const item of items) {
    const name = callName(item);
    if (name === undefined) {
      flush();
      entries.push({ kind: "item", id: item.id, item });
      continue;
    }
    if (batch.length > 0 && callName(batch[0]) !== name) flush();
    batch.push(item);
  }
  flush();

  return entries;
}

/**
 * How long a folded group took end to end — wall time, not the sum of its calls,
 * so a fan-out reports what it actually cost. Undefined while anything in it is
 * still in flight, since the group hasn't finished taking as long as it will.
 */
export function groupDuration(items: ConsoleItem[]): number | undefined {
  let start = Infinity;
  let end = -Infinity;
  for (const item of items) {
    const duration = item.call?.durationMs;
    if (duration === undefined) return undefined;
    start = Math.min(start, item.timestamp);
    end = Math.max(end, item.timestamp + duration);
  }
  return end < start ? undefined : end - start;
}

// How many calls in the group failed. A fold must never hide a failure, so this
// is stated on the row and the failed call keeps a tick of its own.
export function groupFailures(items: ConsoleItem[]): number {
  return items.filter((item) => itemStatus(item) === "error").length;
}

/**
 * What tells the calls in a folded group apart, read off their requests. The
 * method name is the same on every one of them by definition, so the loop key is
 * all that is left to say which pass through the loop is which — one key shared
 * by all of them is stated once, and many are named until they stop fitting.
 */
export function groupKeyLabel(items: ConsoleItem[]): string | undefined {
  const keys: string[] = [];
  for (const item of items) {
    const key = loopKey(item.call?.input);
    if (key !== undefined && !keys.includes(key)) keys.push(key);
  }
  if (keys.length === 0) return undefined;
  if (keys.length <= MAX_SHOWN_KEYS) return keys.join(", ");
  return `${keys.slice(0, MAX_SHOWN_KEYS).join(", ")} +${keys.length - MAX_SHOWN_KEYS}`;
}

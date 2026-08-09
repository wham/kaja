import { loopKey } from "./loopKey";
import { ConsoleItem, ItemStats } from "./runs";

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
 *
 * A folded row carries its own numbers rather than re-deriving them from its
 * calls, because a fold is exactly where that stops being free: a loop of a
 * thousand is one row, and walking a thousand requests to write it is work the
 * row does on every repaint.
 */
export type CanvasEntry =
  | { kind: "item"; id: string; item: ConsoleItem }
  | { kind: "calls"; id: string; name: string; items: ConsoleItem[]; stats: CallStats };

export function callName(item: ConsoleItem): string | undefined {
  return item.call && `${item.call.service.name}.${item.call.method.name}`;
}

/**
 * What a folded row says about the calls under it — the same five numbers a run
 * keeps of its items, plus the one thing that is only a question about a loop:
 * what tells its passes apart.
 */
export class CallStats extends ItemStats {
  #keys: string[] = [];

  override add(item: ConsoleItem): void {
    if (!this.has(item.id)) {
      // A request is fixed when the call goes out, so its key is read once.
      const key = loopKey(item.call?.input);
      if (key !== undefined && !this.#keys.includes(key)) this.#keys.push(key);
    }
    super.add(item);
  }

  /**
   * What tells the calls in a folded group apart, read off their requests. The
   * method name is the same on every one of them by definition, so the loop key
   * is all that is left to say which pass through the loop is which — one key
   * shared by all of them is stated once, and many are named until they stop
   * fitting.
   */
  get keyLabel(): string | undefined {
    if (this.#keys.length === 0) return undefined;
    if (this.#keys.length <= MAX_SHOWN_KEYS) return this.#keys.join(", ");
    return `${this.#keys.slice(0, MAX_SHOWN_KEYS).join(", ")} +${this.#keys.length - MAX_SHOWN_KEYS}`;
  }
}

/**
 * The fold, maintained as a run happens rather than derived from it. A call
 * either extends the row it belongs to or starts a new one, which is a fixed
 * amount of work however long the loop turns out to be.
 *
 * Consecutive is the whole rule: anything the script drew between two calls
 * breaks the group, because the canvas is the run in the order it happened and
 * gathering calls that weren't next to each other would rewrite the story to fit
 * the fold.
 */
export class CallFold {
  readonly entries: CanvasEntry[] = [];
  readonly #minimum: number;
  // Which row each call ended up in, so a call settling updates its row's
  // numbers without anything having to look for it.
  readonly #rowOf = new Map<string, CanvasEntry>();
  // How many trailing loose cards are consecutive calls to one method, waiting
  // for the one that makes them a fold.
  #loose = 0;

  constructor(minimum: number = MIN_FOLD) {
    this.#minimum = minimum;
  }

  push(item: ConsoleItem): void {
    const name = callName(item);
    if (name === undefined) {
      this.#loose = 0;
      this.#place(item, { kind: "item", id: item.id, item });
      return;
    }

    const last = this.entries[this.entries.length - 1];
    if (last?.kind === "calls" && last.name === name) {
      last.items.push(item);
      last.stats.add(item);
      this.#rowOf.set(item.id, last);
      return;
    }

    const loose = last?.kind === "item" && callName(last.item) === name ? this.#loose : 0;
    if (loose + 1 >= this.#minimum) {
      const items = this.entries.splice(this.entries.length - loose, loose).map((entry) => (entry as { item: ConsoleItem }).item);
      items.push(item);
      const stats = new CallStats();
      const row: CanvasEntry = { kind: "calls", id: items[0].id, name, items, stats };
      for (const folded of items) {
        stats.add(folded);
        this.#rowOf.set(folded.id, row);
      }
      this.entries.push(row);
      this.#loose = 0;
      return;
    }

    this.#place(item, { kind: "item", id: item.id, item });
    this.#loose = loose + 1;
  }

  // A call that has settled, or a block that has been answered. The item is the
  // same object the fold already holds, so only the row's numbers move.
  patched(item: ConsoleItem): void {
    const row = this.#rowOf.get(item.id);
    if (row?.kind === "calls") row.stats.add(item);
  }

  #place(item: ConsoleItem, entry: CanvasEntry): void {
    this.entries.push(entry);
    this.#rowOf.set(item.id, entry);
  }
}

/**
 * The same fold over a list that is already complete — a run read back from the
 * store, or a test. It is the incremental one, run to the end, so there is one
 * definition of what folds and what a folded row says.
 */
export function foldCalls(items: ConsoleItem[], minimum: number = MIN_FOLD): CanvasEntry[] {
  const fold = new CallFold(minimum);
  for (const item of items) fold.push(item);
  return fold.entries;
}

function statsOf(items: ConsoleItem[]): CallStats {
  const stats = new CallStats();
  for (const item of items) stats.add(item);
  return stats;
}

export function groupDuration(items: ConsoleItem[]): number | undefined {
  return statsOf(items).duration;
}

export function groupFailures(items: ConsoleItem[]): number {
  return statsOf(items).failures;
}

export function groupKeyLabel(items: ConsoleItem[]): string | undefined {
  return statsOf(items).keyLabel;
}

import { Block, blockLabel, isAwaitingUser } from "./blocks";
import { callDurationMs, isCallInFlight, MethodCall } from "./kaja";
// Type only: the strip is maintained in runStrip, which reads its items from here.
// Importing the value would close the circle.
import type { RunMetrics } from "./runStats";
import type { RunStrip } from "./runStrip";
import { Log, LogLevel } from "./server/api";

/**
 * A run is the unit the console reports: one press of Run, one duration, one
 * verdict, with the calls a script made nested under it.
 */
export interface Run {
  id: string;
  // The console belongs to one file, so every run in it carries much the same name
  // and the header numbers them instead; this is what the window title reads.
  title: string;
  // Counting from one and never reused: `Run 3` has to survive the oldest runs being
  // trimmed, which a position in the list would not.
  number?: number;
  // A draft id or a script path, which decides the console a run lands in. ("Source"
  // is taken: it means an app's generated proto TypeScript.)
  fileId?: string;
  startedAt: number;
  // Absent means a person did. A console holds runs of both.
  origin?: "agent";
  // Wall time for the whole script, which differs from the sum of the calls when they
  // run concurrently.
  durationMs?: number;
  // Read back from the store: it happened in an earlier session and must not look live.
  stale?: boolean;
  // Set on a stale run whose payloads have aged out.
  payloadsExpired?: boolean;
}

/**
 * One thing that happened in a run: a call, something drawn, or printed lines.
 * Blocks are items rather than a parallel world, so they inherit run grouping,
 * ordering, the per-file console and the store without any of it being written twice.
 */
export interface ConsoleItem {
  id: string;
  runId: string;
  timestamp: number;
  call?: MethodCall;
  logs?: Log[];
  block?: Block;
  // Printed by the script rather than written by Kaja as a verdict about the run, so
  // it never colours the run's dot and never counts as something drawn.
  printed?: boolean;
  // Read off the request once when the call was issued: the request never changes
  // after that, and the log would otherwise re-read it per row per repaint.
  key?: string;
  // The payload was let go to keep a long run bounded. The row is still the record
  // that the call happened.
  payloadsDropped?: boolean;
}

export type RunStatus = "pending" | "streaming" | "success" | "error";

// Remembered per file along with the selection.
export type ConsoleTab = "request" | "response" | "headers";

/**
 * The three readings of one run: every call in wall order, what the script drew, and
 * what the calls add up to. Stats is always there — a run has statistics whether or
 * not it was shaped as a test.
 */
export type ConsoleView = "calls" | "canvas" | "stats";

/**
 * How much of what the script printed the calls view mixes in. A floor rather than
 * independent switches, because the levels are ordered (`LEVEL_DEBUG` 0 …
 * `LEVEL_ERROR` 3). Remembered per file, like the view.
 */
export type LogFloor = "off" | "error" | "warn" | "all";

// Off admits nothing, which is what makes this undefined rather than a number no
// level can be below.
export function logFloorLevel(floor: LogFloor): LogLevel | undefined {
  switch (floor) {
    case "off":
      return undefined;
    case "error":
      return LogLevel.LEVEL_ERROR;
    case "warn":
      return LogLevel.LEVEL_WARN;
    case "all":
      return LogLevel.LEVEL_DEBUG;
  }
}

/**
 * One run and everything under it, maintained by the file's console as the run
 * happens rather than derived on every render — re-deriving a thousand-call run per
 * repaint is what made a spike unwatchable.
 */
export interface RunGroup {
  run: Run;
  // In emission order, never re-sorted.
  items: ConsoleItem[];
  calls: ConsoleItem[];
  // Kept beside the calls rather than among them: the mix is a view's decision, so
  // the floor can change without the run being re-read.
  printed: ConsoleItem[];
  // A call is not a block and is not in here — the strip is where the run's calls are.
  drawn: ConsoleItem[];
  strip: RunStrip;
  // What the Stats view reads. Accumulated as the run happens for the same reason the
  // strip is: a perf test's twenty thousand calls are not re-walked per repaint.
  metrics: RunMetrics;
  // The only kind of failure the canvas interrupts itself for.
  unreported: FailureNotice[];
  stats: ItemStats;
  awaiting?: ConsoleItem;
  // Decides the view it opens in.
  drew: boolean;
  // Stated rather than silent: the log is the audit record, so where it stops being
  // complete it has to say so.
  dropped: number;
  // The worst status the run contains.
  status: RunStatus;
  inFlight: boolean;
  // Wider than `inFlight`, and the one the chrome reports: a script sleeping between
  // two calls has nothing in flight and is very much still running.
  running: boolean;
  failures: number;
}

/**
 * A failure the script never said anything about. A call failing inside a loop that
 * writes its own result column is already reported somewhere better than a red row,
 * so only the ones nothing was drawn after are stated — once per method.
 */
export interface FailureNotice {
  // The first of them.
  itemId: string;
  method: string;
  count: number;
  code?: string;
  message?: string;
}

// The key is what makes two failures the same, so it is what the row can honestly state.
export function failureNotices(items: ConsoleItem[]): FailureNotice[] {
  const notices = new Map<string, FailureNotice>();
  for (const item of items) {
    if (!item.call?.error) continue;
    const method = `${item.call.service.name}.${item.call.method.name}`;
    const code = failureCode(item.call);
    const message = failureMessage(item.call);
    const key = `${method} ${code ?? ""} ${message ?? ""}`;
    const known = notices.get(key);
    if (known) known.count++;
    else notices.set(key, { itemId: item.id, method, count: 1, code, message });
  }
  return [...notices.values()];
}

function failureCode(call: MethodCall): string | undefined {
  const status = call.error?.status;
  if (typeof status === "number" && status > 0) return String(status);
  const code = call.error?.code;
  return typeof code === "string" && code.length > 0 && code.length <= 24 ? code : undefined;
}

function failureMessage(call: MethodCall): string | undefined {
  const message = call.error?.message;
  if (typeof message !== "string" || message.length === 0) return undefined;
  const line = message.trim().split("\n")[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

let sequence = 0;

export function newRunId(): string {
  sequence++;
  return `run-${Date.now().toString(36)}-${sequence}`;
}

export function newItemId(): string {
  sequence++;
  return `item-${Date.now().toString(36)}-${sequence}`;
}

export function callStatus(call: MethodCall): RunStatus {
  if (call.error) return "error";
  const isStreaming = call.streamOutputs !== undefined;
  if (isStreaming && !call.streamComplete) return "streaming";
  return call.output !== undefined ? "success" : "pending";
}

export function logsStatus(logs: Log[]): RunStatus {
  return logs.some((log) => log.level === LogLevel.LEVEL_ERROR) ? "error" : "success";
}

// A drawn block has already happened, so it is settled — except an ask, which is the
// run stopped mid-flight waiting to be answered.
export function blockStatus(block: Block): RunStatus {
  return isAwaitingUser(block) ? "pending" : "success";
}

export function itemStatus(item: ConsoleItem): RunStatus {
  if (item.call) return callStatus(item.call);
  if (item.block) return blockStatus(item.block);
  // A printed line says something about the script's own reckoning, not about whether
  // the run succeeded.
  if (item.printed) return "success";
  return item.logs ? logsStatus(item.logs) : "success";
}

// An item holds the lines of one call, so it is one level; the worst of them is the
// honest reading if that ever stops being true.
export function printedLevel(item: ConsoleItem): LogLevel {
  return (item.logs ?? []).reduce<LogLevel>((worst, log) => (log.level > worst ? log.level : worst), LogLevel.LEVEL_DEBUG);
}

export function itemName(item: ConsoleItem): string {
  if (item.call) return `${item.call.service.name}.${item.call.method.name}`;
  if (item.block) return blockLabel(item.block);
  const logs = item.logs ?? [];
  return logs.length === 1 ? logs[0].message.trim() : `${logs.length} log messages`;
}

/**
 * What a set of items says about itself, accumulated as they arrive rather than
 * re-derived: both a run and a folded canvas row read these on every repaint while
 * the set behind them can be thousands long.
 *
 * `add` is idempotent and meant to be called again for the same item: a call reaches
 * the console when issued and again when it settles.
 */
export class ItemStats {
  #of = new Map<string, { status: RunStatus; inFlight: boolean; duration?: number }>();
  #counts: Record<RunStatus, number> = { pending: 0, streaming: 0, success: 0, error: 0 };
  #inFlight = 0;
  #settled = 0;
  #slowest = 0;
  #start = Infinity;
  #end = -Infinity;

  has(id: string): boolean {
    return this.#of.has(id);
  }

  add(item: ConsoleItem): void {
    const was = this.#of.get(item.id);
    if (was) {
      this.#counts[was.status]--;
      if (was.inFlight) this.#inFlight--;
    }

    // A block the run is parked on is not on its way to a call, but the run is not over
    // either.
    const inFlight = item.call !== undefined ? isCallInFlight(item.call) : item.block !== undefined && isAwaitingUser(item.block);
    const status = itemStatus(item);
    this.#counts[status]++;
    if (inFlight) this.#inFlight++;

    // A duration is written once, when the call settles, so it only ever moves the
    // window outward. The wall window keeps the full round trip — it is about this
    // client's clock — while slowest compares what the rows show (callDurationMs).
    const duration = item.call?.durationMs;
    if (duration !== undefined && was?.duration === undefined) {
      this.#settled++;
      this.#slowest = Math.max(this.#slowest, callDurationMs(item.call!) ?? duration);
      this.#start = Math.min(this.#start, item.timestamp);
      this.#end = Math.max(this.#end, item.timestamp + duration);
    }

    this.#of.set(item.id, { status, inFlight, duration });
  }

  get size(): number {
    return this.#of.size;
  }

  get status(): RunStatus {
    if (this.#of.size === 0) return "pending";
    if (this.#counts.error > 0) return "error";
    if (this.#counts.pending > 0) return "pending";
    if (this.#counts.streaming > 0) return "streaming";
    return "success";
  }

  get failures(): number {
    return this.#counts.error;
  }

  get inFlight(): boolean {
    return this.#inFlight > 0;
  }

  // Bars only mean something with calls to compare, so a set of one gets none.
  get slowest(): number | undefined {
    return this.#settled > 1 ? this.#slowest : undefined;
  }

  /**
   * Wall time for the whole set — not the sum of its calls, so a fan-out reports what
   * it actually cost. Undefined while anything in it is in flight.
   */
  get duration(): number | undefined {
    if (this.#of.size === 0 || this.#settled !== this.#of.size) return undefined;
    return this.#end < this.#start ? undefined : this.#end - this.#start;
  }
}

// Kept as the definition `ItemStats` is tested against. A run that has produced
// nothing at all is still pending.
export function worstStatus(items: ConsoleItem[]): RunStatus {
  if (items.length === 0) return "pending";
  const statuses = items.map(itemStatus);
  if (statuses.includes("error")) return "error";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("streaming")) return "streaming";
  return "success";
}

export function callCount(group: RunGroup): number {
  return group.calls.length;
}

/**
 * The rows the calls view draws: its calls, with whatever the floor admits of what
 * the script printed mixed in where it was printed.
 *
 * It reads `items`, which is emission order, so the order is right by construction.
 * Merging the two lists by timestamp is wrong: a log line and the call issued right
 * after it land in the same millisecond often enough that the tie-break decides the
 * reading, and `Date.now()` is not what put them in the run in the first place.
 */
export function callRows(group: RunGroup, floor: LogFloor): ConsoleItem[] {
  const least = logFloorLevel(floor);
  if (least === undefined || group.printed.length === 0) return group.calls;

  const rows: ConsoleItem[] = [];
  for (const item of group.items) {
    if (item.call) rows.push(item);
    else if (item.printed && printedLevel(item) >= least) rows.push(item);
  }
  // Nothing admitted means the calls themselves, so the caller's memo holds.
  return rows.length === group.calls.length ? group.calls : rows;
}

// A run that printed an error and shows a clean list is a log that is silently
// incomplete, which is the one thing this console refuses to be.
export function printedCounts(group: RunGroup): { lines: number; errors: number } {
  let errors = 0;
  for (const item of group.printed) {
    if (printedLevel(item) === LogLevel.LEVEL_ERROR) errors++;
  }
  return { lines: group.printed.length, errors };
}

/**
 * Which view a run opens in when nothing has been chosen. An explicit choice
 * outranks this and sticks per file.
 */
export function defaultView(group: RunGroup | undefined): ConsoleView {
  return group?.drew ? "canvas" : "calls";
}

/**
 * What a run that was launched rather than pressed is worth showing. The canvas is
 * the only thing there is to present, so a run that has drawn nothing yet is `"wait"`
 * rather than an empty screen, and one that ended without drawing is `"drop"`.
 */
export type Presentation = "present" | "wait" | "drop";

export function presentRun(group: RunGroup | undefined): Presentation {
  if (!group) return "wait";
  if (group.drew) return "present";
  return group.running ? "wait" : "drop";
}

// Kept for reading a list that is already complete, and as the definition
// `ItemStats` is tested against.
export function slowestOf(items: ConsoleItem[]): number | undefined {
  const durations = items
    .filter((item) => item.call?.durationMs !== undefined)
    .map((item) => callDurationMs(item.call!))
    .filter((duration): duration is number => duration !== undefined);
  return durations.length > 1 ? Math.max(...durations) : undefined;
}

export interface RunSelection {
  runId: string;
  itemId?: string;
}

/**
 * Where the console points after the run list changes. A run arriving (`isNewRun`)
 * always takes the selection, including from an older run stepped back to; anything
 * else only moves the cursor within the run being watched. A selection whose run has
 * gone follows the newest too.
 *
 * Inside that run the cursor follows the newest call only while `tailing` — a row you
 * scrolled back to read should not be pulled out from under you, and following every
 * call is the most expensive thing in the room at five hundred a run.
 */
export function followSelection(current: RunSelection | null, groups: RunGroup[], isNewRun: boolean, tailing: boolean): RunSelection | null {
  const newest = groups[groups.length - 1];
  if (!newest) return null;
  const known = current !== null && groups.some((group) => group.run.id === current.runId);
  if (!isNewRun && known) {
    // A run stepped back to keeps the cursor, and so does the newest one once the log
    // has been scrolled off the bottom.
    if (current.runId !== newest.run.id || !tailing) return current;
  }
  return { runId: newest.run.id, itemId: newest.calls[newest.calls.length - 1]?.id };
}

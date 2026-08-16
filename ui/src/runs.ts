import { Block, blockLabel, isAwaitingUser } from "./blocks";
import { isCallInFlight, MethodCall } from "./kaja";
// Type only: the strip is maintained in runStrip, which reads its items from
// here. Importing the value would close the circle.
import type { RunStrip } from "./runStrip";
import { Log, LogLevel } from "./server/api";

/**
 * A run is the unit the console reports: one press of Run, one header, one
 * duration, one verdict. The calls a script makes nest under it, because nothing
 * else ties three calls to the same press.
 */
export interface Run {
  id: string;
  // The script's derived name at the time it was run. The console belongs to one
  // file, so every run in it carries much the same name and the header numbers
  // them instead; this is what the window title and the store still read.
  title: string;
  // Which run of this file it is, counting from one and never reused. The
  // header says `Run 3`, so it has to survive the oldest runs being trimmed —
  // a position in the list would renumber underneath you.
  number?: number;
  // The file it came from — a draft id or a script path. The console belongs
  // to the file, so this is what decides which console a run lands in. ("Source"
  // is taken: it means an app's generated proto TypeScript.)
  fileId?: string;
  startedAt: number;
  // Who pressed Run. Absent means a person did. This is the one thing a run's
  // own header can say that the file's cannot: a console holds runs of both.
  origin?: "agent";
  // Wall time for the whole script. It differs from the sum of the calls when
  // they run concurrently, which is the number worth stating.
  durationMs?: number;
  // A run read back from the store: it happened in an earlier session and must
  // not look live.
  stale?: boolean;
  // Set on a stale run whose payloads have aged out. The header still knows what
  // happened, which is a more honest thing to show than nothing.
  payloadsExpired?: boolean;
}

/**
 * One thing that happened in a run: a call it made, something it drew, or the
 * log messages it printed. Blocks are items rather than a parallel world, so
 * they inherit run grouping, ordering, the per-file console and the store
 * without any of it being written twice.
 */
export interface ConsoleItem {
  id: string;
  runId: string;
  timestamp: number;
  call?: MethodCall;
  logs?: Log[];
  block?: Block;
  /**
   * Set when the lines were printed by the script rather than written by Kaja as
   * a verdict about the run. The difference is what they are worth: a verdict is
   * the run's status, while a printed line is a channel — a script that prints
   * `console.error("retry 2")` in a loop and finishes is not a failed run. So a
   * printed item never colours the run's dot and never counts as something drawn.
   */
  printed?: boolean;
  // What identifies this call, read off its request when it was issued. The
  // request never changes after that, and the log draws this on every row — so
  // it is read once here rather than per row per repaint.
  key?: string;
  // Set when the payload was let go to keep a long run bounded. The row is still
  // the record that the call happened; only what it carried is gone, which is
  // the same bargain the store makes with an expired run.
  payloadsDropped?: boolean;
}

export type RunStatus = "pending" | "streaming" | "success" | "error";

// Which part of the selected call is showing. It is remembered per file along
// with the selection, so going back to a script finds its console as it was.
export type ConsoleTab = "request" | "response" | "headers";

/**
 * The two views of one run. The list is the flat audit log — one row per call,
 * in wall order, always complete. The canvas is the rendered output. They want
 * opposite things: the log wants to be uniform and boring, which is what makes
 * it scannable at two hundred rows; the canvas wants to be varied. Serving both
 * in one surface bends one of them out of shape.
 */
export type ConsoleView = "calls" | "canvas";

/**
 * How much of what the script printed the calls view mixes in. Off is the
 * default, so the list is calls and nothing else until it is asked otherwise; the
 * rest is a floor rather than a set of independent switches, because the levels
 * are ordered (`LEVEL_DEBUG` 0 … `LEVEL_ERROR` 3) and "warnings but not errors"
 * is not a thing anyone wants to ask for.
 *
 * It is remembered per file, on the same rule the view is: debugging is a mode,
 * not a click.
 */
export type LogFloor = "off" | "error" | "warn" | "all";

// The lowest level a floor admits. Off admits nothing, which is what makes this
// undefined rather than a number no level can be below.
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
 * One run and everything under it. It is maintained by the file's console as the
 * run happens rather than derived from a flat list on every render — a run of a
 * thousand calls is re-read on every repaint, and re-deriving it there is what
 * made a spike unwatchable.
 */
export interface RunGroup {
  run: Run;
  // Everything the run produced, in emission order, never re-sorted.
  items: ConsoleItem[];
  // The calls view's rows, before anything is mixed into them: a call and only a
  // call.
  calls: ConsoleItem[];
  // What the script printed, in emission order, kept beside the calls rather than
  // among them — the mix is a view's decision and the floor can change without
  // the run being re-read.
  printed: ConsoleItem[];
  // The canvas: what the run drew, in emission order. A call is not a block and
  // is not in here — the strip is where the run's calls are stated.
  drawn: ConsoleItem[];
  // The run's calls as one row, bucketed as they arrived.
  strip: RunStrip;
  // Calls that failed with nothing drawn after them, which is the only kind of
  // failure the canvas interrupts itself for.
  unreported: FailureNotice[];
  // What the run says about itself, counted as its items arrived.
  stats: ItemStats;
  // The question the run is stopped on, if it is stopped on one.
  awaiting?: ConsoleItem;
  // Whether the run drew anything of its own, which is what decides the view it
  // opens in.
  drew: boolean;
  // Rows a very long run stopped keeping. Stated rather than silent: the log is
  // the audit record, so where it stops being complete it has to say so.
  dropped: number;
  // The worst status the run contains: a green run means every call passed.
  status: RunStatus;
  // Whether anything it started is still in flight.
  inFlight: boolean;
  // Whether the run itself is still going. Wider than `inFlight`, and it is the
  // one the chrome reports: a script sleeping between two calls has nothing in
  // flight and is very much still running.
  running: boolean;
  // How many of its calls failed, which is what the header says instead of
  // repeating the duration of each one.
  failures: number;
}

/**
 * A failure the script never said anything about. A call that fails inside a
 * loop which writes its own result column has already been reported in a better
 * place than a red row above it, so the canvas only interrupts itself for the
 * ones nothing was drawn after — and states them once per method rather than
 * once per call.
 */
export interface FailureNotice {
  // The call the row opens in the log — the first of them.
  itemId: string;
  method: string;
  count: number;
  // What it failed with: the status or code, and whatever the server said.
  code?: string;
  message?: string;
}

// One line for a set of failures that are the same failure. The key is what
// makes two of them the same, so it is what the row can honestly state.
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

// A drawn block has already happened, so it is settled — except an ask, which is
// the run stopped mid-flight waiting to be answered.
export function blockStatus(block: Block): RunStatus {
  return isAwaitingUser(block) ? "pending" : "success";
}

export function itemStatus(item: ConsoleItem): RunStatus {
  if (item.call) return callStatus(item.call);
  if (item.block) return blockStatus(item.block);
  // A line the script printed says something about the script's own reckoning,
  // not about whether the run succeeded — only a verdict Kaja wrote does that.
  if (item.printed) return "success";
  return item.logs ? logsStatus(item.logs) : "success";
}

// The level a printed item reports at, which is what the floor is read against
// and what colours its row. An item holds the lines of one call, so it is one
// level; the worst of them is the honest reading if that ever stops being true.
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
 * re-derived from them. A run and a folded row on the canvas both want the same
 * five numbers, and both are read on every repaint while the set behind them can
 * be thousands long — so it is counted once, here.
 *
 * `add` is idempotent and is meant to be called again for the same item: a call
 * reaches the console when it is issued and again when it settles, and that is
 * an update to what is already counted rather than a second call.
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

    // A block the run is parked on is not on its way to a call, but the run is
    // not over either — the script is stopped inside it waiting to be answered.
    const inFlight = item.call !== undefined ? isCallInFlight(item.call) : item.block !== undefined && isAwaitingUser(item.block);
    const status = itemStatus(item);
    this.#counts[status]++;
    if (inFlight) this.#inFlight++;

    // A duration is written once, when the call settles, so it only ever moves
    // the window outward.
    const duration = item.call?.durationMs;
    if (duration !== undefined && was?.duration === undefined) {
      this.#settled++;
      this.#slowest = Math.max(this.#slowest, duration);
      this.#start = Math.min(this.#start, item.timestamp);
      this.#end = Math.max(this.#end, item.timestamp + duration);
    }

    this.#of.set(item.id, { status, inFlight, duration });
  }

  get size(): number {
    return this.#of.size;
  }

  // The worst status the set contains — there is no "partially succeeded", and
  // the dot is the only thing anyone needs to read after a press.
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

  // The longest call, which every duration bar is drawn against. Bars only mean
  // something with calls to compare, so a set of one gets none.
  get slowest(): number | undefined {
    return this.#settled > 1 ? this.#slowest : undefined;
  }

  /**
   * Wall time for the whole set — not the sum of its calls, so a fan-out reports
   * what it actually cost. Undefined while anything in it is still in flight,
   * since it hasn't finished taking as long as it will.
   */
  get duration(): number | undefined {
    if (this.#of.size === 0 || this.#settled !== this.#of.size) return undefined;
    return this.#end < this.#start ? undefined : this.#end - this.#start;
  }
}

// A run's status is the worst status it contains — there is no "partially
// succeeded", and the header dot is the only thing anyone needs to read after a
// press. A run that has produced nothing at all is still pending.
export function worstStatus(items: ConsoleItem[]): RunStatus {
  if (items.length === 0) return "pending";
  const statuses = items.map(itemStatus);
  if (statuses.includes("error")) return "error";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("streaming")) return "streaming";
  return "success";
}

// The log is calls and only calls: a row is a call, full stop. Everything else a
// run produced is on the canvas, which is what stops the two views saying the
// same thing twice.
export function callCount(group: RunGroup): number {
  return group.calls.length;
}

/**
 * The rows the calls view draws: its calls, with whatever the floor admits of
 * what the script printed mixed in where it was printed.
 *
 * It reads `items`, which is the run in **emission order, never re-sorted** — so
 * the order is the order things happened, by construction. Merging the two lists
 * by timestamp was the obvious alternative and it is wrong: a log line and the
 * call issued right after it land in the same millisecond often enough that the
 * tie-break decides the reading, and `Date.now()` is not what put them in the run
 * in the first place.
 *
 * A printed line therefore lands where it was **printed** and a call where it was
 * **issued** — so a line printed while a call is in flight sits after that call's
 * row, not after its response. That is what the log has always meant by order.
 */
export function callRows(group: RunGroup, floor: LogFloor): ConsoleItem[] {
  const least = logFloorLevel(floor);
  if (least === undefined || group.printed.length === 0) return group.calls;

  const rows: ConsoleItem[] = [];
  for (const item of group.items) {
    if (item.call) rows.push(item);
    else if (item.printed && printedLevel(item) >= least) rows.push(item);
  }
  // Nothing admitted means the calls themselves, so the caller's memo holds and
  // the row list is the same object it was.
  return rows.length === group.calls.length ? group.calls : rows;
}

// What the calls view's tail bar says about the lines it is not showing. A run
// that printed an error and shows a clean list is a log that is silently
// incomplete, which is the one thing this console refuses to be.
export function printedCounts(group: RunGroup): { lines: number; errors: number } {
  let errors = 0;
  for (const item of group.printed) {
    if (printedLevel(item) === LogLevel.LEVEL_ERROR) errors++;
  }
  return { lines: group.printed.length, errors };
}

/**
 * Which view a run opens in when nothing has been chosen. A script executed for
 * its output opens on that output; one that only calls opens on the calls, where
 * everything it did actually is. An explicit choice outranks this and sticks per
 * file — debugging is a mode, not a click.
 */
export function defaultView(group: RunGroup | undefined): ConsoleView {
  return group?.drew ? "canvas" : "calls";
}

// The measure a set of calls is drawn against, kept for reading a list that is
// already complete. A live run counts it as it goes (`ItemStats`).
export function slowestOf(items: ConsoleItem[]): number | undefined {
  const durations = items.map((item) => item.call?.durationMs).filter((duration): duration is number => duration !== undefined);
  return durations.length > 1 ? Math.max(...durations) : undefined;
}

// Which run is being looked at, and which of its calls. No call means nothing in
// the log is selected yet, so the payload pane has nothing to show.
export interface RunSelection {
  runId: string;
  itemId?: string;
}

/**
 * Where the console points after the run list changes. Pressing Run is a request
 * to see what it did, so a run arriving (`isNewRun`) always takes the selection —
 * including from an older run that was deliberately stepped back to. Anything
 * else only moves the cursor within the run being watched: a call landing in a
 * later run leaves a stepped-back one alone. A selection whose run has gone has
 * nothing left to point at and follows the newest too.
 *
 * Inside the run being watched the cursor follows the newest call only while the
 * log is `tailing` — scrolled to the bottom, like a terminal. Following every
 * call was right at five a second and is the most expensive thing in the room at
 * five hundred, and it is also wrong: a row you scrolled back to read should not
 * be pulled out from under you.
 */
export function followSelection(current: RunSelection | null, groups: RunGroup[], isNewRun: boolean, tailing: boolean): RunSelection | null {
  const newest = groups[groups.length - 1];
  if (!newest) return null;
  const known = current !== null && groups.some((group) => group.run.id === current.runId);
  if (!isNewRun && known) {
    // A run stepped back to keeps the cursor, and so does the newest one once
    // the log has been scrolled off the bottom.
    if (current.runId !== newest.run.id || !tailing) return current;
  }
  return { runId: newest.run.id, itemId: newest.calls[newest.calls.length - 1]?.id };
}

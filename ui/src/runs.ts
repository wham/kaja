import { Block, blockLabel, isAwaitingAnswer } from "./blocks";
import { isCallInFlight, MethodCall } from "./kaja";
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
  // The file it came from — a scratch id or a script path. The console belongs
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
export type ConsoleView = "list" | "canvas";

export interface RunGroup {
  run: Run;
  items: ConsoleItem[];
  // The worst status the run contains: a green run means every call passed.
  status: RunStatus;
  // Whether anything it started is still in flight.
  inFlight: boolean;
  // How many of its calls failed, which is what the header says instead of
  // repeating the duration of each one.
  failures: number;
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
  return isAwaitingAnswer(block) ? "pending" : "success";
}

export function itemStatus(item: ConsoleItem): RunStatus {
  if (item.call) return callStatus(item.call);
  if (item.block) return blockStatus(item.block);
  return item.logs ? logsStatus(item.logs) : "success";
}

export function itemName(item: ConsoleItem): string {
  if (item.call) return `${item.call.service.name}.${item.call.method.name}`;
  if (item.block) return blockLabel(item.block);
  const logs = item.logs ?? [];
  return logs.length === 1 ? logs[0].message.trim() : `${logs.length} log messages`;
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

/**
 * Calls nest under the run that made them, ordered by start and never
 * re-sorted. Runs come back oldest first, which is the order the history reads
 * in; a run with no items left (its calls aged out) still gets a group, because
 * the header is what says it happened.
 */
export function groupRuns(runs: Run[], items: ConsoleItem[]): RunGroup[] {
  const byRun = new Map<string, ConsoleItem[]>();
  for (const item of items) {
    const list = byRun.get(item.runId);
    if (list) list.push(item);
    else byRun.set(item.runId, [item]);
  }

  return [...runs]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((run) => {
      const runItems = byRun.get(run.id) ?? [];
      return {
        run,
        items: runItems,
        status: worstStatus(runItems),
        // A run parked on a question has nothing in the air, but it is not over
        // either — the script is stopped inside it waiting to be answered.
        inFlight:
          !run.stale &&
          runItems.some((item) => (item.call !== undefined && isCallInFlight(item.call)) || (item.block !== undefined && isAwaitingAnswer(item.block))),
        failures: runItems.filter((item) => itemStatus(item) === "error").length,
      };
    });
}

// The log is calls and only calls: a row is a call, full stop. Everything else a
// run produced is on the canvas, which is what stops the two views saying the
// same thing twice.
export function callItems(group: RunGroup): ConsoleItem[] {
  return group.items.filter((item) => item.call !== undefined);
}

export function callCount(group: RunGroup): number {
  return callItems(group).length;
}

// The question the run is stopped on, if it is stopped on one. This is what puts
// a dot on the Canvas tab and an amber bar at the tail of the log.
export function awaitingItem(group: RunGroup): ConsoleItem | undefined {
  return group.items.find((item) => item.block !== undefined && isAwaitingAnswer(item.block));
}

// Whether the run drew anything of its own. A run that only made calls has a
// canvas of call cards, which is a true but redundant view of its log — so it
// is not what the console opens on.
export function hasDrawing(group: RunGroup): boolean {
  return group.items.some((item) => item.block !== undefined || item.logs !== undefined);
}

/**
 * Which view a run opens in when nothing has been chosen. A script executed for
 * its output opens on that output; one that only calls opens on its log, where
 * everything it did actually is. An explicit choice outranks this and sticks per
 * file — debugging is a mode, not a click.
 */
export function defaultView(group: RunGroup | undefined): ConsoleView {
  return group && hasDrawing(group) ? "canvas" : "list";
}

/**
 * The longest call in the run, which every duration bar is drawn against. Bars
 * only mean something in a run with calls to compare, so a run of one gets none.
 */
export function slowestCall(group: RunGroup): number | undefined {
  return slowestOf(callItems(group));
}

// The same measure over any run of calls, which is what the canvas draws a
// folded group's ticks against.
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
 * later run leaves a stepped-back one alone, while inside the watched run it
 * follows the newest call, which is what selects one in flight the moment it is
 * issued. A selection whose run has gone has nothing left to point at and
 * follows the newest too.
 */
export function followSelection(current: RunSelection | null, groups: RunGroup[], isNewRun: boolean): RunSelection | null {
  const newest = groups[groups.length - 1];
  if (!newest) return null;
  if (!isNewRun && current && current.runId !== newest.run.id && groups.some((group) => group.run.id === current.runId)) return current;
  const calls = callItems(newest);
  return { runId: newest.run.id, itemId: calls[calls.length - 1]?.id };
}

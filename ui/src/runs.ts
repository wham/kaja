import { isCallInFlight, MethodCall } from "./kaja";
import { Log, LogLevel } from "./server/api";

/**
 * A run is the unit the console reports: one press of Run, one header, one
 * duration, one verdict. The calls a script makes nest under it, because nothing
 * else ties three calls to the same press.
 */
export interface Run {
  id: string;
  // The script's derived name at the time it was run, so the console and the
  // sidebar speak the same language.
  title: string;
  // The file it came from — a scratch id or a script path. The console belongs
  // to the file, so this is what decides which console a run lands in. ("Source"
  // is taken: it means an app's generated proto TypeScript.)
  fileId?: string;
  startedAt: number;
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

// One line in the console: a call the run made, or the log messages it printed.
export interface ConsoleItem {
  id: string;
  runId: string;
  timestamp: number;
  call?: MethodCall;
  logs?: Log[];
}

export type RunStatus = "pending" | "streaming" | "success" | "error";

// Which part of the selected call is showing. It is remembered per file along
// with the selection, so going back to a script finds its console as it was.
export type ConsoleTab = "request" | "response" | "headers";

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

export function itemStatus(item: ConsoleItem): RunStatus {
  return item.call ? callStatus(item.call) : item.logs ? logsStatus(item.logs) : "success";
}

export function itemName(item: ConsoleItem): string {
  if (item.call) return `${item.call.service.name}.${item.call.method.name}`;
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
        inFlight: !run.stale && runItems.some((item) => item.call !== undefined && isCallInFlight(item.call)),
        failures: runItems.filter((item) => itemStatus(item) === "error").length,
      };
    });
}

// How many calls the header reports. Log lines are the script talking, not calls
// it made, so they don't count towards it.
export function callCount(group: RunGroup): number {
  return group.items.filter((item) => item.call !== undefined).length;
}

// A single-item run renders as one row, header and call merged, so the common
// case gains no chrome over what the console shows today.
export function isSingleItemRun(group: RunGroup): boolean {
  return group.items.length <= 1;
}

// Which run is being looked at, and which of its calls. No call means the run
// header itself is selected, which shows the run's own summary.
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
  return { runId: newest.run.id, itemId: newest.items[newest.items.length - 1]?.id };
}

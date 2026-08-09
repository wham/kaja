import { Block, isAwaitingUser } from "./blocks";
import { isCallInFlight, MethodCall } from "./kaja";
import { ConsoleItem, ConsoleTab, ConsoleView, newItemId, Run, RunSelection } from "./runs";
import { Log } from "./server/api";

/**
 * The console belongs to the file. A run is made by pressing Run on something,
 * so it lands in that file's console and stays there: switching files switches
 * consoles, and coming back finds the runs, the selection and the tab as they
 * were left.
 *
 * This is keyed by file rather than kept on the view because views are a
 * ten-slot cache — a console that lived on one would be thrown away by ordinary
 * navigation.
 */
export interface FileConsole {
  // Oldest first, the order the history reads in.
  runs: Run[];
  items: ConsoleItem[];
  // Which run and call is being looked at. Null means "whatever is newest",
  // which is what a file that has never been looked at wants.
  selection: RunSelection | null;
  tab: ConsoleTab;
  // Which of the two views this file is being read in. Undefined until it is
  // chosen, which is what lets a run that drew something open on its canvas
  // while an explicit choice still outranks it and sticks.
  view?: ConsoleView;
  // Whether the store has been consulted for this file yet, so it is read once
  // rather than on every visit.
  loaded: boolean;
  touchedAt: number;
}

export type RunHistory = { [fileId: string]: FileConsole };

// How much of one file's console is kept in memory. The two caps are
// independent: one run can make a thousand calls, and one file can be run a
// thousand times.
const MAX_RUNS_PER_FILE = 25;
const MAX_ITEMS_PER_FILE = 300;
// How many files hold a console at once. Past this the least recently run one is
// let go — its last runs are in the store, which is what reopening it reads.
const MAX_FILES = 50;

const EMPTY: FileConsole = { runs: [], items: [], selection: null, tab: "response", loaded: false, touchedAt: 0 };

export function fileConsole(history: RunHistory, fileId: string | undefined): FileConsole {
  return (fileId !== undefined ? history[fileId] : undefined) ?? EMPTY;
}

/**
 * Runs leave oldest first, taking their calls with them. If the calls alone
 * overflow, the oldest go and any run left holding none goes with them — except
 * one whose payloads expired in the store, which never had calls in memory and
 * whose header is the whole point of keeping it.
 */
function trim(file: FileConsole): FileConsole {
  let runs = file.runs;
  let items = file.items;

  if (runs.length > MAX_RUNS_PER_FILE) {
    runs = runs.slice(runs.length - MAX_RUNS_PER_FILE);
    const kept = new Set(runs.map((run) => run.id));
    items = items.filter((item) => kept.has(item.runId));
  }

  if (items.length > MAX_ITEMS_PER_FILE) {
    items = items.slice(items.length - MAX_ITEMS_PER_FILE);
    const withItems = new Set(items.map((item) => item.runId));
    const newest = runs[runs.length - 1]?.id;
    runs = runs.filter((run) => withItems.has(run.id) || run.payloadsExpired === true || run.id === newest);
  }

  return runs === file.runs && items === file.items ? file : { ...file, runs, items };
}

// Files are evicted by when they last ran something, so the ones being worked in
// are the ones that stay.
function evict(history: RunHistory): RunHistory {
  const ids = Object.keys(history);
  if (ids.length <= MAX_FILES) return history;

  const kept = ids.sort((a, b) => history[b].touchedAt - history[a].touchedAt).slice(0, MAX_FILES);
  const next: RunHistory = {};
  for (const id of kept) next[id] = history[id];
  return next;
}

function withFile(history: RunHistory, fileId: string, now: number, change: (file: FileConsole) => FileConsole): RunHistory {
  const current = history[fileId] ?? EMPTY;
  const changed = change(current);
  if (changed === current) return history;
  return evict({ ...history, [fileId]: trim({ ...changed, touchedAt: now }) });
}

/**
 * One press of Run. A run with no file of its own — an agent running code that
 * was never saved — is not kept: there is no console it belongs to, and the
 * caller still gets its results.
 */
export function startRun(history: RunHistory, run: Run, now: number): RunHistory {
  if (!run.fileId) return history;
  return withFile(history, run.fileId, now, (file) => ({ ...file, runs: [...file.runs, { ...run, number: nextRunNumber(file.runs) }] }));
}

// Runs are numbered per file, counting from one and never reused, so `Run 3`
// still says Run 3 after the oldest runs have been trimmed out from under it.
function nextRunNumber(runs: Run[]): number {
  return runs.reduce((highest, run) => Math.max(highest, run.number ?? 0), 0) + 1;
}

// Calls arrive more than once as they stream and settle, so a call already in
// the run is replaced rather than appended.
export function recordCall(history: RunHistory, fileId: string | undefined, runId: string, call: MethodCall, now: number): RunHistory {
  if (!fileId) return history;
  return withFile(history, fileId, now, (file) => {
    const index = file.items.findIndex((item) => item.call?.id === call.id);
    if (index > -1) {
      return { ...file, items: file.items.map((item, i) => (i === index ? { ...item, call: { ...call } } : item)) };
    }
    return { ...file, items: [...file.items, { id: newItemId(), runId, timestamp: call.timestamp, call: { ...call } }] };
  });
}

/**
 * Something the run drew. A block arrives more than once — a table paints row by
 * row, an ask is emitted as a question and again as an answer — so a block
 * already in the run is replaced in place rather than appended, which is what
 * keeps it where it was emitted instead of jumping to the end when it changes.
 */
export function recordBlock(history: RunHistory, fileId: string | undefined, runId: string, blockId: string, block: Block, now: number): RunHistory {
  if (!fileId) return history;
  return withFile(history, fileId, now, (file) => {
    const index = file.items.findIndex((item) => item.id === blockId);
    if (index > -1) {
      return { ...file, items: file.items.map((item, i) => (i === index ? { ...item, block } : item)) };
    }
    return { ...file, items: [...file.items, { id: blockId, runId, timestamp: now, block }] };
  });
}

/**
 * Which run drew a block, wherever it is. A live table is paged long after the
 * run that drew it is over, and the rows it fetches belong in that run's log —
 * the click happened on its canvas.
 */
export function findBlock(history: RunHistory, blockId: string): { fileId: string; run: Run; block: Block } | undefined {
  for (const [fileId, file] of Object.entries(history)) {
    const item = file.items.find((item) => item.id === blockId && item.block !== undefined);
    const run = item && file.runs.find((run) => run.id === item.runId);
    if (item?.block && run) return { fileId, run, block: item.block };
  }
  return undefined;
}

export function recordLogs(history: RunHistory, fileId: string | undefined, runId: string, logs: Log[], now: number): RunHistory {
  if (!fileId) return history;
  return withFile(history, fileId, now, (file) => ({ ...file, items: [...file.items, { id: newItemId(), runId, timestamp: now, logs }] }));
}

// The run's wall duration is known once the script has settled and everything it
// started has landed.
export function settleRun(history: RunHistory, fileId: string | undefined, runId: string, durationMs: number, now: number): RunHistory {
  if (!fileId) return history;
  return withFile(history, fileId, now, (file) => {
    if (!file.runs.some((run) => run.id === runId)) return file;
    return { ...file, runs: file.runs.map((run) => (run.id === runId ? { ...run, durationMs } : run)) };
  });
}

/**
 * What the store held for this file, read once and merged in underneath: runs
 * made in this session always sit above ones read back from an earlier one.
 */
export function adoptStoredRuns(history: RunHistory, fileId: string, stored: { runs: Run[]; items: ConsoleItem[] } | undefined, now: number): RunHistory {
  const file = history[fileId] ?? EMPTY;
  if (file.loaded) return history;
  if (!stored || stored.runs.length === 0) {
    return { ...history, [fileId]: { ...file, loaded: true, touchedAt: file.touchedAt || now } };
  }
  const known = new Set(file.runs.map((run) => run.id));
  const runs = stored.runs.filter((run) => !known.has(run.id));
  const items = stored.items.filter((item) => !known.has(item.runId));
  return evict({
    ...history,
    [fileId]: trim({ ...file, runs: [...runs, ...file.runs], items: [...items, ...file.items], loaded: true, touchedAt: file.touchedAt || now }),
  });
}

export function setSelection(history: RunHistory, fileId: string | undefined, selection: RunSelection | null, now: number): RunHistory {
  if (!fileId) return history;
  return withFile(history, fileId, now, (file) => (file.selection === selection ? file : { ...file, selection }));
}

export function setTab(history: RunHistory, fileId: string | undefined, tab: ConsoleTab, now: number): RunHistory {
  if (!fileId) return history;
  return withFile(history, fileId, now, (file) => (file.tab === tab ? file : { ...file, tab }));
}

// Choosing a view is a decision about how this script is being read, so it
// sticks until it is changed — a later run does not put it back.
export function setView(history: RunHistory, fileId: string | undefined, view: ConsoleView, now: number): RunHistory {
  if (!fileId) return history;
  return withFile(history, fileId, now, (file) => (file.view === view ? file : { ...file, view }));
}

// Whether the file is stopped on a question. A run keeps going when you navigate
// away from it, so the sidebar reads this to say so on a script whose canvas is
// no longer on screen to.
export function isWaitingForAnswer(file: FileConsole): boolean {
  return file.items.some((item) => item.block !== undefined && isAwaitingUser(item.block));
}

export function waitingFileIds(history: RunHistory): Set<string> {
  const waiting = new Set<string>();
  for (const [fileId, file] of Object.entries(history)) {
    if (isWaitingForAnswer(file)) waiting.add(fileId);
  }
  return waiting;
}

// Saving a scratch to disk changes what the file is called, not what it is, so
// its console moves with it. Renaming a script is the same act.
export function renameFile(history: RunHistory, oldId: string, newId: string): RunHistory {
  const file = history[oldId];
  if (!file) return history;
  const { [oldId]: _dropped, ...rest } = history;
  return {
    ...rest,
    [newId]: { ...file, runs: file.runs.map((run) => ({ ...run, fileId: newId })) },
  };
}

// Taking a file's console out, and putting it back — discarding a scratch is
// undoable, so its runs have to be able to come back with it.
export function takeFile(history: RunHistory, fileId: string): [RunHistory, FileConsole | undefined] {
  const file = history[fileId];
  if (!file) return [history, undefined];
  const { [fileId]: _dropped, ...rest } = history;
  return [rest, file];
}

export function putFile(history: RunHistory, fileId: string, file: FileConsole): RunHistory {
  return evict({ ...history, [fileId]: file });
}

export function dropFile(history: RunHistory, fileId: string): RunHistory {
  return takeFile(history, fileId)[0];
}

// Clearing a file's history leaves the file with an empty console rather than no
// console: the store has been read, and re-reading it would put back what was
// just cleared.
export function clearFile(history: RunHistory, fileId: string, now: number): RunHistory {
  return { ...history, [fileId]: { ...EMPTY, loaded: true, touchedAt: now } };
}

// A run that has not settled is still going. This is what lets a file say so in
// the sidebar while you are looking at another one.
export function isRunning(file: FileConsole): boolean {
  return file.runs.some((run) => !run.stale && run.durationMs === undefined);
}

export function runningFileIds(history: RunHistory): Set<string> {
  const running = new Set<string>();
  for (const [fileId, file] of Object.entries(history)) {
    if (isRunning(file)) running.add(fileId);
  }
  return running;
}

// Of the files that are running, the ones an agent is driving. A spinner says
// something is happening here; this is what says who started it, which is worth
// knowing about a file you never pressed Run on.
export function agentFileIds(history: RunHistory): Set<string> {
  const agent = new Set<string>();
  for (const [fileId, file] of Object.entries(history)) {
    if (file.runs.some((run) => !run.stale && run.durationMs === undefined && run.origin === "agent")) agent.add(fileId);
  }
  return agent;
}

// Whether anything the run started is still in the air, which is what the settle
// check waits on.
export function hasCallsInFlight(file: FileConsole, runId: string): boolean {
  return file.items.some((item) => item.runId === runId && item.call !== undefined && isCallInFlight(item.call));
}

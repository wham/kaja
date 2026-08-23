import { Block, isAwaitingUser } from "./blocks";
import { MethodCall } from "./kaja";
import { loopKey } from "./loopKey";
import {
  ConsoleItem,
  ConsoleTab,
  ConsoleView,
  FailureNotice,
  failureNotices,
  ItemStats,
  LogFloor,
  newItemId,
  Run,
  RunGroup,
  RunSelection,
  RunStatus,
} from "./runs";
import { RunMetrics } from "./runStats";
import { RunStrip } from "./runStrip";
import { Log, LogLevel } from "./server/api";

/**
 * The console belongs to the file: a run lands in the console of whatever it was
 * pressed on and stays there.
 *
 * None of it is React state. A call reaches the console two or three times — issued,
 * streaming, settled — and a thousand-call run writing each of those into a state
 * tree at the root of the window renders the whole window a few thousand times over.
 * So a run is an append-only buffer with its own subscribers, and React holds only
 * the small, slow-moving part: which file is on screen, and which run is selected.
 */

// How many runs one file keeps. One file can be run a thousand times.
const MAX_RUNS_PER_FILE = 25;
/**
 * How many rows one run keeps. A row is a few hundred bytes, so this is set where a
 * run stops being something anyone reads rather than where it starts to cost. Past
 * it the log says how many it stopped keeping.
 */
const MAX_ITEMS_PER_RUN = 20_000;
/**
 * How many calls in a file hold on to their payloads. The row is cheap and the
 * payload is not, so they expire separately.
 */
const MAX_PAYLOADS_PER_FILE = 500;
// Past this the least recently run file is let go — its last runs are in the store,
// which is what reopening it reads.
const MAX_FILES = 50;

class Group implements RunGroup {
  readonly items: ConsoleItem[] = [];
  readonly calls: ConsoleItem[] = [];
  readonly printed: ConsoleItem[] = [];
  // A call is not one of these, and neither is a line the script printed.
  readonly drawn: ConsoleItem[] = [];
  readonly stats = new ItemStats();
  readonly strip = new RunStrip();
  readonly metrics: RunMetrics;
  drew = false;
  dropped = 0;
  // There are a handful in a run at most, so the one it is parked on is found rather
  // than tracked.
  readonly #asked: ConsoleItem[] = [];
  /**
   * A counter over everything that happens in the run, which is the whole of how "was
   * this failure reported" is answered: a failed call remembers where it settled, the
   * run remembers where it last drew, and a failure after the last thing drawn is one
   * nothing has spoken for.
   */
  #seq = 0;
  #drawnAt = 0;
  readonly #failed = new Map<string, { item: ConsoleItem; seq: number }>();

  constructor(public run: Run) {
    this.metrics = new RunMetrics(run.startedAt);
  }

  // A script that reports its own — a table with a result column — keeps drawing past
  // them, and the canvas stays quiet.
  get unreported(): FailureNotice[] {
    if (this.#failed.size === 0) return [];
    const late = [...this.#failed.values()].filter((failure) => failure.seq > this.#drawnAt);
    return late.length === 0 ? [] : failureNotices(late.map((failure) => failure.item));
  }

  get status(): RunStatus {
    return this.stats.status;
  }

  // A run read back from the store happened in an earlier session.
  get inFlight(): boolean {
    return !this.run.stale && this.stats.inFlight;
  }

  // Its script has not returned, or something it started has not landed. A duration
  // is what a settled run has.
  get running(): boolean {
    return !this.run.stale && this.run.durationMs === undefined;
  }

  get failures(): number {
    return this.stats.failures;
  }

  get awaiting(): ConsoleItem | undefined {
    return this.#asked.find((item) => item.block !== undefined && isAwaitingUser(item.block));
  }

  append(item: ConsoleItem): boolean {
    if (this.items.length >= MAX_ITEMS_PER_RUN) {
      this.dropped++;
      return false;
    }
    this.items.push(item);
    if (item.call) this.calls.push(item);
    if (item.printed) this.printed.push(item);
    // A line the script printed is not drawing: a script whose only output is
    // `console.log` would otherwise open on a canvas with nothing on it.
    if (item.block !== undefined || (item.logs !== undefined && !item.printed)) {
      this.drawn.push(item);
      this.drew = true;
    }
    if (item.block !== undefined && isAwaitingUser(item.block)) this.#asked.push(item);
    this.stats.add(item);
    this.strip.add(item);
    this.metrics.add(item);
    this.#mark(item);
    return true;
  }

  // The same item again — a settled call, another table row, an answered question.
  // The object is the one already held, so only what is counted about it moves.
  patched(item: ConsoleItem): void {
    if (item.block !== undefined && isAwaitingUser(item.block) && !this.#asked.includes(item)) this.#asked.push(item);
    this.stats.add(item);
    this.strip.add(item);
    this.metrics.add(item);
    this.#mark(item);
  }

  // Both arrive more than once, and both only ever move the mark forward.
  #mark(item: ConsoleItem): void {
    this.#seq++;
    // Printing is not drawing: a loop that logs each iteration would otherwise speak
    // for every failure it logged past.
    if (item.block !== undefined || (item.logs !== undefined && !item.printed)) this.#drawnAt = this.#seq;
    else if (item.call?.error !== undefined) this.#failed.set(item.id, { item, seq: this.#seq });
  }
}

export class FileConsole {
  runs: Run[] = [];
  selection: RunSelection | null = null;
  tab: ConsoleTab = "response";
  // Undefined until a view has been chosen, which is what lets a run that drew
  // something open on its canvas while an explicit choice still outranks it.
  view?: ConsoleView;
  // Off by default, so the list is a clean audit of calls until asked otherwise.
  logFloor: LogFloor = "off";
  // So the store is read once rather than on every visit.
  loaded = false;
  touchedAt = 0;
  // Bumped when this console has something new to show. The whole of what React
  // subscribes to.
  version = 0;

  readonly #groups = new Map<string, Group>();
  readonly #byCall = new Map<string, ConsoleItem>();
  readonly #byItem = new Map<string, { item: ConsoleItem; group: Group }>();
  // Remembered only so that settling one is not counted as another call left out.
  readonly #ignored = new Set<string>();
  // A queue with a head rather than a shifting array: a spike pushes thousands
  // through it.
  readonly #holding: ConsoleItem[] = [];
  #held = 0;
  #ordered: RunGroup[] | null = null;

  get groups(): RunGroup[] {
    if (!this.#ordered) this.#ordered = this.runs.map((run) => this.#groups.get(run.id)!).filter(Boolean);
    return this.#ordered;
  }

  group(runId: string): RunGroup | undefined {
    return this.#groups.get(runId);
  }

  get isEmpty(): boolean {
    return this.runs.length === 0;
  }

  // What lets a file say so in the sidebar while you are looking at another one.
  get running(): boolean {
    return this.runs.some((run) => !run.stale && run.durationMs === undefined);
  }

  get agentRunning(): boolean {
    return this.runs.some((run) => !run.stale && run.durationMs === undefined && run.origin === "agent");
  }

  get waiting(): boolean {
    return this.groups.some((group) => group.awaiting !== undefined);
  }

  /**
   * Whether anything the run started is still in the air. A question the user hasn't
   * answered — or a call held for approval — counts: a run parked on the user is not
   * over, however the script that started it returned.
   */
  hasWorkInFlight(runId: string): boolean {
    const group = this.#groups.get(runId);
    return group !== undefined && group.inFlight;
  }

  startRun(run: Run): void {
    const numbered = { ...run, number: this.#nextRunNumber() };
    this.runs.push(numbered);
    this.#groups.set(numbered.id, new Group(numbered));
    this.#ordered = null;
    this.#trimRuns();
  }

  // Counting from one and never reused, so `Run 3` still says Run 3 after the oldest
  // runs have been trimmed out from under it.
  #nextRunNumber(): number {
    return this.runs.reduce((highest, run) => Math.max(highest, run.number ?? 0), 0) + 1;
  }

  #trimRuns(): void {
    if (this.runs.length <= MAX_RUNS_PER_FILE) return;
    for (const run of this.runs.splice(0, this.runs.length - MAX_RUNS_PER_FILE)) this.#groups.delete(run.id);
    this.#ordered = null;
  }

  /**
   * A call, as it is issued and again as it settles. The object is the one the client
   * is holding and going on writing to, so it is kept rather than copied: copying per
   * update is exactly the work a spike cannot afford.
   */
  recordCall(runId: string, call: MethodCall, now: number): void {
    const known = this.#byCall.get(call.id);
    if (known) {
      this.#groups.get(known.runId)?.patched(known);
      return;
    }
    if (this.#ignored.has(call.id)) return;
    const item: ConsoleItem = { id: newItemId(), runId, timestamp: call.timestamp, call, key: loopKey(call.input) };
    if (this.#append(runId, item)) {
      this.#byCall.set(call.id, item);
      this.#hold(item);
    } else {
      this.#ignored.add(call.id);
    }
    void now;
  }

  allItems(): ConsoleItem[] {
    return this.groups.flatMap((group) => group.items);
  }

  /**
   * A block arrives more than once — a table paints row by row, an ask is emitted as a
   * question and again as an answer — so one already in the run is replaced in place,
   * which keeps it where it was emitted instead of jumping to the end.
   */
  recordBlock(runId: string, blockId: string, block: Block, now: number): void {
    const known = this.#byItem.get(blockId);
    if (known) {
      known.item.block = block;
      known.group.patched(known.item);
      return;
    }
    this.#append(runId, { id: blockId, runId, timestamp: now, block });
  }

  recordLogs(runId: string, logs: Log[], now: number): void {
    this.#append(runId, { id: newItemId(), runId, timestamp: now, logs });
  }

  // One line to an item rather than gathered: the calls view draws a row per line,
  // and a row is what makes a line selectable and readable in full.
  recordPrinted(runId: string, level: LogLevel, message: string, now: number): void {
    this.#append(runId, { id: newItemId(), runId, timestamp: now, logs: [{ level, message }], printed: true });
  }

  settleRun(runId: string, durationMs: number): boolean {
    const index = this.runs.findIndex((run) => run.id === runId);
    if (index === -1) return false;
    this.runs[index] = { ...this.runs[index], durationMs };
    const group = this.#groups.get(runId);
    if (group) group.run = this.runs[index];
    this.#ordered = null;
    return true;
  }

  findBlock(blockId: string): { run: Run; block: Block } | undefined {
    const known = this.#byItem.get(blockId);
    return known?.item.block ? { run: known.group.run, block: known.item.block } : undefined;
  }

  /**
   * What the store held for this file, read once and merged in underneath: runs made
   * in this session always sit above ones read back from an earlier one.
   */
  adopt(stored: { runs: Run[]; items: ConsoleItem[] } | undefined): void {
    this.loaded = true;
    if (!stored || stored.runs.length === 0) return;

    const known = new Set(this.runs.map((run) => run.id));
    const older = stored.runs.filter((run) => !known.has(run.id));
    if (older.length === 0) return;

    const groups = new Map<string, Group>();
    for (const run of older) groups.set(run.id, new Group(run));
    this.runs = [...older, ...this.runs];
    for (const [id, group] of groups) this.#groups.set(id, group);
    for (const item of stored.items) {
      const group = groups.get(item.runId);
      if (!group) continue;
      if (group.append(item)) this.#byItem.set(item.id, { item, group });
    }
    this.#ordered = null;
    this.#trimRuns();
  }

  clear(now: number): void {
    this.runs = [];
    this.#groups.clear();
    this.#byCall.clear();
    this.#byItem.clear();
    this.#holding.length = 0;
    this.#held = 0;
    this.selection = null;
    this.#ordered = null;
    this.loaded = true;
    this.touchedAt = now;
  }

  rename(fileId: string): void {
    this.runs = this.runs.map((run) => ({ ...run, fileId }));
    for (const run of this.runs) {
      const group = this.#groups.get(run.id);
      if (group) group.run = run;
    }
    this.#ordered = null;
  }

  #append(runId: string, item: ConsoleItem): boolean {
    const group = this.#groups.get(runId);
    if (!group || !group.append(item)) return false;
    this.#byItem.set(item.id, { item, group });
    return true;
  }

  /**
   * A call keeps what it carried until enough newer calls push it out, then keeps its
   * row and loses the payload. The error is not let go — it is small, and it is what
   * the row's status is read from.
   */
  #hold(item: ConsoleItem): void {
    this.#holding.push(item);
    if (this.#holding.length - this.#held <= MAX_PAYLOADS_PER_FILE) return;
    const old = this.#holding[this.#held];
    this.#holding[this.#held] = undefined as unknown as ConsoleItem;
    this.#held++;
    if (this.#held > 4096) {
      this.#holding.splice(0, this.#held);
      this.#held = 0;
    }
    if (!old?.call) return;
    old.call.input = undefined;
    old.call.output = undefined;
    old.call.streamOutputs = old.call.streamOutputs && [];
    old.payloadsDropped = true;
  }
}

const EMPTY = new FileConsole();

export type QuietListener = (fileId: string, runId: string) => void;

/**
 * Every file's console, and the one place anything writes to one. Notification is
 * coalesced to the frame: two hundred calls landing between two paints are one
 * repaint, so the cost of a spike is the cost of drawing it.
 */
export class Consoles {
  readonly #files = new Map<string, FileConsole>();
  readonly #listeners = new Map<string, Set<() => void>>();
  readonly #flagListeners = new Set<() => void>();
  readonly #quietListeners = new Set<QuietListener>();
  readonly #dirty = new Set<string>();
  #frame: number | null = null;
  #mru: string | null = null;
  #flags = 0;
  #flagsCache: { version: number; running: Set<string>; agent: Set<string>; waiting: Set<string> } | null = null;
  // Overridable so tests can run the queue without a frame.
  schedule: (run: () => void) => void = (run) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
  };

  file(fileId: string | undefined): FileConsole {
    return (fileId !== undefined ? this.#files.get(fileId) : undefined) ?? EMPTY;
  }

  /**
   * The file's console, created if this is the first thing it has to say. The map is
   * kept in least-recently-used order, which is what eviction reads instead of sorting
   * timestamps; the reordering is skipped once a file is already the most recent.
   */
  #ensure(fileId: string, now: number): FileConsole {
    let file = this.#files.get(fileId);
    if (!file) {
      file = new FileConsole();
    } else if (this.#mru !== fileId) {
      this.#files.delete(fileId);
    }
    if (this.#mru !== fileId) {
      this.#files.set(fileId, file);
      this.#mru = fileId;
    }
    file.touchedAt = now;
    return file;
  }

  /**
   * One press of Run. A run with no file of its own is not kept: there is no console
   * it belongs to, and the caller still gets its results.
   */
  startRun(run: Run, now: number): void {
    if (!run.fileId) return;
    this.#ensure(run.fileId, now).startRun(run);
    this.#evict();
    this.#touch(run.fileId, true);
    this.#flagsChanged();
  }

  recordCall(fileId: string | undefined, runId: string, call: MethodCall, now: number): void {
    if (!fileId) return;
    this.#ensure(fileId, now).recordCall(runId, call, now);
    this.#touch(fileId);
    this.#maybeQuiet(fileId, runId);
  }

  recordBlock(fileId: string | undefined, runId: string, blockId: string, block: Block, now: number): void {
    if (!fileId) return;
    const file = this.#ensure(fileId, now);
    const wasWaiting = file.waiting;
    file.recordBlock(runId, blockId, block, now);
    // A question drawn or answered is a gesture's worth of news, not a frame's: the
    // sidebar has to say so at once.
    this.#touch(fileId, file.waiting !== wasWaiting);
    if (file.waiting !== wasWaiting) this.#flagsChanged();
    this.#maybeQuiet(fileId, runId);
  }

  recordLogs(fileId: string | undefined, runId: string, logs: Log[], now: number): void {
    if (!fileId) return;
    this.#ensure(fileId, now).recordLogs(runId, logs, now);
    this.#touch(fileId);
  }

  recordPrinted(fileId: string | undefined, runId: string, level: LogLevel, message: string, now: number): void {
    if (!fileId) return;
    this.#ensure(fileId, now).recordPrinted(runId, level, message, now);
    this.#touch(fileId);
  }

  settleRun(fileId: string | undefined, runId: string, durationMs: number, now: number): boolean {
    if (!fileId) return false;
    const file = this.#ensure(fileId, now);
    if (!file.settleRun(runId, durationMs)) return false;
    this.#touch(fileId, true);
    this.#flagsChanged();
    return true;
  }

  /**
   * Which run drew a block, wherever it is. A live table is paged long after its run
   * is over, and the rows it fetches belong in that run's log.
   */
  findBlock(blockId: string): { fileId: string; run: Run; block: Block } | undefined {
    for (const [fileId, file] of this.#files) {
      const found = file.findBlock(blockId);
      if (found) return { fileId, ...found };
    }
    return undefined;
  }

  adoptStoredRuns(fileId: string, stored: { runs: Run[]; items: ConsoleItem[] } | undefined, now: number): void {
    const file = this.#ensure(fileId, now);
    if (file.loaded) return;
    file.adopt(stored);
    this.#evict();
    this.#touch(fileId, true);
  }

  setSelection(fileId: string | undefined, selection: RunSelection | null, now: number): void {
    if (!fileId) return;
    const file = this.#ensure(fileId, now);
    if (file.selection?.runId === selection?.runId && file.selection?.itemId === selection?.itemId) return;
    file.selection = selection;
    this.#touch(fileId, true);
  }

  setTab(fileId: string | undefined, tab: ConsoleTab, now: number): void {
    if (!fileId) return;
    const file = this.#ensure(fileId, now);
    if (file.tab === tab) return;
    file.tab = tab;
    this.#touch(fileId, true);
  }

  // Choosing a view is a decision about how this script is being read, so it sticks
  // until it is changed — a later run does not put it back.
  setView(fileId: string | undefined, view: ConsoleView, now: number): void {
    if (!fileId) return;
    const file = this.#ensure(fileId, now);
    if (file.view === view) return;
    file.view = view;
    this.#touch(fileId, true);
  }

  setLogFloor(fileId: string | undefined, floor: LogFloor, now: number): void {
    if (!fileId) return;
    const file = this.#ensure(fileId, now);
    if (file.logFloor === floor) return;
    file.logFloor = floor;
    this.#touch(fileId, true);
  }

  // Clearing leaves the file with an empty console rather than no console: the store
  // has been read, and re-reading it would put back what was just cleared.
  clearFile(fileId: string, now: number): void {
    this.#ensure(fileId, now).clear(now);
    this.#touch(fileId, true);
    this.#flagsChanged();
  }

  renameFile(oldId: string, newId: string): void {
    const file = this.#files.get(oldId);
    if (!file) return;
    this.#files.delete(oldId);
    if (this.#mru === oldId) this.#mru = null;
    file.rename(newId);
    this.#files.set(newId, file);
    this.#touch(oldId, true);
    this.#touch(newId, true);
    this.#flagsChanged();
  }

  // Discarding a draft is undoable, so its runs have to be able to come back with it.
  takeFile(fileId: string): FileConsole | undefined {
    const file = this.#files.get(fileId);
    if (!file) return undefined;
    this.#files.delete(fileId);
    if (this.#mru === fileId) this.#mru = null;
    this.#touch(fileId, true);
    this.#flagsChanged();
    return file;
  }

  putFile(fileId: string, file: FileConsole): void {
    this.#files.delete(fileId);
    this.#files.set(fileId, file);
    this.#mru = fileId;
    this.#evict();
    this.#touch(fileId, true);
    this.#flagsChanged();
  }

  dropFile(fileId: string): void {
    this.takeFile(fileId);
  }

  hasWorkInFlight(fileId: string | undefined, runId: string): boolean {
    return this.file(fileId).hasWorkInFlight(runId);
  }

  // Maintained rather than scanned: three yes/no questions used to cost a walk of
  // every item of every file, on every call a script made.
  flagSets(): { running: Set<string>; agent: Set<string>; waiting: Set<string> } {
    if (this.#flagsCache?.version === this.#flags) return this.#flagsCache;
    const running = new Set<string>();
    const agent = new Set<string>();
    const waiting = new Set<string>();
    for (const [fileId, file] of this.#files) {
      if (file.running) running.add(fileId);
      if (file.agentRunning) agent.add(fileId);
      if (file.waiting) waiting.add(fileId);
    }
    this.#flagsCache = { version: this.#flags, running, agent, waiting };
    return this.#flagsCache;
  }

  subscribeFile(fileId: string, listener: () => void): () => void {
    let listeners = this.#listeners.get(fileId);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(fileId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
      if (listeners!.size === 0) this.#listeners.delete(fileId);
    };
  }

  subscribeFlags(listener: () => void): () => void {
    this.#flagListeners.add(listener);
    return () => this.#flagListeners.delete(listener);
  }

  // The settle check hangs off this rather than off every change, so a run ending
  // costs one callback and not one per call it made.
  subscribeQuiet(listener: QuietListener): () => void {
    this.#quietListeners.add(listener);
    return () => this.#quietListeners.delete(listener);
  }

  fileVersion(fileId: string | undefined): number {
    return this.file(fileId).version;
  }

  flagsVersion(): number {
    return this.#flags;
  }

  // The console has to be settled before anything reads it synchronously — a test, or
  // a run being saved.
  flush(): void {
    if (this.#frame === null) return;
    this.#frame = null;
    this.#paint();
  }

  #touch(fileId: string, immediate = false): void {
    this.#dirty.add(fileId);
    if (immediate) {
      // A gesture is news now. Only the stream of a running script is worth holding back
      // to the frame.
      this.#frame = null;
      this.#paint();
      return;
    }
    if (this.#frame !== null) return;
    this.#frame = 1;
    this.schedule(() => {
      if (this.#frame === null) return;
      this.#frame = null;
      this.#paint();
    });
  }

  #paint(): void {
    if (this.#dirty.size === 0) return;
    const dirty = [...this.#dirty];
    this.#dirty.clear();
    for (const fileId of dirty) {
      const file = this.#files.get(fileId);
      if (file) file.version++;
      for (const listener of this.#listeners.get(fileId) ?? []) listener();
    }
  }

  #flagsChanged(): void {
    this.#flags++;
    for (const listener of this.#flagListeners) listener();
  }

  #maybeQuiet(fileId: string, runId: string): void {
    if (this.file(fileId).hasWorkInFlight(runId)) return;
    for (const listener of this.#quietListeners) listener(fileId, runId);
  }

  // Files are let go in the order they were last touched.
  #evict(): void {
    while (this.#files.size > MAX_FILES) {
      const oldest = this.#files.keys().next().value;
      if (oldest === undefined) return;
      this.#files.delete(oldest);
    }
  }
}

export const consoles = new Consoles();

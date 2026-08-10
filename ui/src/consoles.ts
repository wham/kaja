import { Block, isAwaitingUser } from "./blocks";
import { CallFold } from "./callGroups";
import { MethodCall } from "./kaja";
import { loopKey } from "./loopKey";
import { ConsoleItem, ConsoleTab, ConsoleView, ItemStats, LogFloor, newItemId, Run, RunGroup, RunSelection, RunStatus } from "./runs";
import { Log, LogLevel } from "./server/api";

/**
 * The console belongs to the file. A run is made by pressing Run on something,
 * so it lands in that file's console and stays there: switching files switches
 * consoles, and coming back finds the runs, the selection and the tab as they
 * were left.
 *
 * None of it is React state. A call reaches the console two or three times — as
 * it is issued, as it streams, as it settles — and a thousand-call run that
 * writes each of those into a state tree at the root of the window renders the
 * whole window a few thousand times over. So a run is an append-only buffer with
 * its own subscribers, and what React holds is the small, slow-moving part:
 * which file is on screen, and which run is selected in it.
 */

// How many runs one file keeps. One file can be run a thousand times.
const MAX_RUNS_PER_FILE = 25;
/**
 * How many rows one run keeps. A row is a name, a key, a duration and a status —
 * a few hundred bytes — so this is set where a run stops being something anyone
 * reads rather than where it starts to cost. Past it the log says how many it
 * stopped keeping, because a log that is silently incomplete is worse than one
 * that admits where it ends.
 */
const MAX_ITEMS_PER_RUN = 20_000;
/**
 * How many calls in a file hold on to their payloads. The row is cheap and the
 * payload is not, so they expire separately: an old call keeps its place in the
 * log and loses what it carried, which is the bargain the store already makes
 * with a run read back from an earlier session.
 */
const MAX_PAYLOADS_PER_FILE = 500;
// How many files hold a console at once. Past this the least recently run one is
// let go — its last runs are in the store, which is what reopening it reads.
const MAX_FILES = 50;

class Group implements RunGroup {
  readonly items: ConsoleItem[] = [];
  readonly calls: ConsoleItem[] = [];
  readonly printed: ConsoleItem[] = [];
  readonly stats = new ItemStats();
  readonly fold = new CallFold();
  drew = false;
  dropped = 0;
  // Blocks that were at some point waiting on the user. There are a handful of
  // these in a run at most, so the one it is parked on is found rather than
  // tracked.
  readonly #asked: ConsoleItem[] = [];

  constructor(public run: Run) {}

  get entries() {
    return this.fold.entries;
  }

  get status(): RunStatus {
    return this.stats.status;
  }

  // A run read back from the store happened in an earlier session: whatever it
  // was doing then, it is not doing it now.
  get inFlight(): boolean {
    return !this.run.stale && this.stats.inFlight;
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
    // What the script drew, which is what decides the view a run opens in. A line
    // it printed is not drawing: a script whose only output is `console.log`
    // opening on its canvas would open on a canvas with nothing on it.
    if (item.block !== undefined || (item.logs !== undefined && !item.printed)) this.drew = true;
    if (item.block !== undefined && isAwaitingUser(item.block)) this.#asked.push(item);
    this.stats.add(item);
    this.fold.push(item);
    return true;
  }

  // The same item again: a call that has settled, a table that has drawn another
  // row, a question that has been answered. The object is the one already held,
  // so only what is counted about it moves.
  patched(item: ConsoleItem): void {
    if (item.block !== undefined && isAwaitingUser(item.block) && !this.#asked.includes(item)) this.#asked.push(item);
    this.stats.add(item);
    this.fold.patched(item);
  }
}

export class FileConsole {
  runs: Run[] = [];
  selection: RunSelection | null = null;
  tab: ConsoleTab = "response";
  // Undefined until a view has been chosen, which is what lets a run that drew
  // something open on its canvas while an explicit choice still outranks it.
  view?: ConsoleView;
  // How much of what a script printed the calls view mixes in. Off by default, so
  // the list is a clean audit of calls until it is asked to be something else.
  logFloor: LogFloor = "off";
  // Whether the store has been consulted for this file yet, so it is read once
  // rather than on every visit.
  loaded = false;
  touchedAt = 0;
  // Bumped when this console has something new to show. It is the whole of what
  // React subscribes to.
  version = 0;

  readonly #groups = new Map<string, Group>();
  readonly #byCall = new Map<string, ConsoleItem>();
  readonly #byItem = new Map<string, { item: ConsoleItem; group: Group }>();
  // Calls that arrived after the run stopped keeping rows. They are remembered
  // only so that settling one is not counted as another call left out.
  readonly #ignored = new Set<string>();
  // Calls still holding their payloads, oldest first. A queue with a head rather
  // than a shifting array: a spike pushes thousands through it.
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

  // A run that has not settled is still going. This is what lets a file say so
  // in the sidebar while you are looking at another one.
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
   * Whether anything the run started is still in the air, which is what the
   * settle check waits on. A question the user hasn't answered — or a call held
   * for approval — counts: a run parked on the user is not over, however the
   * script that started it returned.
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

  // Runs are numbered per file, counting from one and never reused, so `Run 3`
  // still says Run 3 after the oldest runs have been trimmed out from under it.
  #nextRunNumber(): number {
    return this.runs.reduce((highest, run) => Math.max(highest, run.number ?? 0), 0) + 1;
  }

  #trimRuns(): void {
    if (this.runs.length <= MAX_RUNS_PER_FILE) return;
    for (const run of this.runs.splice(0, this.runs.length - MAX_RUNS_PER_FILE)) this.#groups.delete(run.id);
    this.#ordered = null;
  }

  /**
   * A call, as it is issued and again as it settles. The object is the one the
   * client is holding and going on writing to, so it is kept rather than copied:
   * copying it per update is exactly the work a spike cannot afford, and the
   * console re-reads it on the next frame anyway.
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

  // Everything the file holds, in run order — what a run on its way to the store
  // is read from.
  allItems(): ConsoleItem[] {
    return this.groups.flatMap((group) => group.items);
  }

  /**
   * Something the run drew. A block arrives more than once — a table paints row
   * by row, an ask is emitted as a question and again as an answer — so a block
   * already in the run is replaced in place rather than appended, which keeps it
   * where it was emitted instead of jumping to the end when it changes.
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

  // One `console.*` call from the script. Lines are kept one to an item rather
  // than gathered: the calls view draws a row per line, and a row is what makes a
  // line selectable and therefore readable in full.
  recordPrinted(runId: string, level: LogLevel, message: string, now: number): void {
    this.#append(runId, { id: newItemId(), runId, timestamp: now, logs: [{ level, message }], printed: true });
  }

  // The run's wall duration is known once the script has settled and everything
  // it started has landed.
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
   * What the store held for this file, read once and merged in underneath: runs
   * made in this session always sit above ones read back from an earlier one.
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

  // A scratch saved to disk, or a script renamed: same console, new name.
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
   * Payload retention. A call keeps what it carried until enough newer calls
   * have arrived to push it out, and then keeps its row and loses the payload.
   * The error is not let go — it is small, and it is what the row's status is
   * read from.
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
 * Every file's console, and the one place anything writes to one. Notification
 * is coalesced to the frame: two hundred calls landing between two paints are
 * one repaint, which is what makes the cost of a spike the cost of drawing it
 * rather than the cost of the calls.
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
   * The file's console, created if this is the first thing it has to say. The
   * map is kept in least-recently-used order — a file being touched moves it to
   * the end — which is what eviction reads instead of sorting timestamps. A run
   * in full flow touches the same file over and over, so the reordering is
   * skipped once it is already the most recent.
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
   * One press of Run. A run with no file of its own — an agent running code that
   * was never saved — is not kept: there is no console it belongs to, and the
   * caller still gets its results.
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
    // A question drawn or answered is a gesture's worth of news, not a frame's:
    // the sidebar has to say so at once.
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
   * Which run drew a block, wherever it is. A live table is paged long after the
   * run that drew it is over, and the rows it fetches belong in that run's log —
   * the click happened on its canvas.
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

  // Choosing a view is a decision about how this script is being read, so it
  // sticks until it is changed — a later run does not put it back.
  setView(fileId: string | undefined, view: ConsoleView, now: number): void {
    if (!fileId) return;
    const file = this.#ensure(fileId, now);
    if (file.view === view) return;
    file.view = view;
    this.#touch(fileId, true);
  }

  // Whether the calls view mixes in what the script printed, and down to which
  // level. Kept beside the view because it is the same kind of decision.
  setLogFloor(fileId: string | undefined, floor: LogFloor, now: number): void {
    if (!fileId) return;
    const file = this.#ensure(fileId, now);
    if (file.logFloor === floor) return;
    file.logFloor = floor;
    this.#touch(fileId, true);
  }

  // Clearing a file's history leaves the file with an empty console rather than
  // no console: the store has been read, and re-reading it would put back what
  // was just cleared.
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

  // Taking a console out, and putting it back — discarding a scratch is
  // undoable, so its runs have to be able to come back with it.
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

  // Which files have something to say in the sidebar. Maintained rather than
  // scanned: three yes/no questions used to cost a walk of every item of every
  // file, on every call a script made.
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

  // A run whose last work has landed. The settle check hangs off this rather
  // than off every change, so a run ending costs one callback and not one per
  // call it made.
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

  // Run whatever the frame was going to do, now. The console has to be settled
  // before anything reads it synchronously — a test, or a run being saved.
  flush(): void {
    if (this.#frame === null) return;
    this.#frame = null;
    this.#paint();
  }

  #touch(fileId: string, immediate = false): void {
    this.#dirty.add(fileId);
    if (immediate) {
      // A gesture — a click, a run starting or ending — is news now. Only the
      // stream of a running script is worth holding back to the frame.
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

  // Files are let go in the order they were last touched, so the ones being
  // worked in are the ones that stay.
  #evict(): void {
    while (this.#files.size > MAX_FILES) {
      const oldest = this.#files.keys().next().value;
      if (oldest === undefined) return;
      this.#files.delete(oldest);
    }
  }
}

// One store for the window, the way the workspace's storage and the tree's
// ledger are one.
export const consoles = new Consoles();

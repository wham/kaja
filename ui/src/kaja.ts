import { IMessageType } from "@protobuf-ts/runtime";
import { Method, Service } from "./apps";
import { parseInteger } from "./ask";
import {
  ApproveBlock,
  ApproveGesture,
  AskBlock,
  Block,
  CellStatus,
  cellStatus,
  CodeBlock,
  formatCell,
  newBlockId,
  TableBlock,
  TextBlock,
  withCellStatus,
  withoutRowStatus,
} from "./blocks";
import { LogSink } from "./scriptConsole";
import { CellRef, pageSizeOf } from "./tableView";
import { rememberValues } from "./typeMemory";

// Thrown when the user cancels a `kaja.ask*` prompt. The task runner
// swallows it so a cancelled prompt quietly stops the script.
export class AskCancelledError extends Error {
  constructor() {
    super("Kaja prompt cancelled");
    this.name = "AskCancelledError";
  }
}

// Thrown when the user doesn't approve a `kaja.approve(...)` call. The task
// runner swallows it too: not approving stops the script rather than failing it.
export class ApprovalRejectedError extends Error {
  constructor() {
    super("The call was not approved");
    this.name = "ApprovalRejectedError";
  }
}

/**
 * A call that hasn't been made yet.
 *
 * **A call starts when it is awaited — or at the end of the tick, if nothing has
 * claimed it.** So `await Shows.ListShows({})` and a bare `Shows.Ping({})` both
 * do what they read as, and `Promise.all([A(), B()])` still runs both at once;
 * starting is idempotent, so it doesn't matter which of the two gets there.
 *
 * That gap of one tick is the whole of what `kaja.approve(...)` needs: the call
 * is written inside its parentheses, so approve is handed it in the same
 * synchronous turn and claims it before the tick can end.
 */
export class Call<T> implements PromiseLike<T> {
  // What the call is, for a canvas that has to name it before it happens.
  readonly label: string;
  readonly input: unknown;
  #send: () => Promise<T>;
  #sent?: Promise<T>;
  #claimed = false;

  constructor(label: string, input: unknown, send: () => Promise<T>) {
    this.label = label;
    this.input = input;
    this.#send = send;
    queueMicrotask(() => {
      if (!this.#claimed) this.start();
    });
  }

  /** Whether the request has gone out. Approving one that has is too late. */
  get started(): boolean {
    return this.#sent !== undefined;
  }

  /**
   * Take the call out of the tick's hands: from here it goes out only when
   * something starts it, however long that takes. `kaja.approve` claims a call
   * before its own first await — the same synchronous turn the call was written
   * in — which is the whole of how it can hold one back.
   */
  claim(): void {
    this.#claimed = true;
  }

  /** Send the request, or hand back the one already in flight. */
  start(): Promise<T> {
    if (!this.#sent) this.#sent = this.#send();
    return this.#sent;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.start().then(onfulfilled, onrejected);
  }
}

// The question is asked by the block; this is what waits for it to be answered.
// The whole block goes, not just its text, because what is being asked for
// decides what is drawn. The id is what the answer comes back against, so an ask
// on a canvas nobody is looking at is still the one that resolves.
export interface AskRequest {
  (question: AskBlock, blockId: string): Promise<string>;
}

/** An option askSelect offers when the label isn't the value. */
export interface Choice<V> {
  label: string;
  value: V;
}

// Which of the two approving gestures was made: this call, or this call and
// every later one to the same method.
export type ApproveDecision = Exclude<ApproveGesture, "rejected">;

// The same, for a call held back until it is approved: it resolves when the call
// may go out, and rejects when the script is to stop instead. The block travels
// with it for the same reason a question's does — a run with no canvas asks in a
// dialog, which has nothing but what it is handed.
export interface ApproveRequest {
  (call: ApproveBlock, blockId: string): Promise<ApproveDecision>;
}

// A block arriving, or the same block again with more in it.
export interface BlockUpdate {
  (blockId: string, block: Block): void;
}

/**
 * A table that is still being filled in. A loop is the reason tables exist here,
 * so rows land one at a time and the canvas repaints as they do — waiting for
 * the loop to finish would make the interesting part the part you can't watch.
 */
export interface Table {
  row(...cells: Cell[]): Row;
  column(name: string): void;
  total(count: number | undefined): void;
}

/**
 * A row that is already on the canvas. **Updating one is writing it again** —
 * the same cells in the same order `row` took them — because a row is only ever
 * the whole of itself: naming a cell would need the columns to be keys, and
 * restating two cells that didn't change is the cheaper of the two. That is what
 * a summary table is: a row declared when the work starts and rewritten when it
 * finishes, so the table paints rather than reporting at the end.
 */
export interface Row {
  update(...cells: Cell[]): void;
}

/**
 * A cell the script has, or one it is getting. A **promise** is work already
 * started; a **function** is work nobody has asked for yet, so the table asks —
 * when the row is drawn, and again if you retry it. An `Error`, thrown or
 * returned, is a cell that stopped rather than a value.
 *
 * It is `unknown` to TypeScript, which is what it has always been. The alias is
 * where the rule is written down.
 */
export type Cell = unknown | PromiseLike<unknown> | (() => unknown);

/**
 * Rows a table draws. An array is an iterable; so is an async generator, and one
 * of those only runs when something pulls it — which is what makes paging fetch
 * a page and nothing else.
 */
export type Rows = Iterable<unknown[]> | AsyncIterable<unknown[]>;

/**
 * …or a source Kaja can start, which is what a server-side search needs: a new
 * search is a new result set, so the source is restarted with the text in hand.
 * A source that doesn't declare the parameter never sees it, and the search box
 * filters the rows already loaded instead.
 */
export type RowSource = Rows | ((search: string) => Rows);

export interface TableOptions {
  pageSize?: number;
}

/**
 * A cell the table is getting rather than holding. The closure beside the
 * block's `CellStatus`, on the same rule the source is: the block is JSON the
 * console stores, and a function can't be.
 */
interface LiveCell {
  // The work, while nobody has asked for it — a function that hasn't been
  // called, or a failed one waiting on Retry. A promise never has one: it was
  // already running when the script handed it over, and can't be run again.
  open?: () => unknown;
  running?: Promise<void>;
  // The row's revision when this cell was declared. A row rewritten since is not
  // the row this answers, so the answer is dropped rather than written over it.
  revision: number;
}

// What a live table is filled from. The block is the JSON the console stores;
// this is the closure beside it, which is why it lives on the Kaja instance —
// that outlives any one run, and a table stays live after the script is over.
interface LiveTable {
  block: TableBlock;
  // Absent on a table that was handed its rows outright. Such a table is held
  // here anyway once it has a cell that isn't a value: what is kept is the
  // closures, and a cell is one.
  open?: (search: string) => Rows;
  iterator?: Iterator<unknown[]> | AsyncIterator<unknown[]>;
  // Whether the source can be started again. A function can be; an iterable that
  // is already running cannot, so it has neither a server search nor a retry
  // that gets anywhere.
  restartable: boolean;
  // A generator that threw is finished — JavaScript says so, not us — so a retry
  // is only a retry if the source can be opened again, from the top.
  restart?: boolean;
  search: string;
  // Bumped when the source is restarted, so a pull that is mid-flight when the
  // search changes drops what it was doing instead of appending to the new set.
  generation: number;
  pulling?: Promise<void>;
  // The first page, which is pulled a microtask after the table is drawn. It is
  // held apart from `pulling` because it settles before that one is set, and the
  // run waits for both.
  first?: Promise<void>;
  // The cells that aren't values, by row and then column, so rewriting a row
  // lets go of everything that was answering it in one move.
  cells: Map<number, Map<number, LiveCell>>;
  // Bumped every time a row is written and never reset — a revision that started
  // over would let a cell declared before a restart answer the row that replaced
  // it, which is the one thing this exists to prevent.
  revision: number;
  rowRevision: number[];
  // Every cell still outstanding, which is what the run waits for…
  running: Set<Promise<void>>;
  // …and the ones past the gate, which is what the next one waits for. Two sets
  // rather than a count: a cell waiting for a slot is outstanding but not in
  // flight, and racing a set that holds the waiters is a race nobody wins.
  inFlight: Set<Promise<void>>;
}

// Live sources are closures, so they are held rather than collected. A console
// that has drawn hundreds of tables lets the oldest go; those tables read as
// expired, which is a state the canvas already states.
const MAX_LIVE_TABLES = 24;

/**
 * How many of a table's cells are fetched at once. A page draw asks for every
 * cell it can see in one go, and fifty rows must not put fifty requests on the
 * wire in one frame — they arrive as a rolling handful instead, in the order
 * they were declared.
 */
const MAX_CELLS_IN_FLIGHT = 6;

/**
 * How many calls to one method a run reads remembered values out of. The
 * completion list keeps a handful per field, so the ones after this would offer
 * nothing the first few didn't — and a loop is exactly where that adds up.
 */
const SAMPLED_CALLS_PER_METHOD = 5;

function isAsyncIterable(value: any): value is AsyncIterable<unknown[]> {
  return value != null && typeof value[Symbol.asyncIterator] === "function";
}

function isIterable(value: any): value is Iterable<unknown[]> {
  return value != null && typeof value[Symbol.iterator] === "function";
}

function openIterator(rows: Rows): Iterator<unknown[]> | AsyncIterator<unknown[]> {
  if (isAsyncIterable(rows)) return rows[Symbol.asyncIterator]();
  return (rows as Iterable<unknown[]>)[Symbol.iterator]();
}

// A row is cells. Anything else a source yields is one cell rather than an
// error, on the same rule formatCell follows: readable beats correct-or-nothing.
function toCells(row: unknown): unknown[] {
  return Array.isArray(row) ? row : [row];
}

// A cell that is already running. A Call is one of these, so a method handed
// straight to a table is a cell the table waits for.
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === "function";
}

function cellFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A row is as wide as the table. Fewer cells than columns draws blanks rather
// than a ragged edge, which is what lets a row be written before the work that
// fills it is done; more are left alone, since dropping them would hide what the
// script had.
function padCells(cells: string[], width: number): string[] {
  return cells.length >= width ? cells : [...cells, ...new Array(width - cells.length).fill("")];
}

// The request a call is holding, as the approve block shows it. A block is
// stored as JSON, so it is text by the time it is one — and text is what the
// canvas draws either way.
function formatRequest(input: unknown): string {
  try {
    return JSON.stringify(input, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2) ?? String(input);
  } catch {
    return String(input);
  }
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// google.protobuf.Value and friends, declared structurally so they match the
// types protoc-gen-kaja generates for any app that uses them.
export interface Value {
  kind:
    | { oneofKind: "nullValue"; nullValue: 0 }
    | { oneofKind: "numberValue"; numberValue: number }
    | { oneofKind: "stringValue"; stringValue: string }
    | { oneofKind: "boolValue"; boolValue: boolean }
    | { oneofKind: "structValue"; structValue: Struct }
    | { oneofKind: "listValue"; listValue: ListValue };
}

export interface Struct {
  fields: { [key: string]: Value };
}

export interface ListValue {
  values: Value[];
}

function toValue(input: JsonValue | undefined): Value {
  if (input === null || input === undefined) {
    return { kind: { oneofKind: "nullValue", nullValue: 0 } };
  }
  switch (typeof input) {
    case "string":
      return { kind: { oneofKind: "stringValue", stringValue: input } };
    case "number":
      return { kind: { oneofKind: "numberValue", numberValue: input } };
    case "boolean":
      return { kind: { oneofKind: "boolValue", boolValue: input } };
  }
  if (Array.isArray(input)) {
    return { kind: { oneofKind: "listValue", listValue: toListValue(input) } };
  }
  return { kind: { oneofKind: "structValue", structValue: toStruct(input) } };
}

function toStruct(input: { [key: string]: JsonValue }): Struct {
  const fields: { [key: string]: Value } = {};
  for (const [name, value] of Object.entries(input)) {
    fields[name] = toValue(value);
  }
  return { fields };
}

function toListValue(input: JsonValue[]): ListValue {
  return { values: input.map((item) => toValue(item)) };
}

export class Kaja {
  readonly _internal: KajaInternal;
  // The query a `kaja://run/<script>?...` link carried, readable as
  // `kaja.input.<name>`. Empty when the script is run any other way.
  input: { [key: string]: string } = {};
  // User-defined variables, readable as `kaja.variables.<name>`. These are the
  // resolved values, including the ones kaja.json only names and this machine
  // holds - scripts are the desktop only, where there is no remote browser
  // being handed a value it shouldn't have.
  variables: { [key: string]: string } = {};
  #onAsk: AskRequest;
  #onApprove: ApproveRequest;
  #onBlockUpdate: BlockUpdate;

  constructor(onMethodCallUpdate: MethodCallUpdate, onAsk: AskRequest, onApprove: ApproveRequest, onBlockUpdate: BlockUpdate, onLog: LogSink) {
    this._internal = new KajaInternal(onMethodCallUpdate, onLog);
    this.#onAsk = onAsk;
    this.#onApprove = onApprove;
    this.#onBlockUpdate = onBlockUpdate;
  }

  /**
   * Ask the user for text. The question is drawn on the run's canvas where it
   * happened, and the canvas stops there until it is answered — the empty space
   * under it is the pause. A cancel aborts the script.
   */
  askStr(question: string): Promise<string> {
    return this.#ask({ kind: "ask", question, answerType: "str" }, (answer) => answer);
  }

  /**
   * Ask the user for a whole number. The field will not submit anything else,
   * so this always resolves with a number — the answer has been checked against
   * parseInteger on the way in, and this is a re-read rather than a second parse
   * with its own opinion.
   */
  askInt(question: string): Promise<number> {
    return this.#ask({ kind: "ask", question, answerType: "int" }, (answer) => parseInteger(answer) ?? Number.NaN);
  }

  /**
   * Ask the user to pick one of a fixed list. Strings resolve as themselves;
   * { label, value } pairs resolve as the value.
   */
  askSelect(question: string, options: readonly string[]): Promise<string>;
  askSelect<V>(question: string, options: readonly Choice<V>[]): Promise<V>;
  askSelect(question: string, options: readonly (string | Choice<any>)[]): Promise<any> {
    if (options.length === 0) throw new Error("kaja.askSelect: options must not be empty");
    const choices = options.map((option) => (typeof option === "string" ? option : formatCell(option.label)));
    return this.#ask({ kind: "ask", question, answerType: "select", choices }, (answer) => {
      // The answer comes back as the label, because that is what was on the
      // canvas and what a stored run reads back without its script. Two options
      // under one label are one option to whoever picked it, so the first is the
      // honest reading rather than an error nobody can act on.
      const picked = options[choices.indexOf(answer)] ?? options[0];
      return typeof picked === "string" ? picked : picked.value;
    });
  }

  async #ask<T>(question: AskBlock, take: (answer: string) => T): Promise<T> {
    const blockId = newBlockId();
    this.#onBlockUpdate(blockId, question);
    try {
      const answer = await this.#onAsk(question, blockId);
      this.#onBlockUpdate(blockId, { ...question, answer });
      return take(answer);
    } catch (error) {
      this.#onBlockUpdate(blockId, { ...question, cancelled: true });
      throw error;
    }
  }

  /**
   * Hold a call until it is approved. The call and the request it is about to
   * send are drawn on the run's canvas and the run stops there; approving sends
   * it and hands back the response, and not approving stops the script.
   *
   *   const show = await kaja.approve(Shows.CreateShow({ title: "Vera Lune" }));
   *
   * The call goes inside the parentheses — that is what makes it a call that
   * hasn't happened yet rather than one to be sorry about.
   *
   * The canvas also offers **Approve all**, which settles this call and every
   * later one to the same method in this run. The script never asks for that and
   * never learns of it: which calls are worth reading one by one is a decision
   * made in front of them, not written into the loop.
   */
  async approve<T>(call: Call<T>): Promise<T> {
    if (call.started) {
      throw new Error(`kaja.approve: ${call.label} has already been sent. Write the call inside it — kaja.approve(${call.label}({ … })).`);
    }
    // Before anything is awaited, or the tick this was written in would end
    // while the question was still on screen and send the call itself.
    call.claim();

    // A standing approval was given for this method earlier in the run, so this
    // call goes out without asking — and draws nothing, since a canvas of
    // decisions nobody made is what "let it run" was pressed to be rid of. The
    // call is still a card on the canvas and a row in the log, as every call is.
    if (this._internal.approvedMethods.has(call.label)) return call.start();

    const blockId = newBlockId();
    const block: ApproveBlock = { kind: "approve", method: call.label, request: formatRequest(call.input) };
    this.#onBlockUpdate(blockId, block);
    let decision: ApproveDecision;
    try {
      decision = await this.#onApprove(block, blockId);
    } catch (error) {
      this.#onBlockUpdate(blockId, { ...block, decision: "rejected" });
      throw error;
    }
    if (decision === "all") {
      this._internal.approvedMethods.add(call.label);
      this.#onBlockUpdate(blockId, { ...block, decision: "approved", standing: true });
    } else {
      this.#onBlockUpdate(blockId, { ...block, decision: "approved" });
    }
    return call.start();
  }

  /**
   * Write a line onto the run's canvas.
   *
   *   kaja.text(`Reconciling ${accounts.length} accounts`);
   */
  text(text: string): void {
    const block: TextBlock = { kind: "text", text };
    this.#onBlockUpdate(newBlockId(), block);
  }

  /**
   * Put a snippet of code on the canvas — a query a script built, a payload it
   * is about to send.
   */
  code(code: string, language?: string): void {
    const block: CodeBlock = { kind: "code", code, language };
    this.#onBlockUpdate(newBlockId(), block);
  }

  /**
   * Start a table on the canvas and hand back a handle to fill it. Rows appear
   * as they are added, so a loop paints rather than reporting at the end.
   *
   *   const table = kaja.table(["id", "name", "status"]);
   *   for (const account of accounts) table.row(account.id, account.name, "matched");
   *
   * A row hands back a handle, so a table can keep saying what is true as the
   * script runs: write the row when the work starts and update it when it ends.
   *
   *   const row = table.row(account.id, account.name, "checking…");
   *   const result = await check(account);
   *   row.update(account.id, account.name, result.status);
   *
   * A cell can be a value the script is still getting rather than one it has —
   * a promise it already started, or a function the table calls when the row is
   * drawn. The row appears with everything it has and that cell fills in after.
   *
   *   table.row(show.id, show.title, () => Ratings.GetRating({ id: show.id }));
   *
   * The rows can also be given: an array is drawn as it is, and a source is
   * pulled a page at a time as the table is paged through.
   *
   *   kaja.table(["id", "title"], async function* (search) {
   *     for (let pageToken = ""; ; ) {
   *       const page = await Shows.ListShows({ pageSize: 25, pageToken, query: search });
   *       yield* page.shows.map((show) => [show.id, show.title]);
   *       if (!(pageToken = page.nextPageToken)) return;
   *     }
   *   });
   *
   * An API that reports how many rows there are in total is the only thing that
   * knows; say it through the handle as the pages arrive, and the table states it
   * instead of counting what it has.
   *
   *   const shows = kaja.table(["id", "title"], async function* () {
   *     for (let page = 1; ; page++) {
   *       const result = await Shows.ListShows({ page });
   *       shows.total(result.totalCount);
   *       yield* result.shows.map((show) => [show.id, show.title]);
   *     }
   *   });
   */
  table(columns: string[], rows?: RowSource, options?: TableOptions): Table {
    const blockId = newBlockId();
    const block: TableBlock = { kind: "table", columns: columns.map(formatCell), rows: [], pageSize: options?.pageSize };
    const table: LiveTable = {
      block,
      restartable: false,
      search: "",
      generation: 0,
      revision: 0,
      rowRevision: [],
      cells: new Map(),
      running: new Set(),
      inFlight: new Set(),
    };
    let live = false;

    if (Array.isArray(rows)) {
      block.rows = rows.map((row, index) => this.#declareRow(blockId, table, index, toCells(row)));
    } else if (rows !== undefined) {
      if (typeof rows !== "function" && !isAsyncIterable(rows) && !isIterable(rows)) {
        throw new Error("kaja.table: rows must be an array, an iterable of rows, or a function returning one");
      }
      // A function can be started again, which is what a search that reaches the
      // server needs; an iterable that is already running cannot, so its search
      // stays local. Declaring the parameter is what asks for the text — a
      // source that ignores it would otherwise be restarted on every keystroke
      // to fetch the same page back.
      const restartable = typeof rows === "function";
      table.restartable = restartable;
      table.open = restartable ? rows : () => rows;
      block.live = true;
      block.serverSearch = restartable && rows.length > 0;
      block.loadedSearch = "";
      live = true;
      this.#openTable(blockId, table);
    }

    this.#onBlockUpdate(blockId, { ...block });
    // A live table draws its first page itself rather than waiting to be looked
    // at: the run is what fetched it, so its calls belong in the run's log — and
    // a run nobody is watching (an agent's) still reports a page of rows.
    //
    // A microtask later, though, so `const shows = kaja.table(…)` is assigned
    // before any source body runs. A source reports its total through that
    // handle, from inside its own loop, and pulling here and now would run the
    // loop while the name it reaches for is still in its dead zone.
    if (live) table.first = Promise.resolve().then(() => void this.pullTable(blockId, "", pageSizeOf(block)));

    // A new array each time, at both levels: the canvas compares what it was
    // handed against what it holds, and a row pushed or spliced into the same
    // array is invisible to it.
    const write = (index: number, cells: unknown[]) => {
      const row = this.#declareRow(blockId, table, index, cells);
      block.rows = block.rows.map((current, at) => (at === index ? row : current));
      this.#onBlockUpdate(blockId, { ...block });
    };

    return {
      row: (...cells: unknown[]): Row => {
        const index = block.rows.length;
        block.rows = [...block.rows, this.#declareRow(blockId, table, index, cells)];
        this.#onBlockUpdate(blockId, { ...block });
        return {
          update: (...cells: unknown[]) => {
            // The row a handle points at can be gone: a source that takes the
            // search is restarted from the top, and the rows it had answered a
            // question nobody is asking any more. There is nothing to rewrite,
            // so nothing happens — a handle going quiet is better than a script
            // ending on someone else's search.
            if (index < block.rows.length) write(index, cells);
          },
        };
      },
      column: (name: string) => {
        // Widening the table widens the rows it has already drawn, so the header
        // and the rows can never disagree about how many columns there are.
        block.columns = [...block.columns, formatCell(name)];
        block.rows = block.rows.map((row) => padCells(row, block.columns.length));
        this.#onBlockUpdate(blockId, { ...block });
      },
      total: (count: number | undefined) => {
        // A total is a claim about the whole set, so anything that isn't a count
        // says nothing rather than something wrong — an API that stops reporting
        // one leaves the table where a cursor-based source always is.
        block.total = typeof count === "number" && Number.isFinite(count) && count >= 0 ? Math.floor(count) : undefined;
        this.#onBlockUpdate(blockId, { ...block });
      },
    };
  }

  #tables = new Map<string, LiveTable>();

  #openTable(blockId: string, table: LiveTable): void {
    if (this.#tables.size >= MAX_LIVE_TABLES) {
      const oldest = this.#tables.keys().next();
      if (!oldest.done) this.#tables.delete(oldest.value);
    }
    this.#tables.set(blockId, table);
  }

  /** Whether this block's source is still held, which is what Next depends on. */
  hasLiveTable(blockId: string): boolean {
    return this.#tables.has(blockId);
  }

  /**
   * Write a row's cells and take note of the ones that are not values. A
   * **promise** is work the script already started, so the table only waits for
   * it; a **function** is work nobody has asked for yet, so the table asks —
   * when the row is drawn, and again if a failed one is retried. The row's
   * revision is stamped here, and it is what an answer arriving late is checked
   * against.
   */
  #declareRow(blockId: string, table: LiveTable, index: number, cells: unknown[]): string[] {
    const block = table.block;
    const revision = (table.rowRevision[index] = ++table.revision);
    // Whatever was on its way answered the row as it was, which is not the row
    // this is writing.
    table.cells.delete(index);
    block.cells = withoutRowStatus(block, index);

    const text = cells.map((cell, column) => {
      // Thrown or returned, an Error is a cell that stopped — a script that
      // hands its failures back rather than throwing them is saying the same
      // thing in the other voice. There is nothing to call again: the script had
      // the failure, not a way to repeat it.
      if (cell instanceof Error) {
        block.cells = withCellStatus(block, index, column, { error: cell.message });
        return "";
      }
      if (typeof cell === "function") return this.#awaitCell(blockId, table, index, column, revision, cell as () => unknown);
      if (isThenable(cell)) return this.#awaitCell(blockId, table, index, column, revision, undefined, cell);
      return formatCell(cell);
    });
    return padCells(text, block.columns.length);
  }

  // A cell that is not here yet: blank text, a status saying so, and the closure
  // beside the block. A table with one is held for the same reason a live one
  // is — what is kept is the closures.
  #awaitCell(blockId: string, table: LiveTable, row: number, column: number, revision: number, open?: () => unknown, started?: PromiseLike<unknown>): string {
    const cell: LiveCell = { revision, open };
    const byColumn = table.cells.get(row) ?? new Map<number, LiveCell>();
    byColumn.set(column, cell);
    table.cells.set(row, byColumn);
    table.block.cells = withCellStatus(table.block, row, column, {});
    if (!this.#tables.has(blockId)) this.#openTable(blockId, table);

    if (started !== undefined) {
      cell.running = this.#hold(
        table,
        this.#fillCell(blockId, table, cell, row, column, () => started, false),
      );
    } else if (row < pageSizeOf(table.block)) {
      // The first page is asked for with the table, on the same rule that makes
      // a live table pull its own: a run nobody is watching still fills one.
      this.#startCell(blockId, table, row, column);
    }
    return "";
  }

  /**
   * Start a cell nobody has called yet, or hand back the run it is already in.
   * Having work to do is what says it hasn't started — `open` is taken when a
   * cell starts and put back only when a retryable one fails, so a cell that
   * finished has neither work nor a way to be started twice.
   */
  #startCell(blockId: string, table: LiveTable, row: number, column: number): Promise<void> | undefined {
    const cell = table.cells.get(row)?.get(column);
    if (cell === undefined) return undefined;
    const open = cell.open;
    if (open === undefined) return cell.running;
    cell.open = undefined;

    if (cellStatus(table.block, row, column)?.error !== undefined) {
      // Asking again is what clears the last failure: the cell goes back to
      // waiting rather than reading as stopped while it is being fetched.
      table.block.cells = withCellStatus(table.block, row, column, {});
      this.#onBlockUpdate(blockId, { ...table.block });
    }
    cell.running = this.#hold(table, this.#fillCell(blockId, table, cell, row, column, open, true));
    return cell.running;
  }

  /**
   * Run a cell's work and write what comes back. A cell that fails writes the
   * failure rather than throwing it: the loop that drew the row is long over,
   * and the one place the failure belongs is the cell it happened in.
   *
   * `gated` is both halves of what a function is and a promise isn't — it waits
   * for a slot before starting, and it can be started again.
   */
  async #fillCell(blockId: string, table: LiveTable, cell: LiveCell, row: number, column: number, work: () => unknown, gated: boolean): Promise<void> {
    // A rolling handful rather than a page all at once. The wait is here, past
    // the point where the cell counts as started, so a second draw of the same
    // page doesn't queue it twice.
    while (gated && table.inFlight.size >= MAX_CELLS_IN_FLIGHT) await Promise.race([...table.inFlight]);

    const filling = (async () => {
      try {
        const value = await work();
        if (value instanceof Error) throw value;
        this.#writeCell(blockId, table, cell, row, column, formatCell(value), undefined);
      } catch (error) {
        // Put the work back where a retry finds it. A function can be called
        // again; a promise is finished, whatever it settled as.
        if (gated) cell.open = work;
        this.#writeCell(blockId, table, cell, row, column, undefined, { error: cellFailure(error), retry: gated || undefined });
      }
    })();

    if (gated) {
      table.inFlight.add(filling);
      void filling.finally(() => table.inFlight.delete(filling));
    }
    await filling;
  }

  #writeCell(blockId: string, table: LiveTable, cell: LiveCell, row: number, column: number, text: string | undefined, status: CellStatus | undefined): void {
    const block = table.block;
    // The row this answers can be gone or rewritten — a source that takes the
    // search is restarted from the top, and a row updated asked a different
    // question. Either way there is nothing here for the answer to land in.
    if (table.rowRevision[row] !== cell.revision) return;
    if (text !== undefined) {
      block.rows = block.rows.map((current, at) => (at === row ? current.map((value, index) => (index === column ? text : value)) : current));
    }
    block.cells = withCellStatus(block, row, column, status);
    this.#onBlockUpdate(blockId, { ...block });
  }

  // Everything outstanding, so the run can wait for it.
  #hold(table: LiveTable, promise: Promise<void>): Promise<void> {
    table.running.add(promise);
    void promise.finally(() => table.running.delete(promise));
    return promise;
  }

  /**
   * Start the cells a page is drawing. Asking is what is idempotent, not the
   * work: the canvas asks for every cell it can see on every frame, and a cell
   * that has started, finished or stopped is not started again. A failed one is
   * the exception it has to be — it is asked for only when someone asks.
   *
   * Resolves false when the table is gone, and the caller marks it expired on
   * the same rule a pull that finds no source does.
   */
  async pullCells(blockId: string, cells: CellRef[]): Promise<boolean> {
    const table = this.#tables.get(blockId);
    if (!table) return false;

    const started = cells
      .filter((ref) => ref.retry === true || cellStatus(table.block, ref.row, ref.column)?.error === undefined)
      .map((ref) => this.#startCell(blockId, table, ref.row, ref.column))
      .filter((promise): promise is Promise<void> => promise !== undefined);
    await Promise.all(started);
    return true;
  }

  /**
   * Fill a live table up to `want` rows, restarting its source first if it takes
   * the search text and the text has changed. Rows are emitted as they arrive,
   * so a page paints while it fills. Resolves false when the source is gone —
   * the caller marks the table expired, since it holds the block by then.
   */
  async pullTable(blockId: string, search: string, want: number): Promise<boolean> {
    const table = this.#tables.get(blockId);
    if (!table?.open) return false;

    const searched = table.block.serverSearch === true && table.search !== search;
    if (searched || table.restart) {
      // A new search is a new result set, and a retry is the same source from
      // the top: either way the rows that are here answer a question nobody is
      // asking any more.
      table.search = search;
      table.restart = false;
      table.iterator = undefined;
      table.generation++;
      table.block.rows = [];
      table.block.exhausted = false;
      table.block.loadedSearch = search;
      // The cells that were coming belonged to those rows. A revision is never
      // reused, so the ones still in flight write nothing when they land.
      table.cells.clear();
      table.rowRevision = [];
      table.block.cells = undefined;
      // A total counts a result set, and this is a different one. The source
      // reports the new one as it answers; until it does, the table says how many
      // it has and that there are more, which is what it in fact knows.
      table.block.total = undefined;
    } else if (table.pulling) {
      // Single flight: a pull already under way is filling the same table, and a
      // second one would interleave its rows with the first's.
      await table.pulling;
      return true;
    }

    const pulling = this.#fill(blockId, table, want, table.generation);
    table.pulling = pulling;
    try {
      await pulling;
    } finally {
      // A restart supersedes this pull and puts its own promise here; clearing
      // it unconditionally would report the new one as finished.
      if (table.pulling === pulling) table.pulling = undefined;
    }
    return true;
  }

  async #fill(blockId: string, table: LiveTable, want: number, generation: number): Promise<void> {
    const block = table.block;
    block.loading = true;
    block.error = undefined;
    this.#onBlockUpdate(blockId, { ...block });

    try {
      if (!table.iterator) table.iterator = openIterator(table.open!(table.search));
      while (block.rows.length < want) {
        const next = await table.iterator.next();
        // A restart happened while this was awaiting; its rows answer a search
        // nobody is looking at any more.
        if (table.generation !== generation) return;
        if (next.done) {
          block.exhausted = true;
          break;
        }
        block.rows = [...block.rows, this.#declareRow(blockId, table, block.rows.length, toCells(next.value))];
        this.#onBlockUpdate(blockId, { ...block });
      }
    } catch (error) {
      if (table.generation !== generation) return;
      // The call that failed is already a row in the run's log; this is what the
      // table says about why it stopped, and what Retry clears.
      block.error = error instanceof Error ? error.message : String(error);
      table.restart = table.restartable;
    } finally {
      if (table.generation === generation) {
        block.loading = false;
        this.#onBlockUpdate(blockId, { ...block });
      }
    }
  }

  /**
   * Resolves once no table is still filling. A script that draws a live table
   * and ends is not over until its first page has landed — those calls are the
   * run's, and the run's duration is what they cost. A cell the script handed
   * over is the same bargain one column narrower.
   */
  async settleTables(): Promise<void> {
    for (let pass = 0; pass < 8; pass++) {
      const pulling = [...this.#tables.values()]
        .flatMap((table) => [table.first, table.pulling, ...table.running])
        .filter((promise): promise is Promise<void> => promise !== undefined);
      if (pulling.length === 0) return;
      await Promise.all(pulling);
      // The first pull is over once it has been awaited; leaving it here would
      // make every later pass find work that is already done.
      for (const table of this.#tables.values()) table.first = undefined;
    }
  }

  // Builders for google.protobuf.Value, Struct and ListValue, so a field of one
  // of those types is written as the JSON it stands for.
  value(input: JsonValue): Value {
    return toValue(input);
  }

  struct(input: { [key: string]: JsonValue }): Struct {
    return toStruct(input);
  }

  listValue(input: JsonValue[]): ListValue {
    return toListValue(input);
  }

  /** A random version 4 UUID. */
  uuidV4(): string {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    // crypto.randomUUID is only available in secure contexts; fall back to
    // building a v4 UUID from random bytes.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

export interface MethodCallHeaders {
  [key: string]: string;
}

export interface MethodCall {
  id: string;
  appName: string;
  service: Service;
  method: Method;
  input: any;
  inputTypeName?: string;
  inputType?: IMessageType<any>;
  output?: any;
  outputTypeName?: string;
  outputType?: IMessageType<any>;
  streamOutputs?: any[];
  streamComplete?: boolean;
  error?: any;
  requestHeaders?: MethodCallHeaders;
  responseHeaders?: MethodCallHeaders;
  // Headers an in-process app (e.g. OpenAPI) actually exchanged with its
  // upstream REST service, surfaced separately from the gRPC-Web transport
  // headers above.
  upstreamRequestHeaders?: MethodCallHeaders;
  upstreamResponseHeaders?: MethodCallHeaders;
  url?: string;
  timestamp: number;
  // Wall-clock time the call took, set once it succeeds, fails, or its stream
  // completes. Undefined while still in flight.
  durationMs?: number;
}

export interface MethodCallUpdate {
  (methodCall: MethodCall): void;
}

// A call is in flight until it fails, produces a response, or its stream ends. A
// stream sets `output` on every message, so it can't be judged by that alone.
export function isCallInFlight(methodCall: MethodCall): boolean {
  if (methodCall.error !== undefined) return false;
  if (methodCall.streamOutputs !== undefined) return !methodCall.streamComplete;
  return methodCall.output === undefined;
}

class KajaInternal {
  // Signal of the run currently in flight, so the calls a script makes can be
  // aborted from the editor's Stop button. Undefined when nothing is running.
  abortSignal?: AbortSignal;
  /**
   * Methods that were approved for the rest of the run, by their "Service.Method"
   * label — the same identity the block names and the button offers, so what was
   * pressed and what it covers are one thing.
   *
   * The scope is the method rather than the run because that is what the button
   * can honestly say: a script that loops over one call is the case this exists
   * for, and one that also writes somewhere else asks again for that. And the
   * lifetime is the run because anything longer is a policy — cleared by
   * `runScript`, so the guard is back the next time Run is pressed.
   */
  readonly approvedMethods = new Set<string>();
  /**
   * How many calls to each method this run has already read values out of.
   * Remembering walks a request and a response with their schemas, and it feeds
   * a completion list that keeps five values per field — so a loop calling one
   * method a thousand times is nine hundred and ninety-five walks for a list
   * that was full after the first few. Cleared with the approvals, by the run.
   */
  readonly sampledMethods = new Map<string, number>();
  /**
   * Where a line the script printed goes. It is here rather than passed into
   * `runScript` because both doors — the editor's Run and the MCP server's — hold
   * the one `Kaja`, and the sink outlives any single run the way the rest of this
   * does.
   */
  readonly onLog: LogSink;
  #onMethodCallUpdate: MethodCallUpdate;

  constructor(onMethodCallUpdate: MethodCallUpdate, onLog: LogSink) {
    this.#onMethodCallUpdate = onMethodCallUpdate;
    this.onLog = onLog;
  }

  methodCallUpdate(methodCall: MethodCall) {
    if (methodCall.output && !methodCall.error) {
      const method = `${methodCall.service.name}.${methodCall.method.name}`;
      const seen = this.sampledMethods.get(method) ?? 0;
      if (seen < SAMPLED_CALLS_PER_METHOD) {
        this.sampledMethods.set(method, seen + 1);
        if (methodCall.inputTypeName) {
          rememberValues(methodCall.inputTypeName, methodCall.input, methodCall.inputType, { method, origin: "request" });
        }
        if (methodCall.outputTypeName) {
          rememberValues(methodCall.outputTypeName, methodCall.output, methodCall.outputType, { method, origin: "response" });
        }
      }
    }
    this.#onMethodCallUpdate(methodCall);
  }
}

import { IMessageType } from "@protobuf-ts/runtime";
import { Method, Service } from "./apps";
import { parseInteger } from "./ask";
import { ApproveBlock, ApproveGesture, AskBlock, Block, CodeBlock, formatCell, newBlockId, TableBlock, TextBlock } from "./blocks";
import { pageSizeOf } from "./tableView";
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
  row(...cells: unknown[]): void;
}

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

// What a live table is filled from. The block is the JSON the console stores;
// this is the closure beside it, which is why it lives on the Kaja instance —
// that outlives any one run, and a table stays live after the script is over.
interface LiveTable {
  block: TableBlock;
  open: (search: string) => Rows;
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
}

// Live sources are closures, so they are held rather than collected. A console
// that has drawn hundreds of tables lets the oldest go; those tables read as
// expired, which is a state the canvas already states.
const MAX_LIVE_TABLES = 24;

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
function toCells(row: unknown): string[] {
  return Array.isArray(row) ? row.map(formatCell) : [formatCell(row)];
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
  // Text passed in when a script is run from the macOS "Run Kaja Script" text
  // service. Scripts can read it as `kaja.input`.
  input?: string;
  // User-defined variables, readable as `kaja.variables.<name>`. These are the
  // resolved values, including the ones kaja.json only names and this machine
  // holds - scripts are the desktop only, where there is no remote browser
  // being handed a value it shouldn't have.
  variables: { [key: string]: string } = {};
  #onAsk: AskRequest;
  #onApprove: ApproveRequest;
  #onBlockUpdate: BlockUpdate;

  constructor(onMethodCallUpdate: MethodCallUpdate, onAsk: AskRequest, onApprove: ApproveRequest, onBlockUpdate: BlockUpdate) {
    this._internal = new KajaInternal(onMethodCallUpdate);
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
   */
  table(columns: string[], rows?: RowSource, options?: TableOptions): Table {
    const blockId = newBlockId();
    const block: TableBlock = { kind: "table", columns: columns.map(formatCell), rows: [], pageSize: options?.pageSize };

    if (Array.isArray(rows)) {
      block.rows = rows.map(toCells);
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
      const open = restartable ? rows : () => rows;
      block.live = true;
      block.serverSearch = restartable && rows.length > 0;
      block.loadedSearch = "";
      this.#openTable(blockId, { block, open, restartable, search: "", generation: 0 });
    }

    this.#onBlockUpdate(blockId, { ...block });
    // A live table draws its first page itself rather than waiting to be looked
    // at: the run is what fetched it, so its calls belong in the run's log — and
    // a run nobody is watching (an agent's) still reports a page of rows.
    if (block.live) void this.pullTable(blockId, "", pageSizeOf(block));

    return {
      row: (...cells: unknown[]) => {
        // A new array each time: the canvas compares what it was handed against
        // what it holds, and a row pushed into the same array is invisible to it.
        block.rows = [...block.rows, cells.map(formatCell)];
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
   * Fill a live table up to `want` rows, restarting its source first if it takes
   * the search text and the text has changed. Rows are emitted as they arrive,
   * so a page paints while it fills. Resolves false when the source is gone —
   * the caller marks the table expired, since it holds the block by then.
   */
  async pullTable(blockId: string, search: string, want: number): Promise<boolean> {
    const table = this.#tables.get(blockId);
    if (!table) return false;

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
      if (!table.iterator) table.iterator = openIterator(table.open(table.search));
      while (block.rows.length < want) {
        const next = await table.iterator.next();
        // A restart happened while this was awaiting; its rows answer a search
        // nobody is looking at any more.
        if (table.generation !== generation) return;
        if (next.done) {
          block.exhausted = true;
          break;
        }
        block.rows = [...block.rows, toCells(next.value)];
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
   * run's, and the run's duration is what they cost.
   */
  async settleTables(): Promise<void> {
    for (let pass = 0; pass < 8; pass++) {
      const pulling = [...this.#tables.values()].map((table) => table.pulling).filter((promise): promise is Promise<void> => promise !== undefined);
      if (pulling.length === 0) return;
      await Promise.all(pulling);
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
   * `runTask`, so the guard is back the next time Run is pressed.
   */
  readonly approvedMethods = new Set<string>();
  #onMethodCallUpdate: MethodCallUpdate;

  constructor(onMethodCallUpdate: MethodCallUpdate) {
    this.#onMethodCallUpdate = onMethodCallUpdate;
  }

  methodCallUpdate(methodCall: MethodCall) {
    if (methodCall.output && !methodCall.error) {
      const method = `${methodCall.service.name}.${methodCall.method.name}`;
      if (methodCall.inputTypeName) {
        rememberValues(methodCall.inputTypeName, methodCall.input, methodCall.inputType, { method, origin: "request" });
      }
      if (methodCall.outputTypeName) {
        rememberValues(methodCall.outputTypeName, methodCall.output, methodCall.outputType, { method, origin: "response" });
      }
    }
    this.#onMethodCallUpdate(methodCall);
  }
}

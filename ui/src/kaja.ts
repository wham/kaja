import { IMessageType } from "@protobuf-ts/runtime";
import { Method, Methods, Service } from "./apps";
import { APP_OF, RateLimiter, RateLimitOptions, RateLimitState } from "./rateLimit";
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
  RateLimitBlock,
  TableBlock,
  TextBlock,
  withCellStatus,
  withoutRowStatus,
  PerfBlock,
} from "./blocks";
import { classifyFailure } from "./callFailure";
import {
  combineSignals,
  describeRequest,
  fetchHost,
  fetchKey,
  fetchLabel,
  fetchRequestLine,
  holdResponse,
  rateLimitHost,
  readResponseHeaders,
} from "./fetchCall";
import { loopKey } from "./loopKey";
import { describeSchedule, PerfBody, PerfPlan, PerfReport, perfReport, PerfSchedule, PerfTestOptions, runPerfTest } from "./perfTest";
import { RunMetrics } from "./runStats";
import { LogSink } from "./scriptConsole";
import { CellRef, pageSizeOf } from "./tableView";
import { rememberValues } from "./typeMemory";

// Swallowed by the script runner: a cancelled prompt quietly stops the script.
export class AskCancelledError extends Error {
  constructor() {
    super("Kaja prompt cancelled");
    this.name = "AskCancelledError";
  }
}

// Swallowed too: not approving stops the script rather than failing it.
export class ApprovalRejectedError extends Error {
  constructor() {
    super("The call was not approved");
    this.name = "ApprovalRejectedError";
  }
}

/**
 * A call that hasn't been made yet. It starts when it is awaited — or at the end of
 * the tick, if nothing has claimed it, so a bare `Shows.Ping({})` still goes out.
 * Starting is idempotent. That one-tick gap is what `kaja.approve` needs: the call
 * is written inside its parentheses, so approve is handed it in the same
 * synchronous turn and claims it before the tick can end.
 */
export class Call<T> implements PromiseLike<T> {
  readonly label: string;
  readonly input: unknown;
  #send: () => Promise<T>;
  #readHeaders: () => MethodCallHeaders;
  #sent?: Promise<T>;
  #claimed = false;

  constructor(label: string, input: unknown, send: () => Promise<T>, readHeaders: () => MethodCallHeaders = () => ({})) {
    this.label = label;
    this.input = input;
    this.#send = send;
    this.#readHeaders = readHeaders;
    queueMicrotask(() => {
      if (!this.#claimed) this.start();
    });
  }

  /**
   * The response with the headers the API answered with beside it, which is the whole
   * of how a script reads them. Nested rather than laid over the response, so a
   * message declaring its own `headers` or `response` field is untouched.
   *
   * Asked of the call rather than of the answer, so it works written inline
   * (`await Shows.ListShows({}).withHeaders()`) and on a call already named and sent —
   * starting is idempotent, so the second is a re-read.
   */
  withHeaders(): Promise<{ response: T; headers: MethodCallHeaders }> {
    return this.start().then((response) => ({ response, headers: this.#readHeaders() }));
  }

  /** Whether the request has gone out. Approving one that has is too late. */
  get started(): boolean {
    return this.#sent !== undefined;
  }

  /**
   * Take the call out of the tick's hands. `kaja.approve` claims before its own first
   * await, which is the whole of how it can hold a call back.
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

// The whole block travels, not just its text: what is being asked for decides what
// is drawn, and the id is what the answer comes back against.
export interface AskRequest {
  (question: AskBlock, blockId: string): Promise<string>;
}

/** An option askSelect offers when the label isn't the value. */
export interface Choice<V> {
  label: string;
  value: V;
}

export type ApproveDecision = Exclude<ApproveGesture, "rejected">;

// The block travels for the same reason a question's does: a run with no canvas
// asks in a dialog, which has nothing but what it is handed.
export interface ApproveRequest {
  (call: ApproveBlock, blockId: string): Promise<ApproveDecision>;
}

export interface BlockUpdate {
  (blockId: string, block: Block): void;
}

/**
 * A live reading of what a limiter is doing, handed back by kaja.rateLimit. Every
 * member is a getter over the limiter itself rather than a snapshot, so where it is
 * declared never changes what it says.
 */
export interface RateLimit {
  readonly state: RateLimitState;
  readonly calls: number;
  readonly held: number;
  readonly waitedMs: number;
  readonly refusals: number;
  readonly limit?: number;
  readonly remaining?: number;
}

// Rows land one at a time so the canvas repaints as the loop runs.
export interface Table {
  row(...cells: Cell[]): Row;
  column(name: string): void;
  total(count: number | undefined): void;
}

/**
 * A row already on the canvas. Updating one is writing it again — the same cells in
 * the same order `row` took them.
 */
export interface Row {
  update(...cells: Cell[]): void;
}

/**
 * A cell the script has, or one it is getting. A promise is work already started; a
 * function is work nobody has asked for yet. An `Error`, thrown or returned, is a
 * cell that stopped. `unknown` to TypeScript; the alias is where the rule is written.
 */
export type Cell = unknown | PromiseLike<unknown> | (() => unknown);

export type Rows = Iterable<unknown[]> | AsyncIterable<unknown[]>;

// A source that declares the search parameter is restarted for each new search;
// one that doesn't never sees it, and the box filters what is already loaded.
export type RowSource = Rows | ((search: string) => Rows);

export interface TableOptions {
  pageSize?: number;
}

// The closure beside the block's `CellStatus`: the block is JSON the console
// stores, and a function can't be.
interface LiveCell {
  // The work, while nobody has asked for it. A promise never has one: it was already
  // running when the script handed it over, and can't be run again.
  open?: () => unknown;
  running?: Promise<void>;
  // The row's revision when this cell was declared. A row rewritten since is not
  // the row this answers, so the answer is dropped rather than written over it.
  revision: number;
}

// The closure beside the block, held on the Kaja instance because that outlives any
// one run and a table stays live after the script is over.
interface LiveTable {
  block: TableBlock;
  // Absent on a table handed its rows outright. Such a table is held here anyway once
  // it has a cell that isn't a value: what is kept is the closures.
  open?: (search: string) => Rows;
  iterator?: Iterator<unknown[]> | AsyncIterator<unknown[]>;
  // A function can be started again; an iterable already running cannot, so it has
  // neither a server search nor a retry that gets anywhere.
  restartable: boolean;
  // A generator that threw is finished, so a retry only works if the source can be
  // opened again from the top.
  restart?: boolean;
  search: string;
  // Bumped when the source is restarted, so a pull that is mid-flight when the
  // search changes drops what it was doing instead of appending to the new set.
  generation: number;
  pulling?: Promise<void>;
  // Held apart from `pulling` because it settles before that one is set, and the run
  // waits for both.
  first?: Promise<void>;
  // The cells that aren't values, by row and then column, so rewriting a row
  // lets go of everything that was answering it in one move.
  cells: Map<number, Map<number, LiveCell>>;
  // Never reset: a revision that started over would let a cell declared before a
  // restart answer the row that replaced it.
  revision: number;
  rowRevision: number[];
  running: Set<Promise<void>>;
  // Two sets rather than a count: a cell waiting for a slot is outstanding but not in
  // flight, and racing a set that holds the waiters is a race nobody wins.
  inFlight: Set<Promise<void>>;
}

// Live sources are closures, so they are held rather than collected; the oldest are
// let go and those tables read as expired.
const MAX_LIVE_TABLES = 24;

// A page draw asks for every cell it can see at once, so fifty rows must not put
// fifty requests on the wire in one frame.
const MAX_CELLS_IN_FLIGHT = 6;

// The completion list keeps a handful per field, so calls past this offer nothing
// the first few didn't — and a loop is where that adds up.
const SAMPLED_CALLS_PER_METHOD = 5;

// How often a running perf test redraws its block. Reading the metrics is real work
// and the test is the thing being measured, so the card is redrawn on its own beat
// rather than on every tick of the supervisor or every call that lands.
const PERF_DRAW_MS = 250;

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

// Anything a source yields that isn't an array is one cell rather than an error.
function toCells(row: unknown): unknown[] {
  return Array.isArray(row) ? row : [row];
}

// A Call is one of these, so a method handed straight to a table is a cell the
// table waits for.
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === "function";
}

function cellFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Fewer cells than columns draws blanks rather than a ragged edge, which is what
// lets a row be written before the work that fills it is done; extra are kept.
function padCells(cells: string[], width: number): string[] {
  return cells.length >= width ? cells : [...cells, ...new Array(width - cells.length).fill("")];
}

// A block is stored as JSON, so the request is text by the time it is one.
function formatRequest(input: unknown): string {
  try {
    return JSON.stringify(input, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2) ?? String(input);
  } catch {
    return String(input);
  }
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Declared structurally so they match the types protoc-gen-kaja generates.
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

/**
 * What one run's output is addressed to. A `Kaja` is built from one of these per
 * run, so two scripts running at once can't reach each other's console. Nothing here
 * is reassigned once the run has begun.
 */
export interface RunContext {
  onMethodCallUpdate: MethodCallUpdate;
  onAsk: AskRequest;
  onApprove: ApproveRequest;
  onBlockUpdate: BlockUpdate;
  onLog: LogSink;
  // The phases a perf test ran through. The only thing the perf half tells the console
  // about itself, and what the Stats page draws its bands from.
  onPerfSchedule?: (schedule: PerfSchedule) => void;
  // Given at the start rather than assigned afterwards, so one link's parameters can
  // never be found by the next run.
  input?: { [key: string]: string };
}

/**
 * What outlives a run: the workspace's variables, and the live tables, which are
 * paged long after the run that drew them is over and are bounded across all runs.
 */
export class KajaHost {
  // Includes values kaja.json only names: scripts are the desktop only, where there
  // is no remote browser being handed a value it shouldn't have.
  variables: { [key: string]: string } = {};
  readonly tables = new LiveTables();

  /** A fresh run, with its output already addressed. */
  run(context: RunContext): Kaja {
    return new Kaja(context, this);
  }

  /**
   * Whether this block's source is still held, which is what Next depends on. Asked of
   * the host because the canvas has only a block id and no idea which run drew it.
   */
  hasLiveTable(blockId: string): boolean {
    return this.tables.has(blockId);
  }

  /**
   * Page a table from the canvas. The run that drew it fetches — its Kaja still holds
   * the source, so the calls land in that run's log however long ago it ended.
   */
  pullTable(blockId: string, search: string, want: number): Promise<boolean> {
    return this.tables.owner(blockId)?.pullTable(blockId, search, want) ?? Promise.resolve(false);
  }

  /** Start a table's cells, on the same rule as a pull. */
  pullCells(blockId: string, cells: CellRef[]): Promise<boolean> {
    return this.tables.owner(blockId)?.pullCells(blockId, cells) ?? Promise.resolve(false);
  }
}

/**
 * Every live table, whoever drew it: `MAX_LIVE_TABLES` is a budget for the app, and
 * a page fetched from the canvas arrives knowing only a block id. Holding the owner
 * beside each table is what keeps a finished run's `Kaja` alive exactly as long as
 * something can still call into it.
 */
export class LiveTables {
  #entries = new Map<string, { table: LiveTable; owner: Kaja }>();

  open(blockId: string, table: LiveTable, owner: Kaja): void {
    if (this.#entries.size >= MAX_LIVE_TABLES) {
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }
    this.#entries.set(blockId, { table, owner });
  }

  get(blockId: string): LiveTable | undefined {
    return this.#entries.get(blockId)?.table;
  }

  has(blockId: string): boolean {
    return this.#entries.has(blockId);
  }

  owner(blockId: string): Kaja | undefined {
    return this.#entries.get(blockId)?.owner;
  }

  ownedBy(owner: Kaja): LiveTable[] {
    return [...this.#entries.values()].filter((entry) => entry.owner === owner).map((entry) => entry.table);
  }
}

export class Kaja {
  readonly _internal: KajaInternal;
  // Empty when the script is run any other way.
  readonly input: { [key: string]: string };
  #host: KajaHost;
  #onAsk: AskRequest;
  #onApprove: ApproveRequest;
  #onBlockUpdate: BlockUpdate;
  #onPerfSchedule?: (schedule: PerfSchedule) => void;

  constructor(context: RunContext, host: KajaHost = new KajaHost()) {
    this._internal = new KajaInternal(context.onMethodCallUpdate, context.onLog);
    this.#host = host;
    this.input = context.input ?? {};
    this.#onAsk = context.onAsk;
    this.#onApprove = context.onApprove;
    this.#onBlockUpdate = context.onBlockUpdate;
    this.#onPerfSchedule = context.onPerfSchedule;
  }

  // Read through to the host, so every run in flight sees the same values.
  get variables(): { [key: string]: string } {
    return this.#host.variables;
  }

  set variables(variables: { [key: string]: string }) {
    this.#host.variables = variables;
  }

  askStr(question: string): Promise<string> {
    return this.#ask({ kind: "ask", question, answerType: "str" }, (answer) => answer);
  }

  // Always resolves with a number: the answer was checked against parseInteger on the
  // way in, so this is a re-read rather than a second parse with its own opinion.
  askInt(question: string): Promise<number> {
    return this.#ask({ kind: "ask", question, answerType: "int" }, (answer) => parseInteger(answer) ?? Number.NaN);
  }

  askSelect(question: string, options: readonly string[]): Promise<string>;
  askSelect<V>(question: string, options: readonly Choice<V>[]): Promise<V>;
  askSelect(question: string, options: readonly (string | Choice<any>)[]): Promise<any> {
    if (options.length === 0) throw new Error("kaja.askSelect: options must not be empty");
    const choices = options.map((option) => (typeof option === "string" ? option : formatCell(option.label)));
    return this.#ask({ kind: "ask", question, answerType: "select", choices }, (answer) => {
      // The answer comes back as the label — what was on the canvas, and what a stored run
      // reads back without its script. Two options under one label are one option to
      // whoever picked it, so the first is the honest reading.
      const picked = options[choices.indexOf(answer)] ?? options[0];
      return typeof picked === "string" ? picked : picked.value;
    });
  }

  async #ask<T>(question: AskBlock, take: (answer: string) => T): Promise<T> {
    this.#refuseInsidePerfTest("kaja.ask*");
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
   * Hold a call until it is approved. The canvas also offers Approve all, which settles
   * every later call to the same method in this run; the script never asks for that and
   * never learns of it.
   */
  async approve<T>(call: Call<T>): Promise<T> {
    this.#refuseInsidePerfTest("kaja.approve");
    if (call.started) {
      throw new Error(`kaja.approve: ${call.label} has already been sent. Write the call inside it — kaja.approve(${call.label}({ … })).`);
    }
    // Before anything is awaited, or the tick this was written in would end
    // while the question was still on screen and send the call itself.
    call.claim();

    // A standing approval, so this goes out without asking — and draws nothing, since a
    // canvas of decisions nobody made is what it was pressed to be rid of.
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
   * Make an HTTP request. The signature and the `Response` are `fetch`'s own, and
   * inside a script body the bare name is bound to this — so there is one way to reach
   * an API kaja has no app for, and it is a call like any other: a row in the log with
   * its request and response, a share of the stats, and something `kaja.approve` and
   * `kaja.rateLimit` can be written around.
   *
   * The budget it is paced against is the host's, because that is what a fetch has
   * instead of an app.
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Call<Response> {
    const { request, headers } = describeRequest(input, init);
    const host = fetchHost(request.url);
    let methodCall: MethodCall | undefined;

    const send = async (): Promise<Response> => {
      // Before the call exists, on the same rule a service method is held under: a call
      // waiting for a budget writes no row and starts no clock.
      await this._internal.acquireRateLimit(host);

      const call: MethodCall = {
        id: crypto.randomUUID(),
        appName: host,
        // A fetch has neither, so they are what it has: who answered, and how it was
        // asked. `http` is what tells everything reading a call back that they are that
        // rather than an app's.
        service: { name: host } as Service,
        method: { name: request.method } as Method,
        http: { method: request.method, url: request.url },
        input: request,
        requestHeaders: headers,
        timestamp: Date.now(),
      };
      methodCall = call;
      this._internal.methodCallUpdate(call);

      const startedAt = performance.now();
      const { signal, release } = combineSignals([this._internal.abortSignal, init?.signal ?? undefined, input instanceof Request ? input.signal : undefined]);
      try {
        const response = await fetch(input as RequestInfo, signal ? { ...init, signal } : init);
        const held = await holdResponse(response);
        call.durationMs = Math.round(performance.now() - startedAt);
        call.responseHeaders = readResponseHeaders(response);
        if (response.ok) {
          // Never undefined: a call whose output is missing is a call still in flight to
          // everything that reads one, and a 200 with an empty body is neither.
          call.output = held.body ?? null;
        } else {
          // The shape an app's upstream failure arrives in, because that is what this is:
          // the row is labelled by the status, the response tab shows the body the API
          // sent, and the Headers view states the request line above the headers.
          call.error = {
            message: `${response.status} ${response.statusText}`.trim(),
            status: response.status,
            statusText: response.statusText,
            request: fetchRequestLine(request.method, request.url),
            body: held.body,
          };
        }
        return held.response;
      } catch (error) {
        call.durationMs = Math.round(performance.now() - startedAt);
        // No status and no code, which is what classifyFailure reads as the exchange
        // itself having broken — which for a fetch is what a thrown error means.
        call.error = { message: error instanceof Error ? error.message : String(error), request: fetchRequestLine(request.method, request.url) };
        // Rethrown, unlike a service method's failure: this is fetch, and a script that
        // wrapped it in a try/catch is written against fetch's own contract. An HTTP
        // status is not this case — that is a response, and it is handed back.
        throw error;
      } finally {
        release();
        this._internal.methodCallUpdate(call);
      }
    };

    return new Call(fetchLabel(request.method, request.url), request, send, () => callResponseHeaders(methodCall));
  }

  /**
   * Run a body over and over on a schedule. The body is one iteration: `concurrency`
   * virtual users each run it in a loop, and every call inside it is sampled.
   *
   * A failed call fails the iteration, not the test — running to the end is half of
   * what a perf test is for, and the failures are the data. The report mirrors what
   * the Stats page shows, so a script can assert its own threshold.
   */
  async perfTest(body: PerfBody, options: PerfTestOptions = {}): Promise<PerfReport> {
    if (this._internal.inPerfTest) throw new Error("kaja.perfTest: a perf test cannot be run inside another one.");
    const plan = new PerfPlan(options);
    const blockId = newBlockId();
    const scheduleLabel = describeSchedule(plan);

    // Its own metrics, fed from the same funnel the console's are, so the report and
    // the Stats page are two readings of one computation rather than two of them.
    const metrics = new RunMetrics(Date.now());
    if (plan.warmupIterations !== undefined) metrics.declareWarmup();
    const watch: MethodCallUpdate = (methodCall) => metrics.add({ id: methodCall.id, runId: "", timestamp: methodCall.timestamp, call: methodCall });
    this._internal.watchers.add(watch);
    this._internal.inPerfTest = true;

    let latest: PerfSchedule | undefined;
    let drawnAt = 0;
    const draw = (running: boolean) => {
      drawnAt = Date.now();
      // The test's own clock: what has elapsed while it runs, what it took once it is
      // over. It is what the numbers are per second of, so the card and the page are
      // reading one span.
      const elapsedMs = latest === undefined ? undefined : (latest.endedAt ?? drawnAt) - latest.startedAt;
      const stats = metrics.view(1, 1, elapsedMs);
      const block: PerfBlock = {
        kind: "perf",
        schedule: scheduleLabel,
        running: running || undefined,
        requests: stats.calls,
        failures: stats.failures,
        errorRate: stats.errorRate,
        meanRps: stats.meanRps,
        p50: stats.p50,
        p95: stats.p95,
        p99: stats.p99,
        durationMs: elapsedMs,
        excludedWarmup: stats.excludedWarmup || undefined,
        excludedFailures: stats.excludedFailures || undefined,
      };
      this.#onBlockUpdate(blockId, block);
      return stats;
    };

    draw(true);
    try {
      const outcome = await runPerfTest(body, plan, {
        signal: this._internal.abortSignal,
        onSchedule: (schedule) => {
          latest = schedule;
          // The boundary is what the exclusion is, so the console's metrics learn it
          // the moment the test does.
          if (schedule.warmupEndsAt !== undefined || schedule.endedAt !== undefined) metrics.resolveWarmup(schedule.warmupEndsAt);
          this.#onPerfSchedule?.(schedule);
        },
        onTick: () => {
          if (Date.now() - drawnAt >= PERF_DRAW_MS) draw(true);
        },
      });
      const stats = draw(false);
      return perfReport(outcome.iterations, outcome.failedIterations, stats);
    } finally {
      this._internal.inPerfTest = false;
      this._internal.watchers.delete(watch);
    }
  }

  /**
   * Watch an app's rate limit and obey it. Nothing paces until this is called: a run
   * that never asks is never slowed, which is why the limiter is a verb rather than a
   * setting.
   *
   * The app is named by any service imported from it, and that service is pointed at
   * rather than replaced — so nothing is reassigned and the name in the loop stays the
   * name in the import. Calling it twice for one app restates the options on the one
   * limiter that app has, because it has one budget.
   */
  rateLimit(target: object | string, options: RateLimitOptions = {}): RateLimit {
    // A host, because that is what a fetch has instead of an app: it is written in the
    // URL rather than configured, so it is the one thing here that may be named.
    const app = typeof target === "string" ? rateLimitHost(target) : (target as Methods | undefined)?.[APP_OF];
    if (typeof app !== "string" || app === "") {
      throw new Error(
        'kaja.rateLimit: expects a service imported from an app — kaja.rateLimit(Shows) — or the host a fetch goes to — kaja.rateLimit("api.example.com").',
      );
    }

    const existing = this._internal.limiters.get(app);
    if (existing) {
      existing.limiter.configure(options);
      this.#drawLimit(existing.blockId, existing.limiter);
      return existing.handle;
    }

    const blockId = newBlockId();
    const limiter = new RateLimiter(app, options, { onChange: () => this.#drawLimit(blockId, limiter) });
    const handle: RateLimit = {
      get state() {
        return limiter.state;
      },
      get calls() {
        return limiter.calls;
      },
      get held() {
        return limiter.held;
      },
      get waitedMs() {
        return limiter.waitedMs;
      },
      get refusals() {
        return limiter.refusals;
      },
      get limit() {
        return limiter.budget.limit;
      },
      get remaining() {
        return limiter.remaining;
      },
    };
    this._internal.limiters.set(app, { limiter, handle, blockId });
    this.#drawLimit(blockId, limiter);
    return handle;
  }

  #drawLimit(blockId: string, limiter: RateLimiter): void {
    const block: RateLimitBlock = {
      kind: "limit",
      app: limiter.app,
      state: limiter.state,
      limit: limiter.budget.limit,
      remaining: limiter.remaining,
      resetInMs: limiter.resetInMs,
      declared: limiter.declared,
      calls: limiter.calls,
      held: limiter.held,
      waitedMs: Math.round(limiter.waitedMs),
      refusals: limiter.refusals || undefined,
      waiting: limiter.waiting || undefined,
    };
    this.#onBlockUpdate(blockId, block);
  }

  #refuseInsidePerfTest(verb: string): void {
    if (!this._internal.inPerfTest) return;
    throw new Error(
      `${verb} cannot be used inside kaja.perfTest — ${verb === "kaja.approve" ? "a held call" : "a question"} would park every virtual user on one answer. Ask before the test, or take the value from kaja.input.`,
    );
  }

  text(text: string): void {
    const block: TextBlock = { kind: "text", text };
    this.#onBlockUpdate(newBlockId(), block);
  }

  code(code: string, language?: string): void {
    const block: CodeBlock = { kind: "code", code, language };
    this.#onBlockUpdate(newBlockId(), block);
  }

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
      // Declaring the parameter is what asks for the search text: a source that ignores it
      // would otherwise be restarted on every keystroke to fetch the same page back.
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
    // A microtask later, so `const shows = kaja.table(…)` is assigned before any source
    // body runs — a source reports its total through that handle, and pulling here and
    // now would run the loop while the name is still in its dead zone.
    if (live) table.first = Promise.resolve().then(() => void this.pullTable(blockId, "", pageSizeOf(block)));

    // A new array each time, at both levels: the canvas compares what it was handed
    // against what it holds, and a push or splice into the same array is invisible.
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
            // The row a handle points at can be gone — a restarted source dropped the rows it
            // had — so nothing happens rather than the script ending on someone else's search.
            if (index < block.rows.length) write(index, cells);
          },
        };
      },
      column: (name: string) => {
        // Widening the table widens the rows already drawn, so header and rows can never
        // disagree about how many columns there are.
        block.columns = [...block.columns, formatCell(name)];
        block.rows = block.rows.map((row) => padCells(row, block.columns.length));
        this.#onBlockUpdate(blockId, { ...block });
      },
      total: (count: number | undefined) => {
        // A total is a claim about the whole set, so anything that isn't a count says
        // nothing rather than something wrong.
        block.total = typeof count === "number" && Number.isFinite(count) && count >= 0 ? Math.floor(count) : undefined;
        this.#onBlockUpdate(blockId, { ...block });
      },
    };
  }

  get #tables(): LiveTables {
    return this.#host.tables;
  }

  #openTable(blockId: string, table: LiveTable): void {
    this.#tables.open(blockId, table, this);
  }

  // The row's revision is stamped here, and it is what an answer arriving late is
  // checked against.
  #declareRow(blockId: string, table: LiveTable, index: number, cells: unknown[]): string[] {
    const block = table.block;
    const revision = (table.rowRevision[index] = ++table.revision);
    // Whatever was on its way answered the row as it was, not the row being written.
    table.cells.delete(index);
    block.cells = withoutRowStatus(block, index);

    const text = cells.map((cell, column) => {
      // Thrown or returned, an Error is a cell that stopped: the script had the failure,
      // not a way to repeat it, so there is nothing to call again.
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
      // The first page is asked for with the table: a run nobody is watching still fills one.
      this.#startCell(blockId, table, row, column);
    }
    return "";
  }

  /**
   * Start a cell nobody has called yet, or hand back the run it is already in. Having
   * work to do is what says it hasn't started — `open` is taken when a cell starts and
   * put back only when a retryable one fails.
   */
  #startCell(blockId: string, table: LiveTable, row: number, column: number): Promise<void> | undefined {
    const cell = table.cells.get(row)?.get(column);
    if (cell === undefined) return undefined;
    const open = cell.open;
    if (open === undefined) return cell.running;
    cell.open = undefined;

    if (cellStatus(table.block, row, column)?.error !== undefined) {
      // Asking again clears the last failure: the cell goes back to waiting rather than
      // reading as stopped while it is being fetched.
      table.block.cells = withCellStatus(table.block, row, column, {});
      this.#onBlockUpdate(blockId, { ...table.block });
    }
    cell.running = this.#hold(table, this.#fillCell(blockId, table, cell, row, column, open, true));
    return cell.running;
  }

  // A cell that fails writes the failure rather than throwing it: the loop that drew
  // the row is long over. `gated` is both halves of what a function is and a promise
  // isn't — it waits for a slot, and it can be started again.
  async #fillCell(blockId: string, table: LiveTable, cell: LiveCell, row: number, column: number, work: () => unknown, gated: boolean): Promise<void> {
    // The wait is past the point where the cell counts as started, so a second draw of
    // the same page doesn't queue it twice.
    while (gated && table.inFlight.size >= MAX_CELLS_IN_FLIGHT) await Promise.race([...table.inFlight]);

    const filling = (async () => {
      try {
        const value = await work();
        if (value instanceof Error) throw value;
        this.#writeCell(blockId, table, cell, row, column, formatCell(value), undefined);
      } catch (error) {
        // Put the work back where a retry finds it. A function can be called again; a
        // promise is finished, whatever it settled as.
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
    // The row this answers can be gone or rewritten, so there is nothing to land in.
    if (table.rowRevision[row] !== cell.revision) return;
    if (text !== undefined) {
      block.rows = block.rows.map((current, at) => (at === row ? current.map((value, index) => (index === column ? text : value)) : current));
    }
    block.cells = withCellStatus(block, row, column, status);
    this.#onBlockUpdate(blockId, { ...block });
  }

  #hold(table: LiveTable, promise: Promise<void>): Promise<void> {
    table.running.add(promise);
    void promise.finally(() => table.running.delete(promise));
    return promise;
  }

  /**
   * Start the cells a page is drawing. Asking is idempotent, not the work: the canvas
   * asks for every visible cell on every frame. A failed one is the exception — it is
   * asked for only when someone asks. Resolves false when the table is gone.
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
   * Fill a live table up to `want` rows, restarting its source first if it takes the
   * search text and the text has changed. Resolves false when the source is gone.
   */
  async pullTable(blockId: string, search: string, want: number): Promise<boolean> {
    const table = this.#tables.get(blockId);
    if (!table?.open) return false;

    const searched = table.block.serverSearch === true && table.search !== search;
    if (searched || table.restart) {
      // A new search is a new result set, and a retry is the same source from the top.
      table.search = search;
      table.restart = false;
      table.iterator = undefined;
      table.generation++;
      table.block.rows = [];
      table.block.exhausted = false;
      table.block.loadedSearch = search;
      // A revision is never reused, so cells still in flight write nothing when they land.
      table.cells.clear();
      table.rowRevision = [];
      table.block.cells = undefined;
      // A total counts a result set, and this is a different one.
      table.block.total = undefined;
    } else if (table.pulling) {
      // Single flight: a second pull would interleave its rows with the first's.
      await table.pulling;
      return true;
    }

    const pulling = this.#fill(blockId, table, want, table.generation);
    table.pulling = pulling;
    try {
      await pulling;
    } finally {
      // A restart supersedes this pull and puts its own promise here; clearing it
      // unconditionally would report the new one as finished.
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
        // A restart happened while this was awaiting.
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
      // The call that failed is already a row in the run's log; this is what the table
      // says about why it stopped, and what Retry clears.
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
   * Resolves once no table is still filling. A live table's first page is work the
   * script started, so the run's duration covers it.
   */
  async settleTables(): Promise<void> {
    for (let pass = 0; pass < 8; pass++) {
      // This run's tables only: waiting on another run's first page here would make one
      // script's duration cover another's.
      const mine = this.#tables.ownedBy(this);
      const pulling = mine
        .flatMap((table) => [table.first, table.pulling, ...table.running])
        .filter((promise): promise is Promise<void> => promise !== undefined);
      if (pulling.length === 0) return;
      await Promise.all(pulling);
      // The first pull is over once awaited; leaving it would make every later pass find
      // work that is already done.
      for (const table of mine) table.first = undefined;
    }
  }

  // Builders for google.protobuf.Value, Struct and ListValue, so a field of one of
  // those types is written as the JSON it stands for.
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

/**
 * What a call may be made with, beyond its request. Headers are laid over the ones
 * the app is configured with, by name and without regard to case, and travel the way
 * a configured one does — a `${NAME}` reference among them is resolved by kaja rather
 * than by the script, so a script in a browser can send a value it may not read.
 */
export interface CallOptions {
  headers?: MethodCallHeaders;
}

/**
 * The headers a call is answered with, as a script reads them: the ones the API
 * itself sent where kaja carried the call for it, the transport's own where nothing
 * did — the same rule callDurationMs states about a duration.
 *
 * Names are lowercased, because gRPC metadata arrives that way and HTTP header names
 * mean the same thing in any case: the one thing a script cannot do is guess which it
 * was given.
 */
export function callResponseHeaders(methodCall: MethodCall | undefined): MethodCallHeaders {
  const headers = methodCall?.upstreamResponseHeaders ?? methodCall?.responseHeaders;
  const lowercased: MethodCallHeaders = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    lowercased[name.toLowerCase()] = value;
  }
  return lowercased;
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
  // The HTTP call a script made itself, with kaja.fetch. It has no app and no
  // generated request, so this is what says it was one — and its request line is what
  // identifies it, the way a service and a method identify every other call.
  http?: { method: string; url: string };
  timestamp: number;
  // Wall-clock time the call took, set once it succeeds, fails, or its stream
  // completes. Undefined while still in flight.
  durationMs?: number;
  // The upstream exchange as the Kaja process in the call's path measured it — the
  // call without the trip between this UI and Kaja. Absent when nothing measured it
  // (a stored run from before it existed, a call that never left this process).
  upstreamDurationMs?: number;
}

/**
 * What a call is called, wherever one is named — the log's rows, the strip, the
 * stats table, a failure notice, the report an agent reads. A service method is its
 * service and its name; a fetch has neither, so it is the verb and the host it went
 * to, and the path that tells two hundred of them apart is the row's key.
 */
export function callLabel(methodCall: MethodCall): string {
  if (methodCall.http) return fetchLabel(methodCall.http.method, methodCall.http.url);
  return `${methodCall.service.name}.${methodCall.method.name}`;
}

/**
 * The value that tells one call in a run from the next, drawn beside its name: the
 * identifying field of a request, and the path of a fetch — what varies once the verb
 * and the host are the name.
 */
export function callKey(methodCall: MethodCall): string | undefined {
  if (methodCall.http) return fetchKey(methodCall.http.url);
  return loopKey(methodCall.input);
}

/**
 * The duration a call is described by, everywhere one is shown: what the API took
 * when Kaja measured it, the whole round trip when nothing did. Both stay on the
 * call, so the Headers view can state the hop they differ by.
 */
export function callDurationMs(methodCall: MethodCall): number | undefined {
  return methodCall.upstreamDurationMs ?? methodCall.durationMs;
}

export interface MethodCallUpdate {
  (methodCall: MethodCall): void;
}

// A stream sets `output` on every message, so a call can't be judged by that alone.
export function isCallInFlight(methodCall: MethodCall): boolean {
  if (methodCall.error !== undefined) return false;
  if (methodCall.streamOutputs !== undefined) return !methodCall.streamComplete;
  return methodCall.output === undefined;
}

class KajaInternal {
  abortSignal?: AbortSignal;
  /**
   * Set while a perf test's body is running. Ten virtual users parked on one question
   * is a deadlock wearing a dialog, so the asks refuse rather than deadlock.
   */
  inPerfTest = false;
  // Every call in the run passes through methodCallUpdate, which is what lets a perf
  // test total up its own calls without a second path for them to arrive by.
  readonly watchers = new Set<MethodCallUpdate>();
  /**
   * Methods approved for the rest of the run, by their "Service.Method" label. The set
   * belongs to one run's `Kaja` and goes when it does, so the guard is back the next
   * time Run is pressed and a concurrent script can't be let through on it.
   */
  readonly approvedMethods = new Set<string>();
  /**
   * The limiters this run asked for, by app. Empty unless a script called
   * kaja.rateLimit, which is what makes doing nothing the default.
   */
  readonly limiters = new Map<string, { limiter: RateLimiter; handle: RateLimit; blockId: string }>();
  // Remembering walks a request and a response with their schemas to feed a completion
  // list that keeps five values per field, so a loop calling one method a thousand
  // times is mostly wasted walks.
  readonly sampledMethods = new Map<string, number>();
  readonly onLog: LogSink;
  #onMethodCallUpdate: MethodCallUpdate;

  constructor(onMethodCallUpdate: MethodCallUpdate, onLog: LogSink) {
    this.#onMethodCallUpdate = onMethodCallUpdate;
    this.onLog = onLog;
  }

  /**
   * Wait for this app's budget, if the run asked for one. Returns nothing at all in
   * the common case, where no script called kaja.rateLimit and there is no budget to
   * wait for — which is what makes doing nothing the default rather than a setting.
   */
  acquireRateLimit(app: string): Promise<void> | void {
    const held = this.limiters.get(app);
    if (held === undefined) return;
    return held.limiter.acquire(this.abortSignal);
  }

  /**
   * Whether a call is waiting on a budget rather than on a server. Such a call is work
   * the run still has to do, and the console cannot see it — no row is written until
   * the call is let go — so a run whose script has finished must ask here before it
   * takes a duration and stops being a running run.
   */
  hasCallsWaiting(): boolean {
    for (const held of this.limiters.values()) {
      if (held.limiter.waiting > 0) return true;
    }
    return false;
  }

  /**
   * What an answered call taught its limiter. Called once per call, on the update that
   * takes it out of flight — which is the same update that carries its headers.
   */
  #settleRateLimit(methodCall: MethodCall): void {
    const held = this.limiters.get(methodCall.appName);
    if (held === undefined) return;
    const rateLimited = methodCall.error !== undefined && classifyFailure(methodCall.error).kind === "RATE_LIMITED";
    held.limiter.settle(callResponseHeaders(methodCall), rateLimited);
  }

  methodCallUpdate(methodCall: MethodCall) {
    if (!isCallInFlight(methodCall)) this.#settleRateLimit(methodCall);
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
    for (const watch of this.watchers) watch(methodCall);
    this.#onMethodCallUpdate(methodCall);
  }
}

import { IMessageType } from "@protobuf-ts/runtime";
import { Method, Service } from "./apps";
import { AskBlock, Block, CodeBlock, formatCell, newBlockId, TableBlock, TextBlock } from "./blocks";
import { rememberValues } from "./typeMemory";

// Thrown when the user cancels a `kaja.ask(...)` prompt. The task runner
// swallows it so a cancelled prompt quietly stops the script.
export class AskCancelledError extends Error {
  constructor() {
    super("Kaja prompt cancelled");
    this.name = "AskCancelledError";
  }
}

// The question is asked by the block; this is what waits for it to be answered.
// The id is what the answer comes back against, so an ask on a canvas nobody is
// looking at is still the one that resolves.
export interface AskRequest {
  (message: string, blockId: string): Promise<string>;
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
  // UUID helpers for scripts, e.g. `kaja.uuid.v4()`.
  readonly uuid = {
    v4(): string {
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
    },
  };
  #onAsk: AskRequest;
  #onBlockUpdate: BlockUpdate;

  constructor(onMethodCallUpdate: MethodCallUpdate, onAsk: AskRequest, onBlockUpdate: BlockUpdate) {
    this._internal = new KajaInternal(onMethodCallUpdate);
    this.#onAsk = onAsk;
    this.#onBlockUpdate = onBlockUpdate;
  }

  /**
   * Pause the script and ask the user for input. The question is drawn on the
   * run's canvas where it happened, and the canvas stops there until it is
   * answered — the empty space under it is the pause. Resolves with the
   * submitted text; rejects (aborting the script) if the user cancels.
   */
  async ask(message: string): Promise<string> {
    const blockId = newBlockId();
    const question: AskBlock = { kind: "ask", question: message };
    this.#onBlockUpdate(blockId, question);
    try {
      const answer = await this.#onAsk(message, blockId);
      this.#onBlockUpdate(blockId, { ...question, answer });
      return answer;
    } catch (error) {
      this.#onBlockUpdate(blockId, { ...question, cancelled: true });
      throw error;
    }
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
   */
  table(columns: string[], rows: unknown[][] = []): Table {
    const blockId = newBlockId();
    const block: TableBlock = { kind: "table", columns: columns.map(formatCell), rows: rows.map((row) => row.map(formatCell)) };
    this.#onBlockUpdate(blockId, block);
    return {
      row: (...cells: unknown[]) => {
        // A new array each time: the canvas compares what it was handed against
        // what it holds, and a row pushed into the same array is invisible to it.
        block.rows = [...block.rows, cells.map(formatCell)];
        this.#onBlockUpdate(blockId, { ...block });
      },
    };
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

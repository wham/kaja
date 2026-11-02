import { allBuffers, subscribeBuffers } from "./textBuffer";
import type { TypeScriptMethods } from "./typescript.worker";
import type { MethodName, WorkerReply, WorkerRequest } from "./typescriptProtocol";

/**
 * The editor's TypeScript, which is a worker of Kaja's own rather than part of the
 * editor: the editor only draws what it is told, and an agent's `run_script` is checked
 * by the same worker whether or not anything is on screen.
 *
 * Every buffer is mirrored into it as it is written, which is what the worker resolves
 * an import against, so an app compiling under an open script is seen by the next
 * question asked about that script.
 */

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const programListeners = new Set<() => void>();
let programTimer: ReturnType<typeof setTimeout> | undefined;

// The program moved: any file's text changed, so what was said about every other file
// may be stale. Coalesced, because an app landing writes every one of its modules.
function programMoved() {
  if (programTimer) clearTimeout(programTimer);
  programTimer = setTimeout(() => {
    programTimer = undefined;
    for (const listener of programListeners) listener();
  }, 250);
}

function post(message: WorkerRequest) {
  start().postMessage(message);
}

// Started on first use, so a test importing anything that reaches here starts nothing.
function start(): Worker {
  if (worker) return worker;
  // A classic worker, which every webview Kaja runs in loads from its own scheme: the
  // bundle is an ES module entry with nothing to import or export, so it is a script too.
  worker = new Worker("./typescript.worker.js");
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const waiting = pending.get(reply.id);
    if (!waiting) return;
    pending.delete(reply.id);
    if (reply.error !== undefined) waiting.reject(new Error(reply.error));
    else waiting.resolve(reply.result);
  };
  for (const buffer of allBuffers()) worker.postMessage({ type: "update", path: buffer.path, text: buffer.getValue() } satisfies WorkerRequest);
  subscribeBuffers((buffer, event) => {
    if (event === "dispose") post({ type: "remove", path: buffer.path });
    else post({ type: "update", path: buffer.path, text: buffer.getValue() });
    programMoved();
  });
  return worker;
}

type Result<M extends MethodName> = ReturnType<TypeScriptMethods[M]>;

export function askTypeScript<M extends MethodName>(method: M, ...args: Parameters<TypeScriptMethods[M]>): Promise<Result<M>> {
  const id = ++nextId;
  return new Promise<Result<M>>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    post({ type: "request", id, method, args });
  });
}

// A file nobody holds a buffer for, which is how an agent's script is checked.
export function writeTypeScriptFile(path: string, text: string): void {
  post({ type: "update", path, text });
}

export function subscribeProgram(listener: () => void): () => void {
  start();
  programListeners.add(listener);
  return () => programListeners.delete(listener);
}

// The compiler's own categories (warning 0, error 1, suggestion 2, message 3).
export const DIAGNOSTIC_ERROR = 1;
export const DIAGNOSTIC_WARNING = 0;

// TypeScript numbers its syntax errors below 2000; anything above is a semantic
// complaint the run doesn't care about, since the runner erases types without checking.
export function isSyntaxCode(code: number): boolean {
  return code < 2000;
}

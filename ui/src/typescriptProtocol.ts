import type { TypeScriptMethods } from "./typescript.worker";

export type MethodName = keyof TypeScriptMethods;

export type WorkerRequest =
  { type: "update"; path: string; text: string } | { type: "remove"; path: string } | { type: "request"; id: number; method: MethodName; args: unknown[] };

export type WorkerReply = { id: number; result?: unknown; error?: string };

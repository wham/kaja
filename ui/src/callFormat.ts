import { MethodCall } from "./kaja";
import { RunStatus } from "./runs";

/**
 * How a call reads wherever it is shown. The list and the canvas describe the
 * same calls, so they describe them the same way — a duration, a status colour
 * and an error label mean one thing in Kaja, not two.
 */

/**
 * How a failed call is labelled: an upstream HTTP failure by its status, and
 * anything else by its gRPC status code. A call against an HTTP app failed
 * with a 404, not with NOT_FOUND — the gRPC code is the tunnel, not the failure.
 */
export function callErrorCode(methodCall: MethodCall): string | undefined {
  const status = methodCall.error?.status;
  if (typeof status === "number" && status > 0) return String(status);
  const code = methodCall.error?.code;
  return typeof code === "string" && code.length > 0 && code.length <= 24 ? code : undefined;
}

export function formatDuration(durationMs?: number): string | undefined {
  if (durationMs === undefined) return undefined;
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(durationMs < 10000 ? 2 : 1)} s`;
}

export function payloadBytes(content: unknown, rawText?: string): number | undefined {
  let text = rawText;
  if (text === undefined) {
    if (content === undefined) return undefined;
    try {
      text = JSON.stringify(content);
    } catch {
      return undefined;
    }
  }
  return text === undefined ? undefined : new TextEncoder().encode(text).length;
}

export function formatBytes(bytes?: number): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function statusClass(status: RunStatus): string {
  return {
    pending: "text-muted-foreground",
    streaming: "text-primary",
    success: "text-emerald-600 dark:text-emerald-400",
    error: "text-destructive",
  }[status];
}

export function dotClass(status: RunStatus): string {
  return {
    pending: "bg-muted-foreground",
    streaming: "bg-primary",
    success: "bg-emerald-500",
    error: "bg-red-500",
  }[status];
}

/**
 * How long a call's bar is, as a fraction of the widest one in its run. Finding
 * the slow call in two hundred becomes a shape you see rather than four digits
 * you read. A call still running has no length yet, and a run with nothing to
 * compare against gets no bars at all.
 */
export function barFraction(durationMs: number | undefined, slowestMs: number | undefined): number | undefined {
  if (durationMs === undefined || slowestMs === undefined || slowestMs <= 0) return undefined;
  // A very fast call still gets a visible sliver, so the column reads as a
  // measurement rather than as an empty cell.
  return Math.max(0.04, Math.min(1, durationMs / slowestMs));
}

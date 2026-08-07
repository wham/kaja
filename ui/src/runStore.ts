import { Method, Service } from "./apps";
import { unwrapEnvelope } from "./httpEnvelope";
import { MethodCall } from "./kaja";
import { ConsoleItem, Run } from "./runs";
import { Log } from "./server/api";
import { getPersistedValue, setPersistedValue } from "./storage";

// Storing code is free; storing responses is not. Headers are small and are kept
// for the last fifty files you ran something in; the payloads under them are
// dropped after a week, because expiry is only bearable when it is a stated
// state rather than a silent hole.
const MAX_STORED_RUNS = 50;
const PAYLOAD_DAYS = 7;
// A run whose payloads don't fit is stored without them rather than not at all:
// the header is still worth having, and "no longer kept" is what the screen
// already says.
const MAX_PAYLOAD_BYTES = 512 * 1024;

const STORAGE_KEY = "lastRuns";

// A call flattened to what the console needs to render it again. The message
// types can't survive the store, so the response is written already unwrapped —
// the envelope is an encoding detail, and this is display state.
interface StoredCall {
  appName: string;
  service: string;
  method: string;
  input?: unknown;
  output?: unknown;
  streamOutputs?: unknown[];
  error?: unknown;
  requestHeaders?: { [key: string]: string };
  responseHeaders?: { [key: string]: string };
  upstreamRequestHeaders?: { [key: string]: string };
  upstreamResponseHeaders?: { [key: string]: string };
  url?: string;
  timestamp: number;
  durationMs?: number;
}

interface StoredItem {
  id: string;
  timestamp: number;
  call?: StoredCall;
  logs?: Log[];
}

export interface StoredRun {
  run: Run;
  items: StoredItem[];
  storedAt: number;
}

export type RunArchive = { [sourceId: string]: StoredRun };

export interface LoadedRun {
  run: Run;
  items: ConsoleItem[];
}

function toStoredCall(call: MethodCall): StoredCall {
  return {
    appName: call.appName,
    service: call.service.name,
    method: call.method.name,
    input: call.input,
    output: call.output === undefined ? undefined : unwrapEnvelope(call.outputType, call.output),
    streamOutputs: call.streamOutputs?.map((message) => unwrapEnvelope(call.outputType, message)),
    error: call.error === undefined ? undefined : serializableError(call.error),
    requestHeaders: call.requestHeaders,
    responseHeaders: call.responseHeaders,
    upstreamRequestHeaders: call.upstreamRequestHeaders,
    upstreamResponseHeaders: call.upstreamResponseHeaders,
    url: call.url,
    timestamp: call.timestamp,
    durationMs: call.durationMs,
  };
}

// Errors reach the console as plain objects already (serializeError in
// client.ts), but a thrown Error can get here too and would store as `{}`.
function serializableError(error: any): unknown {
  if (error instanceof Error) return { message: error.message, code: error.name };
  return error;
}

function fromStoredCall(stored: StoredCall): MethodCall {
  return {
    id: `${stored.service}.${stored.method}:${stored.timestamp}`,
    appName: stored.appName,
    // Only the names survive; nothing that renders a stored run reaches past
    // them, and the response is already unwrapped so no message type is needed.
    service: { name: stored.service } as Service,
    method: { name: stored.method } as Method,
    input: stored.input,
    output: stored.output,
    streamOutputs: stored.streamOutputs,
    streamComplete: stored.streamOutputs === undefined ? undefined : true,
    error: stored.error,
    requestHeaders: stored.requestHeaders,
    responseHeaders: stored.responseHeaders,
    upstreamRequestHeaders: stored.upstreamRequestHeaders,
    upstreamResponseHeaders: stored.upstreamResponseHeaders,
    url: stored.url,
    timestamp: stored.timestamp,
    durationMs: stored.durationMs,
  };
}

export function serializeRun(run: Run, items: ConsoleItem[], now: number): StoredRun {
  const stored: StoredRun = {
    run: { ...run, stale: true, payloadsExpired: false },
    items: items.map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      call: item.call ? toStoredCall(item.call) : undefined,
      logs: item.logs,
    })),
    storedAt: now,
  };

  if (payloadBytes(stored.items) > MAX_PAYLOAD_BYTES) {
    return { ...stored, run: { ...stored.run, payloadsExpired: true }, items: [] };
  }
  return stored;
}

function payloadBytes(items: StoredItem[]): number {
  try {
    return JSON.stringify(items).length;
  } catch {
    return MAX_PAYLOAD_BYTES + 1;
  }
}

export function deserializeRun(stored: StoredRun): LoadedRun {
  return {
    run: stored.run,
    items: stored.items.map((item) => ({
      id: item.id,
      runId: stored.run.id,
      timestamp: item.timestamp,
      call: item.call ? fromStoredCall(item.call) : undefined,
      logs: item.logs,
    })),
  };
}

/**
 * Retention, applied on every read and write: a run older than a week keeps its
 * header and loses its payloads, and only the fifty most recently run files are
 * kept at all.
 */
export function pruneArchive(archive: RunArchive, now: number): RunArchive {
  const cutoff = now - PAYLOAD_DAYS * 24 * 60 * 60 * 1000;
  const entries = Object.entries(archive)
    .filter(([, stored]) => stored?.run !== undefined)
    .sort((a, b) => (b[1].run.startedAt ?? 0) - (a[1].run.startedAt ?? 0))
    .slice(0, MAX_STORED_RUNS);

  const pruned: RunArchive = {};
  for (const [sourceId, stored] of entries) {
    const expired = stored.storedAt < cutoff;
    pruned[sourceId] = expired ? { ...stored, run: { ...stored.run, payloadsExpired: true }, items: [] } : stored;
  }
  return pruned;
}

function readArchive(): RunArchive {
  return getPersistedValue<RunArchive>(STORAGE_KEY) ?? {};
}

function writeArchive(archive: RunArchive): void {
  setPersistedValue(STORAGE_KEY, archive);
}

// Only a run that finished is worth keeping: one still in flight would come back
// as a permanently pending header.
export function saveLastRun(sourceId: string, run: Run, items: ConsoleItem[], now = Date.now()): void {
  writeArchive(pruneArchive({ ...readArchive(), [sourceId]: serializeRun(run, items, now) }, now));
}

export function loadLastRun(sourceId: string, now = Date.now()): LoadedRun | undefined {
  const archive = pruneArchive(readArchive(), now);
  const stored = archive[sourceId];
  return stored ? deserializeRun(stored) : undefined;
}

export function clearArchive(): void {
  writeArchive({});
}

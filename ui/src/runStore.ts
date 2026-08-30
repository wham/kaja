import { Method, Service } from "./apps";
import { Block, isAwaitingUser } from "./blocks";
import { unwrapEnvelope } from "./httpEnvelope";
import { MethodCall } from "./kaja";
import { ConsoleItem, Run } from "./runs";
import { Log } from "./server/api";
import { getPersistedValue, setPersistedValue } from "./storage";

// Storing code is free; storing responses is not. A file keeps its last few run
// headers, the payloads under them are dropped after a week, and only the fifty most
// recently run files are kept at all — expiry is bearable when it is a stated state
// rather than a silent hole.
const MAX_STORED_FILES = 50;
const MAX_STORED_RUNS_PER_FILE = 3;
const PAYLOAD_DAYS = 7;
// The payload budget for one file, spent newest run first. A run whose payloads don't
// fit is stored without them rather than not at all.
const MAX_PAYLOAD_BYTES = 512 * 1024;

const STORAGE_KEY = "lastRuns";

// A call flattened to what the console needs to render it again. The message types
// can't survive the store, so the response is written already unwrapped.
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
  http?: { method: string; url: string };
  timestamp: number;
  durationMs?: number;
  upstreamDurationMs?: number;
}

// A block is already plain JSON, so it survives the store as itself.
interface StoredItem {
  id: string;
  timestamp: number;
  call?: StoredCall;
  logs?: Log[];
  printed?: boolean;
  block?: Block;
}

interface StoredRun {
  run: Run;
  items: StoredItem[];
}

// One file's console as it is kept between sessions: its last few runs, oldest first,
// exactly as the live list reads.
export interface StoredFile {
  runs: StoredRun[];
  storedAt: number;
}

export type RunArchive = { [fileId: string]: StoredFile };

export interface LoadedRuns {
  runs: Run[];
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
    http: call.http,
    timestamp: call.timestamp,
    durationMs: call.durationMs,
    upstreamDurationMs: call.upstreamDurationMs,
  };
}

// Errors reach the console as plain objects already (serializeError in client.ts),
// but a thrown Error can get here too and would store as `{}`.
function serializableError(error: any): unknown {
  if (error instanceof Error) return { message: error.message, code: error.name };
  return error;
}

function fromStoredCall(stored: StoredCall): MethodCall {
  return {
    id: `${stored.service}.${stored.method}:${stored.timestamp}`,
    appName: stored.appName,
    // Only the names survive; nothing that renders a stored run reaches past them, and
    // the response is already unwrapped so no message type is needed.
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
    http: stored.http,
    url: stored.url,
    timestamp: stored.timestamp,
    durationMs: stored.durationMs,
    upstreamDurationMs: stored.upstreamDurationMs,
  };
}

/**
 * A file's runs on their way into the store: the newest few, each marked as belonging
 * to an earlier session, and the payload budget spent newest first so what is dropped
 * is always the oldest thing.
 */
export function serializeFile(runs: Run[], items: ConsoleItem[], now: number): StoredFile {
  const kept = runs.slice(Math.max(0, runs.length - MAX_STORED_RUNS_PER_FILE));
  const stored: StoredRun[] = [];
  let budget = MAX_PAYLOAD_BYTES;

  // Newest first while spending, then flipped back to oldest first.
  for (let index = kept.length - 1; index >= 0; index--) {
    const run = kept[index];
    const runItems = items.filter((item) => item.runId === run.id).map(toStoredItem);
    const size = payloadBytes(runItems);
    if (run.payloadsExpired || size > budget) {
      stored.unshift({ run: { ...run, stale: true, payloadsExpired: true }, items: [] });
      continue;
    }
    budget -= size;
    stored.unshift({ run: { ...run, stale: true, payloadsExpired: false }, items: runItems });
  }

  return { runs: stored, storedAt: now };
}

function toStoredItem(item: ConsoleItem): StoredItem {
  return {
    id: item.id,
    timestamp: item.timestamp,
    call: item.call ? toStoredCall(item.call) : undefined,
    logs: item.logs,
    printed: item.printed,
    block: storedBlock(item.block),
  };
}

// A question that was never answered is stored as abandoned: the promise it was
// blocking died with the session, so reading it back as still waiting would show a run
// parked on an input nothing is listening to. A call that was never approved reads
// back the same way, and that is the truth about it too — nothing sent it.
function storedBlock(block: Block | undefined): Block | undefined {
  if (block === undefined) return undefined;
  if (block.kind === "ask" && isAwaitingUser(block)) return { ...block, cancelled: true };
  if (block.kind === "approve" && isAwaitingUser(block)) return { ...block, decision: "rejected" };
  // A live table's source is a closure, which nothing can store. It reads back as the
  // rows it had, saying so.
  if (block.kind === "table" && block.live === true && block.exhausted !== true) {
    return { ...block, live: false, loading: false, error: undefined, expired: true };
  }
  return block;
}

function payloadBytes(items: StoredItem[]): number {
  try {
    return JSON.stringify(items).length;
  } catch {
    return MAX_PAYLOAD_BYTES + 1;
  }
}

export function deserializeFile(stored: StoredFile): LoadedRuns {
  const runs: Run[] = [];
  const items: ConsoleItem[] = [];
  for (const entry of stored.runs) {
    runs.push(entry.run);
    for (const item of entry.items) {
      items.push({
        id: item.id,
        runId: entry.run.id,
        timestamp: item.timestamp,
        call: item.call ? fromStoredCall(item.call) : undefined,
        logs: item.logs,
        printed: item.printed,
        block: item.block,
      });
    }
  }
  return { runs, items };
}

/**
 * Retention, applied on every read and write: a file's runs older than a week keep
 * their headers and lose their payloads, and only the fifty most recently run files
 * are kept. An entry written by an older build has a shape this can't read and is
 * simply dropped.
 */
export function pruneArchive(archive: RunArchive, now: number): RunArchive {
  const cutoff = now - PAYLOAD_DAYS * 24 * 60 * 60 * 1000;
  const entries = Object.entries(archive)
    .filter(([, stored]) => Array.isArray(stored?.runs))
    .sort((a, b) => lastRunAt(b[1]) - lastRunAt(a[1]))
    .slice(0, MAX_STORED_FILES);

  const pruned: RunArchive = {};
  for (const [fileId, stored] of entries) {
    pruned[fileId] =
      stored.storedAt < cutoff ? { ...stored, runs: stored.runs.map((entry) => ({ run: { ...entry.run, payloadsExpired: true }, items: [] })) } : stored;
  }
  return pruned;
}

function lastRunAt(stored: StoredFile): number {
  return stored.runs[stored.runs.length - 1]?.run.startedAt ?? 0;
}

function readArchive(): RunArchive {
  return getPersistedValue<RunArchive>(STORAGE_KEY) ?? {};
}

function writeArchive(archive: RunArchive): void {
  setPersistedValue(STORAGE_KEY, archive);
}

export function saveRuns(fileId: string, runs: Run[], items: ConsoleItem[], now = Date.now()): void {
  if (runs.length === 0) {
    dropStoredFile(fileId);
    return;
  }
  writeArchive(pruneArchive({ ...readArchive(), [fileId]: serializeFile(runs, items, now) }, now));
}

export function loadRuns(fileId: string, now = Date.now()): LoadedRuns | undefined {
  const stored = pruneArchive(readArchive(), now)[fileId];
  return stored ? deserializeFile(stored) : undefined;
}

// A draft saved to disk, or a script renamed: same console, new name.
export function renameStoredFile(oldId: string, newId: string): void {
  const archive = readArchive();
  const stored = archive[oldId];
  if (!stored) return;
  const { [oldId]: _dropped, ...rest } = archive;
  writeArchive({ ...rest, [newId]: { ...stored, runs: stored.runs.map((entry) => ({ ...entry, run: { ...entry.run, fileId: newId } })) } });
}

export function dropStoredFile(fileId: string): void {
  const archive = readArchive();
  if (!(fileId in archive)) return;
  const { [fileId]: _dropped, ...rest } = archive;
  writeArchive(rest);
}

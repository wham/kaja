import { payloadStore, payloadStoreAvailable } from "./storage";

/**
 * Where a call's payload goes when it leaves the heap.
 *
 * The row is the audit record and the run keeps every one of them; the payloads under
 * them are what a run of ten thousand calls cannot hold, so the newest stay in memory
 * (`MAX_PAYLOADS_PER_FILE`) and the rest are written here. Nothing reads this until a
 * row is selected — which is the whole of it: a payload on the shelf costs disk, and
 * disk is not what a repaint walks.
 */

// What a row loses when its payload is shelved, and gets back when it is selected.
export interface ArchivedPayload {
  input?: unknown;
  output?: unknown;
  streamOutputs?: unknown[];
}

interface ArchiveRecord extends ArchivedPayload {
  // What takes a payload with the run it was made in.
  runId: string;
}

/**
 * How many payloads the shelf holds across a session, oldest let go first. Forty times
 * what the heap holds, and the same order as the rows a run keeps — a shelf deeper
 * than the log is a payload under a row nothing can select.
 */
const MAX_ARCHIVED = 20_000;
// A burst is one transaction rather than one each. Until it is flushed the payload is
// still on the heap, which is what keeps this short.
const WRITE_DEBOUNCE_MS = 250;
const MAX_PENDING = 200;

/**
 * The database, behind a seam: overridable so a test can run the shelf without one,
 * the way the console's own frame queue is.
 */
export const shelf = {
  available: payloadStoreAvailable,
  open: payloadStore as (mode: IDBTransactionMode) => IDBObjectStore | null,
};

// Handed out in order, so letting the oldest go is a range rather than a list of keys
// held in memory — the memory this exists to spare.
let next = 1;
let oldest = 1;
const pending = new Map<number, ArchiveRecord>();
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Takes a payload off the caller's hands and answers with the ref to ask for it back,
 * or nothing where there is no shelf to put it on — a row with no ref is a row whose
 * payload is simply gone, which is what it was before there was a shelf.
 */
export function archivePayload(runId: string, payload: ArchivedPayload): number | undefined {
  if (!shelf.available()) return undefined;
  const ref = next++;
  pending.set(ref, { runId, ...payload });
  if (pending.size >= MAX_PENDING) flushArchive();
  else if (timer === null) timer = setTimeout(flushArchive, WRITE_DEBOUNCE_MS);
  return ref;
}

/**
 * The payload back, or nothing if the shelf has since let it go. A ref below the
 * oldest one held is answered without a round trip.
 */
export function readArchivedPayload(ref: number): Promise<ArchivedPayload | undefined> {
  const held = pending.get(ref);
  if (held) return Promise.resolve(payloadOf(held));
  if (ref < oldest) return Promise.resolve(undefined);
  const store = shelf.open("readonly");
  if (!store) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const request = store.get(ref);
    request.onsuccess = () => resolve(payloadOf(request.result as ArchiveRecord | undefined));
    request.onerror = () => resolve(undefined);
  });
}

// The run is how the record is filed, not part of the call it belongs to, so it is
// left behind rather than laid over the call the pane draws.
function payloadOf(record: ArchiveRecord | undefined): ArchivedPayload | undefined {
  return record && { input: record.input, output: record.output, streamOutputs: record.streamOutputs };
}

// A run trimmed out of its file, a console cleared, a draft discarded: the rows are
// gone, so nothing can ask for these again.
export function dropRunPayloads(runIds: string[]): void {
  if (runIds.length === 0) return;
  const dropped = new Set(runIds);
  for (const [ref, record] of pending) if (dropped.has(record.runId)) pending.delete(ref);
  const store = shelf.open("readwrite");
  if (!store) return;
  const index = store.index("runId");
  for (const runId of dropped) {
    const request = index.openKeyCursor(IDBKeyRange.only(runId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  }
}

// Anything written but not yet on disk is still readable from the queue, so this is
// only ever about getting it there — a test, or a window on its way out.
export function flushArchive(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (pending.size === 0) return;
  const writes = [...pending];
  pending.clear();

  const store = shelf.open("readwrite");
  if (!store) return;
  for (const [ref, record] of writes) {
    // A payload that cannot be cloned is one row without a payload, not a shelf that
    // stops working.
    try {
      store.put(record, ref);
    } catch {
      /* empty */
    }
  }
  evict(store, next - MAX_ARCHIVED);
  // A refused transaction is almost always the quota, so the shelf makes room and
  // carries on rather than giving up for the rest of the session.
  store.transaction.onerror = () => {
    const half = shelf.open("readwrite");
    if (half) evict(half, oldest + Math.floor((next - oldest) / 2));
  };
}

function evict(store: IDBObjectStore, upTo: number): void {
  if (upTo <= oldest) return;
  store.delete(IDBKeyRange.bound(oldest, upTo, false, true));
  oldest = upTo;
}

/**
 * Emptied, which is what a window opening does with it: the shelf holds the payloads
 * of rows a session was holding, so a session that is holding none has nothing here
 * that anything could ask for.
 */
export function resetPayloadArchive(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending.clear();
  next = 1;
  oldest = 1;
  shelf.open("readwrite")?.clear();
}

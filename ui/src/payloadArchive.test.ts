import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { archivePayload, dropRunPayloads, flushArchive, readArchivedPayload, resetPayloadArchive, shelf } from "./payloadArchive";

interface Range {
  lower?: number;
  upper?: number;
  upperOpen?: boolean;
  only?: string;
}

// Enough of IndexedDB to run the shelf: the keys are ordinals and the one query is a
// range over them, so a Map answers everything here.
class FakeStore {
  readonly transaction = { onerror: null as (() => void) | null };

  constructor(readonly data: Map<number, any>) {}

  put(value: unknown, key: number): void {
    this.data.set(key, value);
  }

  get(key: number): any {
    return answer(() => this.data.get(key));
  }

  delete(key: number | Range): void {
    if (typeof key === "number") {
      this.data.delete(key);
      return;
    }
    for (const held of [...this.data.keys()]) {
      if (held >= key.lower! && (key.upperOpen ? held < key.upper! : held <= key.upper!)) this.data.delete(held);
    }
  }

  clear(): void {
    this.data.clear();
  }

  index(_name: string) {
    return {
      openKeyCursor: (range: Range) => {
        const keys = [...this.data.entries()].filter(([, record]) => record.runId === range.only).map(([key]) => key);
        const request: any = { onsuccess: null, result: null };
        let at = 0;
        const step = () => {
          if (at >= keys.length) {
            request.result = null;
          } else {
            request.result = { primaryKey: keys[at++], continue: () => queueMicrotask(step) };
          }
          request.onsuccess?.();
        };
        queueMicrotask(step);
        return request;
      },
    };
  }
}

function answer<T>(compute: () => T): any {
  const request: any = { onsuccess: null, onerror: null, result: undefined };
  queueMicrotask(() => {
    request.result = compute();
    request.onsuccess?.();
  });
  return request;
}

const original = { available: shelf.available, open: shelf.open };
let data: Map<number, any>;

beforeEach(() => {
  data = new Map();
  (globalThis as any).IDBKeyRange = {
    bound: (lower: number, upper: number, _lowerOpen: boolean, upperOpen: boolean) => ({ lower, upper, upperOpen }),
    only: (only: string) => ({ only }),
  };
  shelf.available = () => true;
  shelf.open = () => new FakeStore(data) as unknown as IDBObjectStore;
  resetPayloadArchive();
});

afterEach(() => {
  resetPayloadArchive();
  shelf.available = original.available;
  shelf.open = original.open;
});

describe("the payload shelf", () => {
  it("hands a payload back to the row that asked for it", async () => {
    const ref = archivePayload("run-1", { input: { id: "vera-lune" }, output: { seats: 3 } })!;
    flushArchive();

    expect(await readArchivedPayload(ref)).toEqual({ input: { id: "vera-lune" }, output: { seats: 3 }, streamOutputs: undefined });
  });

  it("answers from the queue before the write has landed", async () => {
    const ref = archivePayload("run-1", { output: { seats: 3 } })!;

    expect(data.size).toBe(0);
    expect((await readArchivedPayload(ref))?.output).toEqual({ seats: 3 });
  });

  // The run it was filed under is how it is found again; it is not part of the call
  // the pane draws.
  it("leaves the run behind", async () => {
    const ref = archivePayload("run-1", { output: 1 })!;
    flushArchive();

    expect(Object.keys((await readArchivedPayload(ref))!)).toEqual(["input", "output", "streamOutputs"]);
  });

  it("takes a run's payloads with the run", async () => {
    const mine = archivePayload("run-1", { output: 1 })!;
    const other = archivePayload("run-2", { output: 2 })!;
    flushArchive();

    dropRunPayloads(["run-1"]);
    await Promise.resolve();

    expect(await readArchivedPayload(mine)).toBeUndefined();
    expect((await readArchivedPayload(other))?.output).toBe(2);
  });

  it("lets the oldest go once it is full, and says so by answering with nothing", async () => {
    const first = archivePayload("run-1", { output: 0 })!;
    for (let i = 0; i < 20_100; i++) archivePayload("run-1", { output: i });
    flushArchive();

    expect(await readArchivedPayload(first)).toBeUndefined();
  });

  it("hands back no ref where there is nowhere to shelve anything", () => {
    shelf.available = () => false;

    expect(archivePayload("run-1", { output: 1 })).toBeUndefined();
  });
});

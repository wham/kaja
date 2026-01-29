const DB_NAME = "kaja";
const STORE_NAME = "ui-state";
const DB_VERSION = 1;
const WRITE_DEBOUNCE_MS = 500;

let cache = new Map<string, any>();
let db: IDBDatabase | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWrites = new Map<string, any>();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readAll(database: IDBDatabase): Promise<Map<string, any>> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    const entries = new Map<string, any>();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        entries.set(cursor.key as string, cursor.value);
        cursor.continue();
      } else {
        resolve(entries);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

function flushWrites(): void {
  if (!db || pendingWrites.size === 0) return;
  const writes = new Map(pendingWrites);
  pendingWrites.clear();
  writeTimer = null;
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    for (const [key, value] of writes) {
      store.put(value, key);
    }
  } catch (error) {
    console.warn("Failed to write to storage:", error);
  }
}

export async function initializeStorage(): Promise<void> {
  try {
    db = await openDatabase();
    cache = await readAll(db);
  } catch (error) {
    console.warn("Failed to initialize storage:", error);
  }
}

export function getPersistedValue<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function setPersistedValue(key: string, value: any): void {
  cache.set(key, value);
  pendingWrites.set(key, value);
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
  }
  writeTimer = setTimeout(flushWrites, WRITE_DEBOUNCE_MS);
}

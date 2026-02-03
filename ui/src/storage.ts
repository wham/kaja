const DB_NAME = "kaja";
const UI_STATE_STORE = "ui-state";
const TYPE_MEMORY_STORE = "type-memory";
const DB_VERSION = 2;
const WRITE_DEBOUNCE_MS = 500;

let cache = new Map<string, any>();
let typeMemoryCache = new Map<string, any>();
let db: IDBDatabase | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let typeMemoryWriteTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWrites = new Map<string, any>();
const pendingTypeMemoryWrites = new Map<string, any>();
const pendingTypeMemoryDeletes = new Set<string>();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(UI_STATE_STORE)) {
        database.createObjectStore(UI_STATE_STORE);
      }
      if (!database.objectStoreNames.contains(TYPE_MEMORY_STORE)) {
        database.createObjectStore(TYPE_MEMORY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readAllFromStore(database: IDBDatabase, storeName: string): Promise<Map<string, any>> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
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
    const transaction = db.transaction(UI_STATE_STORE, "readwrite");
    const store = transaction.objectStore(UI_STATE_STORE);
    for (const [key, value] of writes) {
      store.put(value, key);
    }
  } catch (error) {
    console.warn("Failed to write to storage:", error);
  }
}

function flushTypeMemoryWrites(): void {
  if (!db || (pendingTypeMemoryWrites.size === 0 && pendingTypeMemoryDeletes.size === 0)) return;
  const writes = new Map(pendingTypeMemoryWrites);
  const deletes = new Set(pendingTypeMemoryDeletes);
  pendingTypeMemoryWrites.clear();
  pendingTypeMemoryDeletes.clear();
  typeMemoryWriteTimer = null;
  try {
    const transaction = db.transaction(TYPE_MEMORY_STORE, "readwrite");
    const store = transaction.objectStore(TYPE_MEMORY_STORE);
    for (const [key, value] of writes) {
      store.put(value, key);
    }
    for (const key of deletes) {
      store.delete(key);
    }
  } catch (error) {
    console.warn("Failed to write to type memory storage:", error);
  }
}

export async function initializeStorage(): Promise<void> {
  try {
    db = await openDatabase();
    cache = await readAllFromStore(db, UI_STATE_STORE);
    typeMemoryCache = await readAllFromStore(db, TYPE_MEMORY_STORE);
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

// Type memory storage functions
export function getTypeMemoryValue<T>(key: string): T | undefined {
  return typeMemoryCache.get(key) as T | undefined;
}

export function setTypeMemoryValue(key: string, value: any): void {
  typeMemoryCache.set(key, value);
  pendingTypeMemoryDeletes.delete(key);
  pendingTypeMemoryWrites.set(key, value);
  if (typeMemoryWriteTimer !== null) {
    clearTimeout(typeMemoryWriteTimer);
  }
  typeMemoryWriteTimer = setTimeout(flushTypeMemoryWrites, WRITE_DEBOUNCE_MS);
}

export function deleteTypeMemoryValue(key: string): void {
  typeMemoryCache.delete(key);
  pendingTypeMemoryWrites.delete(key);
  pendingTypeMemoryDeletes.add(key);
  if (typeMemoryWriteTimer !== null) {
    clearTimeout(typeMemoryWriteTimer);
  }
  typeMemoryWriteTimer = setTimeout(flushTypeMemoryWrites, WRITE_DEBOUNCE_MS);
}

export function getAllTypeMemoryKeys(): string[] {
  return Array.from(typeMemoryCache.keys());
}

export function getTypeMemoryKeyCount(): number {
  return typeMemoryCache.size;
}

export function clearTypeMemoryStore(): void {
  for (const key of typeMemoryCache.keys()) {
    pendingTypeMemoryDeletes.add(key);
    pendingTypeMemoryWrites.delete(key);
  }
  typeMemoryCache.clear();
  if (typeMemoryWriteTimer !== null) {
    clearTimeout(typeMemoryWriteTimer);
  }
  typeMemoryWriteTimer = setTimeout(flushTypeMemoryWrites, WRITE_DEBOUNCE_MS);
}

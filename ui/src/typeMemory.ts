import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import { clearTypeMemoryStore, deleteTypeMemoryValue, getAllTypeMemoryKeys, getTypeMemoryKeyCount, getTypeMemoryValue, setTypeMemoryValue } from "./storage";

// Remembered values are offered as editor completions, never written into
// generated code, so a handful per field is a list worth picking from rather
// than a silent guess.
const MAX_VALUES_PER_FIELD = 5;
const MAX_TYPES_PER_NAME = 10;
const MAX_KEYS = 400;
// A list response repeats the same shape many times over; the first few
// elements already carry everything worth suggesting.
const MAX_ELEMENTS = 10;
const MAX_DEPTH = 8;

// field:<typeName>:<fieldName> -> the values seen on that exact field.
const FIELD_PREFIX = "field:";
// name:<scalarType>:<fieldName> -> the type names that have such a field, so a
// value seen on one type can be offered on a same-named field of another.
const NAME_PREFIX = "name:";

export type ScalarValue = string | number | boolean;

// Where a value came from: what the user sent, or what a service sent back.
export type ValueOrigin = "request" | "response";

export interface ValueSource {
  // Method the value passed through, e.g. "MoviesService.ListMovies".
  method: string;
  origin: ValueOrigin;
}

export interface RememberedValue extends ValueSource {
  value: ScalarValue;
  // Message type the value was seen on, e.g. "movies.v1.Movie".
  typeName: string;
  fieldName: string;
  // When it was last seen.
  t: number;
}

interface StoredEntry<T> {
  t: number; // last updated timestamp
  v: T[]; // values, most recent first
}

/**
 * Record the scalar values of a request or response so they can be suggested
 * later. Nested messages are recorded under their own type names.
 */
export function rememberValues(typeName: string, obj: any, messageType: IMessageType<any> | undefined, source: ValueSource): void {
  if (!typeName || !obj || typeof obj !== "object") {
    return;
  }

  if (messageType) {
    walkWithSchema(obj, typeName, messageType, source, 0);
  } else {
    walkWithoutSchema(obj, typeName, source);
  }
}

function walkWithSchema(obj: any, typeName: string, messageType: IMessageType<any>, source: ValueSource, depth: number): void {
  if (!obj || typeof obj !== "object" || depth > MAX_DEPTH) {
    return;
  }

  for (const field of messageType.fields) {
    const value = obj[field.localName];
    if (value === undefined || value === null) {
      continue;
    }

    if (field.kind === "scalar") {
      if (field.repeat && Array.isArray(value)) {
        value.slice(0, MAX_ELEMENTS).forEach((element) => remember(typeName, field.localName, element, field.T, source));
      } else {
        remember(typeName, field.localName, value, field.T, source);
      }
    } else if (field.kind === "message") {
      const nestedType = field.T();
      if (field.repeat && Array.isArray(value)) {
        value.slice(0, MAX_ELEMENTS).forEach((element) => walkWithSchema(element, nestedType.typeName, nestedType, source, depth + 1));
      } else {
        walkWithSchema(value, nestedType.typeName, nestedType, source, depth + 1);
      }
    } else if (field.kind === "map" && field.V.kind === "scalar" && typeof value === "object") {
      for (const mapKey of Object.keys(value).slice(0, MAX_ELEMENTS)) {
        remember(typeName, field.localName, value[mapKey], field.V.T, source);
      }
    }
    // Enums are not remembered; the generated code already names their values.
  }
}

function walkWithoutSchema(obj: any, typeName: string, source: ValueSource): void {
  // Without a schema there is no way to tell which type a nested object has, so
  // only the top-level scalars are remembered, and without a scalar type they
  // stay off the by-name index.
  for (const key of Object.keys(obj)) {
    remember(typeName, key, obj[key], undefined, source);
  }
}

function isScalar(value: any): value is ScalarValue {
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean";
}

function fieldKey(typeName: string, fieldName: string): string {
  return `${FIELD_PREFIX}${typeName}:${fieldName}`;
}

function nameKey(fieldName: string, scalarType: ScalarType): string {
  return `${NAME_PREFIX}${scalarType}:${fieldName}`;
}

function readEntry<T>(key: string): StoredEntry<T> {
  const raw = getTypeMemoryValue<any>(key);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.v)) {
    return { t: 0, v: [] };
  }
  return { t: raw.t ?? 0, v: raw.v };
}

// Move `value` to the front of the entry, dropping any earlier occurrence, and
// trim the entry to `max`.
function promote<T>(entry: StoredEntry<T>, value: T, max: number, matches: (candidate: T) => boolean): StoredEntry<T> {
  const kept = entry.v.filter((candidate) => !matches(candidate));
  kept.unshift(value);
  kept.length = Math.min(kept.length, max);
  return { t: Date.now(), v: kept };
}

function remember(typeName: string, fieldName: string, value: any, scalarType: ScalarType | undefined, source: ValueSource): void {
  if (!isScalar(value)) {
    return;
  }

  const key = fieldKey(typeName, fieldName);
  const remembered: RememberedValue = { value, typeName, fieldName, method: source.method, origin: source.origin, t: Date.now() };
  setTypeMemoryValue(
    key,
    promote(readEntry<RememberedValue>(key), remembered, MAX_VALUES_PER_FIELD, (candidate) => candidate.value === value),
  );

  if (scalarType !== undefined) {
    const index = nameKey(fieldName, scalarType);
    setTypeMemoryValue(
      index,
      promote(readEntry<string>(index), typeName, MAX_TYPES_PER_NAME, (candidate) => candidate === typeName),
    );
  }

  evictOldKeys();
}

function evictOldKeys(): void {
  // O(1) check - only evict when at 2x the limit
  if (getTypeMemoryKeyCount() <= MAX_KEYS * 2) {
    return;
  }

  const entries = getAllTypeMemoryKeys().map((key) => ({ key, t: readEntry(key).t }));
  entries.sort((a, b) => a.t - b.t);

  for (const { key } of entries.slice(0, entries.length - MAX_KEYS)) {
    deleteTypeMemoryValue(key);
  }
}

/**
 * Values to suggest for a field, most recent first: the ones seen on this exact
 * field, then the ones seen on same-named fields of other message types.
 */
export function recallValues(typeName: string, fieldName: string, scalarType?: ScalarType): RememberedValue[] {
  const exact = readEntry<RememberedValue>(fieldKey(typeName, fieldName)).v;

  const related: RememberedValue[] = [];
  if (scalarType !== undefined) {
    for (const otherType of readEntry<string>(nameKey(fieldName, scalarType)).v) {
      if (otherType !== typeName) {
        related.push(...readEntry<RememberedValue>(fieldKey(otherType, fieldName)).v);
      }
    }
    related.sort((a, b) => b.t - a.t);
  }

  const seen = new Set<string>();
  const values: RememberedValue[] = [];
  for (const remembered of [...exact, ...related]) {
    const key = typeof remembered.value + ":" + String(remembered.value);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(remembered);
    }
  }

  return values;
}

/**
 * Drop entries left behind by an earlier layout of the store, which are unread
 * by the current keys but still count against the key budget.
 */
export function pruneTypeMemory(): void {
  for (const key of getAllTypeMemoryKeys()) {
    if (!key.startsWith(FIELD_PREFIX) && !key.startsWith(NAME_PREFIX)) {
      deleteTypeMemoryValue(key);
    }
  }
}

/**
 * Forget every remembered value.
 */
export function clearTypeMemory(): void {
  clearTypeMemoryStore();
}

/**
 * All fields that have remembered values, as "<typeName>:<fieldName>".
 */
export function getAllRememberedFields(): string[] {
  return getAllTypeMemoryKeys()
    .filter((key) => key.startsWith(FIELD_PREFIX))
    .map((key) => key.slice(FIELD_PREFIX.length));
}

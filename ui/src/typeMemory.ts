import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import { clearTypeMemoryStore, deleteTypeMemoryValue, getAllTypeMemoryKeys, getTypeMemoryKeyCount, getTypeMemoryValue, setTypeMemoryValue } from "./storage";

const MAX_VALUES_PER_FIELD = 1;
const MAX_KEYS = 100;

// Key prefixes for the memory store
const MESSAGE_PREFIX = "message:";
const SCALAR_PREFIX = "scalar:";

// Storage format: { t: timestamp, v: values[] }
// Message memory: v = complete object snapshots
// Scalar memory: v = individual values

interface StoredEntry {
  t: number; // last updated timestamp
  v: any[];  // values (FILO)
}

/**
 * Capture values from an object (request input or response output).
 * - Message fields are stored under the message name
 * - Scalar fields are stored by scalar type + field name
 * - If messageType is provided, nested messages are properly captured under their own names
 */
export function captureValues(messageName: string, obj: any, messageType?: IMessageType<any>): void {
  if (!messageName || !obj || typeof obj !== "object") {
    return;
  }

  if (messageType) {
    walkAndCaptureWithSchema(obj, messageName, messageType);
  } else {
    walkAndCapture(obj, messageName);
  }
}

function walkAndCaptureWithSchema(obj: any, messageName: string, messageType: IMessageType<any>): void {
  if (obj === null || obj === undefined) {
    return;
  }

  // Collect scalar fields for this message's snapshot
  const snapshot: Record<string, any> = {};

  for (const field of messageType.fields) {
    const value = obj[field.localName];
    if (value === undefined || value === null) {
      continue;
    }

    if (field.kind === "scalar") {
      if (isScalar(value)) {
        snapshot[field.localName] = value;
        addToScalarMemory(field.localName, field.T, value);
      }
    } else if (field.kind === "message") {
      const nestedType = field.T();
      if (field.repeat) {
        // Repeated message field (array)
        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (item && typeof item === "object") {
              walkAndCaptureWithSchema(item, nestedType.typeName, nestedType);
            }
          });
        }
      } else {
        // Single message field - recurse to capture under nested type's name
        if (typeof value === "object") {
          walkAndCaptureWithSchema(value, nestedType.typeName, nestedType);
        }
      }
    } else if (field.kind === "map") {
      // Map fields - capture values if they're scalars
      if (typeof value === "object" && field.V.kind === "scalar") {
        for (const mapKey of Object.keys(value)) {
          const mapValue = value[mapKey];
          if (isScalar(mapValue)) {
            addToScalarMemory(field.localName, field.V.T, mapValue);
          }
        }
      }
    }
    // Enums are not captured as they're typically fixed values
  }

  // Store the snapshot if we captured any scalar fields
  if (Object.keys(snapshot).length > 0) {
    addMessageSnapshot(messageName, snapshot);
  }
}

function walkAndCapture(obj: any, messageName: string): void {
  if (obj === null || obj === undefined) {
    return;
  }

  // For non-schema capture, store the entire object as a snapshot
  // Extract only scalar values (nested objects are different messages)
  const snapshot = extractScalars(obj);

  if (Object.keys(snapshot).length > 0) {
    addMessageSnapshot(messageName, snapshot);
  }
}

function extractScalars(obj: any): Record<string, any> {
  const result: Record<string, any> = {};

  if (obj === null || obj === undefined || typeof obj !== "object") {
    return result;
  }

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (isScalar(value)) {
      result[key] = value;
    }
    // Don't recurse into nested objects - they would be different types
  }

  return result;
}

function isScalar(value: any): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean";
}

function getScalarKey(fieldName: string, scalarType: ScalarType): string {
  return `${SCALAR_PREFIX}${scalarType}:${fieldName}`;
}

function getMessageKey(messageName: string): string {
  return `${MESSAGE_PREFIX}${messageName}`;
}

function normalizeEntry(raw: any): StoredEntry {
  // Handle migration from old formats or corrupted data
  if (!raw || typeof raw !== "object") {
    return { t: 0, v: [] };
  }
  // Old format was plain array
  if (Array.isArray(raw)) {
    return { t: 0, v: raw };
  }
  // Current format
  if (Array.isArray(raw.v)) {
    return { t: raw.t ?? 0, v: raw.v };
  }
  return { t: 0, v: [] };
}

function stableStringify(obj: any): string {
  // Sort keys for consistent comparison
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function addMessageSnapshot(messageName: string, snapshot: any): void {
  const key = getMessageKey(messageName);
  const entry = normalizeEntry(getTypeMemoryValue(key));

  // Check if this exact snapshot already exists (deep equality check with stable key order)
  const snapshotStr = stableStringify(snapshot);
  const existingIndex = entry.v.findIndex((v) => stableStringify(v) === snapshotStr);

  if (existingIndex >= 0) {
    // Remove from current position
    entry.v.splice(existingIndex, 1);
  }

  // Add to front (most recent)
  entry.v.unshift(snapshot);

  // Keep only the max values
  if (entry.v.length > MAX_VALUES_PER_FIELD) {
    entry.v.length = MAX_VALUES_PER_FIELD;
  }

  // Update timestamp
  entry.t = Date.now();

  setTypeMemoryValue(key, entry);
  evictOldKeys();
}

function addToScalarMemory(fieldName: string, scalarType: ScalarType, value: any): void {
  const key = getScalarKey(fieldName, scalarType);
  const entry = normalizeEntry(getTypeMemoryValue(key));

  const existingIndex = entry.v.indexOf(value);

  if (existingIndex >= 0) {
    // Remove from current position
    entry.v.splice(existingIndex, 1);
  }

  // Add to front (most recent)
  entry.v.unshift(value);

  // Keep only the max values
  if (entry.v.length > MAX_VALUES_PER_FIELD) {
    entry.v.length = MAX_VALUES_PER_FIELD;
  }

  // Update timestamp
  entry.t = Date.now();

  setTypeMemoryValue(key, entry);
  evictOldKeys();
}

function evictOldKeys(): void {
  // O(1) check - only evict when at 2x the limit
  const count = getTypeMemoryKeyCount();
  if (count <= MAX_KEYS * 2) {
    return;
  }

  // Get all entries with their timestamps
  const keys = getAllTypeMemoryKeys();
  const entries: { key: string; t: number }[] = [];
  for (const key of keys) {
    const entry = normalizeEntry(getTypeMemoryValue(key));
    entries.push({ key, t: entry.t });
  }

  // Sort by timestamp (oldest first)
  entries.sort((a, b) => a.t - b.t);

  // Delete oldest entries until we're at max
  const toDelete = entries.slice(0, entries.length - MAX_KEYS);
  for (const { key } of toDelete) {
    deleteTypeMemoryValue(key);
  }
}

/**
 * Get memorized value for a message field.
 * Extracts the field from the most recent snapshot of this message type.
 */
export function getMessageMemorizedValue(messageName: string, fieldName: string): any | undefined {
  const key = getMessageKey(messageName);
  const entry = normalizeEntry(getTypeMemoryValue(key));
  if (entry.v.length === 0) {
    return undefined;
  }

  // Get from the most recent snapshot
  const snapshot = entry.v[0];
  if (!snapshot || typeof snapshot !== "object") {
    return undefined;
  }
  return snapshot[fieldName];
}

/**
 * Get memorized value for a scalar field by field name and protobuf scalar type.
 * Used when generating defaults for scalar fields.
 */
export function getScalarMemorizedValue(fieldName: string, scalarType: ScalarType): any | undefined {
  const key = `${SCALAR_PREFIX}${scalarType}:${fieldName}`;
  const entry = normalizeEntry(getTypeMemoryValue(key));

  if (entry.v.length === 0) {
    return undefined;
  }

  return entry.v[0];
}

/**
 * Get all memorized values for a scalar field (for suggestions).
 */
export function getScalarMemorizedValues(fieldName: string, scalarType: ScalarType): any[] {
  const entry = normalizeEntry(getTypeMemoryValue(`${SCALAR_PREFIX}${scalarType}:${fieldName}`));
  return entry.v;
}

/**
 * Clear all type memory.
 */
export function clearTypeMemory(): void {
  clearTypeMemoryStore();
}

/**
 * Get all stored message names (for debugging).
 */
export function getAllStoredMessages(): string[] {
  return getAllTypeMemoryKeys()
    .filter((key) => key.startsWith(MESSAGE_PREFIX))
    .map((key) => key.slice(MESSAGE_PREFIX.length));
}

/**
 * Get all stored scalar keys (for debugging).
 */
export function getAllStoredScalars(): string[] {
  return getAllTypeMemoryKeys()
    .filter((key) => key.startsWith(SCALAR_PREFIX))
    .map((key) => key.slice(SCALAR_PREFIX.length));
}

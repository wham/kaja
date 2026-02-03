import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import { clearTypeMemoryStore, getAllTypeMemoryKeys, getTypeMemoryValue, setTypeMemoryValue } from "./storage";

const MAX_VALUES_PER_FIELD = 10;

// Key prefixes for the type-memory store
const TYPE_PREFIX = "type:";
const SCALAR_PREFIX = "scalar:";

// Type memory: array of complete object snapshots (FILO, max 10)
// Scalar memory: array of individual values (FILO, max 10)

/**
 * Capture values from an object (request input or response output).
 * - Message type fields are stored under the message type name
 * - Scalar fields are stored by scalar type + field name
 * - If messageType is provided, nested message types are properly captured under their own type names
 */
export function captureValues(typeName: string, obj: any, messageType?: IMessageType<any>): void {
  if (!typeName || !obj || typeof obj !== "object") {
    return;
  }

  if (messageType) {
    walkAndCaptureWithSchema(obj, typeName, messageType);
  } else {
    walkAndCapture(obj, typeName);
  }
}

function walkAndCaptureWithSchema(obj: any, typeName: string, messageType: IMessageType<any>): void {
  if (obj === null || obj === undefined) {
    return;
  }

  // Collect scalar fields for this type's snapshot
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
    addTypeSnapshot(typeName, snapshot);
  }
}

function walkAndCapture(obj: any, typeName: string): void {
  if (obj === null || obj === undefined) {
    return;
  }

  // For non-schema capture, store the entire object as a snapshot
  // Extract only scalar values (flatten nested objects with dot notation would create frankenstein)
  const snapshot = extractScalars(obj);

  if (Object.keys(snapshot).length > 0) {
    addTypeSnapshot(typeName, snapshot);
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

function getTypeKey(typeName: string): string {
  return `${TYPE_PREFIX}${typeName}`;
}

function addTypeSnapshot(typeName: string, snapshot: any): void {
  const key = getTypeKey(typeName);
  const values = getTypeMemoryValue<any[]>(key) ?? [];

  // Check if this exact snapshot already exists (deep equality check)
  const existingIndex = values.findIndex((v) => JSON.stringify(v) === JSON.stringify(snapshot));

  if (existingIndex >= 0) {
    // Remove from current position
    values.splice(existingIndex, 1);
  }

  // Add to front (most recent)
  values.unshift(snapshot);

  // Keep only the last 10 snapshots
  if (values.length > MAX_VALUES_PER_FIELD) {
    values.length = MAX_VALUES_PER_FIELD;
  }

  setTypeMemoryValue(key, values);
}

function addToScalarMemory(fieldName: string, scalarType: ScalarType, value: any): void {
  const key = getScalarKey(fieldName, scalarType);
  const values = getTypeMemoryValue<any[]>(key) ?? [];

  const existingIndex = values.indexOf(value);

  if (existingIndex >= 0) {
    // Remove from current position
    values.splice(existingIndex, 1);
  }

  // Add to front (most recent)
  values.unshift(value);

  // Keep only the last 10 values
  if (values.length > MAX_VALUES_PER_FIELD) {
    values.length = MAX_VALUES_PER_FIELD;
  }

  setTypeMemoryValue(key, values);
}

/**
 * Get memorized value for a message type field.
 * Extracts the field from the most recent snapshot of this type.
 */
export function getTypeMemorizedValue(typeName: string, fieldName: string): any | undefined {
  const key = getTypeKey(typeName);
  const values = getTypeMemoryValue<any[]>(key);
  if (!values || values.length === 0) {
    return undefined;
  }

  // Get from the most recent snapshot
  return values[0][fieldName];
}

/**
 * Get memorized value for a scalar field by field name and protobuf scalar type.
 * Used when generating defaults for scalar fields.
 */
export function getScalarMemorizedValue(fieldName: string, scalarType: ScalarType): any | undefined {
  const key = `${SCALAR_PREFIX}${scalarType}:${fieldName}`;
  const values = getTypeMemoryValue<any[]>(key);

  if (!values || values.length === 0) {
    return undefined;
  }

  return values[0];
}

/**
 * Get all memorized values for a scalar field (for suggestions).
 */
export function getScalarMemorizedValues(fieldName: string, scalarType: ScalarType): any[] {
  return getTypeMemoryValue<any[]>(`${SCALAR_PREFIX}${scalarType}:${fieldName}`) ?? [];
}

/**
 * Clear all type memory.
 */
export function clearTypeMemory(): void {
  clearTypeMemoryStore();
}

/**
 * Get all stored type names (for debugging).
 */
export function getAllStoredTypes(): string[] {
  return getAllTypeMemoryKeys()
    .filter((key) => key.startsWith(TYPE_PREFIX))
    .map((key) => key.slice(TYPE_PREFIX.length));
}

/**
 * Get all stored scalar keys (for debugging).
 */
export function getAllStoredScalars(): string[] {
  return getAllTypeMemoryKeys()
    .filter((key) => key.startsWith(SCALAR_PREFIX))
    .map((key) => key.slice(SCALAR_PREFIX.length));
}

import { IMessageType } from "@protobuf-ts/runtime";
import { clearTypeMemoryStore, getAllTypeMemoryKeys, getTypeMemoryValue, setTypeMemoryValue } from "./storage";

const MAX_VALUES_PER_FIELD = 10;

// Key prefixes for the type-memory store
const TYPE_PREFIX = "type:";
const SCALAR_PREFIX = "scalar:";

export interface FieldsMemory {
  fields: Record<string, FieldMemory>;
}

export interface FieldMemory {
  values: MemorizedValue[];
}

export interface MemorizedValue {
  value: any;
  count: number;
  lastUsed: number;
}

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
    walkAndCapture(obj, "", typeName);
  }
}

function walkAndCaptureWithSchema(obj: any, typeName: string, messageType: IMessageType<any>): void {
  if (obj === null || obj === undefined) {
    return;
  }

  for (const field of messageType.fields) {
    const value = obj[field.localName];
    if (value === undefined || value === null) {
      continue;
    }

    if (field.kind === "scalar") {
      if (isScalar(value)) {
        addToTypeMemory(typeName, field.localName, value);
        addToScalarMemory(field.localName, value);
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
        // Single message field
        if (typeof value === "object") {
          walkAndCaptureWithSchema(value, nestedType.typeName, nestedType);
        }
      }
    } else if (field.kind === "map") {
      // Map fields - capture values if they're scalars
      if (typeof value === "object") {
        for (const mapKey of Object.keys(value)) {
          const mapValue = value[mapKey];
          if (isScalar(mapValue)) {
            addToScalarMemory(field.localName, mapValue);
          }
        }
      }
    }
    // Enums are not captured as they're typically fixed values
  }
}

function walkAndCapture(obj: any, prefix: string, typeName: string): void {
  if (obj === null || obj === undefined) {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      if (isScalar(item)) {
        // For array items, use index-based path for type memory
        const path = prefix ? `${prefix}[${index}]` : `[${index}]`;
        addToTypeMemory(typeName, path, item);
        // Also add to scalar memory with just the field name (without index)
        const fieldName = prefix || "item";
        addToScalarMemory(fieldName, item);
      } else if (typeof item === "object") {
        const path = prefix ? `${prefix}[${index}]` : `[${index}]`;
        walkAndCapture(item, path, typeName);
      }
    });
    return;
  }

  if (typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];

      if (isScalar(value)) {
        // Store in type memory (for message type matching)
        addToTypeMemory(typeName, path, value);
        // Store in scalar memory (for field name + type matching)
        addToScalarMemory(key, value);
      } else if (typeof value === "object") {
        walkAndCapture(value, path, typeName);
      }
    }
  }
}

function isScalar(value: any): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean";
}

function getScalarKey(fieldName: string, value: any): string {
  const type = typeof value;
  return `${SCALAR_PREFIX}${type}:${fieldName}`;
}

function getTypeKey(typeName: string): string {
  return `${TYPE_PREFIX}${typeName}`;
}

function addToTypeMemory(typeName: string, fieldPath: string, value: any): void {
  const key = getTypeKey(typeName);
  const memory = getTypeMemoryValue<FieldsMemory>(key) ?? { fields: {} };

  addValueToFieldMemory(memory.fields, fieldPath, value);
  setTypeMemoryValue(key, memory);
}

function addToScalarMemory(fieldName: string, value: any): void {
  const key = getScalarKey(fieldName, value);
  const memory = getTypeMemoryValue<FieldMemory>(key) ?? { values: [] };

  addValueToMemory(memory, value);
  setTypeMemoryValue(key, memory);
}

function addValueToFieldMemory(fields: Record<string, FieldMemory>, path: string, value: any): void {
  if (!fields[path]) {
    fields[path] = { values: [] };
  }
  addValueToMemory(fields[path], value);
}

function addValueToMemory(fieldMemory: FieldMemory, value: any): void {
  const existingIndex = fieldMemory.values.findIndex((mv) => valuesEqual(mv.value, value));

  if (existingIndex >= 0) {
    fieldMemory.values[existingIndex].count++;
    fieldMemory.values[existingIndex].lastUsed = Date.now();
  } else {
    fieldMemory.values.push({
      value,
      count: 1,
      lastUsed: Date.now(),
    });
  }

  fieldMemory.values.sort((a, b) => scoreValue(b) - scoreValue(a));

  if (fieldMemory.values.length > MAX_VALUES_PER_FIELD) {
    fieldMemory.values = fieldMemory.values.slice(0, MAX_VALUES_PER_FIELD);
  }
}

function valuesEqual(a: any, b: any): boolean {
  return a === b;
}

function scoreValue(mv: MemorizedValue): number {
  const recencyBonus = Math.max(0, 1 - (Date.now() - mv.lastUsed) / (7 * 24 * 60 * 60 * 1000));
  return mv.count + recencyBonus;
}

/**
 * Get memorized value for a message type field.
 * Used when generating defaults for nested message fields.
 */
export function getTypeMemorizedValue(typeName: string, fieldPath: string): any | undefined {
  const key = getTypeKey(typeName);
  const memory = getTypeMemoryValue<FieldsMemory>(key);
  if (!memory) {
    return undefined;
  }

  const fieldMemory = memory.fields[fieldPath];
  if (!fieldMemory || fieldMemory.values.length === 0) {
    return undefined;
  }

  return fieldMemory.values[0].value;
}

/**
 * Get memorized value for a scalar field by field name and scalar type.
 * Used when generating defaults for scalar fields.
 */
export function getScalarMemorizedValue(fieldName: string, scalarType: "string" | "number" | "boolean"): any | undefined {
  const key = `${SCALAR_PREFIX}${scalarType}:${fieldName}`;
  const memory = getTypeMemoryValue<FieldMemory>(key);

  if (!memory || memory.values.length === 0) {
    return undefined;
  }

  return memory.values[0].value;
}

/**
 * Get all memorized values for a scalar field (for suggestions).
 */
export function getScalarMemorizedValues(fieldName: string, scalarType: "string" | "number" | "boolean"): MemorizedValue[] {
  const key = `${SCALAR_PREFIX}${scalarType}:${fieldName}`;
  const memory = getTypeMemoryValue<FieldMemory>(key);

  if (!memory) {
    return [];
  }

  return memory.values;
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

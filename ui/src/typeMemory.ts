import { getPersistedValue, setPersistedValue } from "./storage";

const TYPE_MEMORY_KEY = "typeMemory";
const MAX_VALUES_PER_FIELD = 10;
const MAX_TYPES = 500;

export interface TypeMemory {
  version: 2;
  // Message types: "example.Customer" -> { fields: { id: [...], name: [...] } }
  types: Record<string, FieldsMemory>;
  // Scalar fields by type: "string:id" -> [...], "number:count" -> [...]
  scalars: Record<string, FieldMemory>;
}

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

export function getTypeMemory(): TypeMemory {
  const memory = getPersistedValue<TypeMemory>(TYPE_MEMORY_KEY);
  if (!memory || memory.version !== 2) {
    return { version: 2, types: {}, scalars: {} };
  }
  return memory;
}

export function setTypeMemory(memory: TypeMemory): void {
  setPersistedValue(TYPE_MEMORY_KEY, memory);
}

export function clearTypeMemory(): void {
  setTypeMemory({ version: 2, types: {}, scalars: {} });
}

/**
 * Capture values from an object (request input or response output).
 * - Message type fields are stored under the message type name
 * - Scalar fields are stored by scalar type + field name
 */
export function captureValues(typeName: string, obj: any): void {
  if (!typeName || !obj || typeof obj !== "object") {
    return;
  }

  const memory = getTypeMemory();

  if (!memory.types[typeName]) {
    memory.types[typeName] = { fields: {} };
  }

  walkAndCapture(obj, "", typeName, memory);

  pruneMemoryIfNeeded(memory);
  setTypeMemory(memory);
}

function walkAndCapture(obj: any, prefix: string, typeName: string, memory: TypeMemory): void {
  if (obj === null || obj === undefined) {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      if (isScalar(item)) {
        // For array items, use index-based path for type memory
        const path = prefix ? `${prefix}[${index}]` : `[${index}]`;
        addToTypeMemory(memory, typeName, path, item);
        // Also add to scalar memory with just the field name (without index)
        const fieldName = prefix || "item";
        addToScalarMemory(memory, fieldName, item);
      } else if (typeof item === "object") {
        const path = prefix ? `${prefix}[${index}]` : `[${index}]`;
        walkAndCapture(item, path, typeName, memory);
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
        addToTypeMemory(memory, typeName, path, value);
        // Store in scalar memory (for field name + type matching)
        addToScalarMemory(memory, key, value);
      } else if (typeof value === "object") {
        walkAndCapture(value, path, typeName, memory);
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

function getScalarTypeKey(fieldName: string, value: any): string {
  const type = typeof value;
  return `${type}:${fieldName}`;
}

function addToTypeMemory(memory: TypeMemory, typeName: string, fieldPath: string, value: any): void {
  if (!memory.types[typeName]) {
    memory.types[typeName] = { fields: {} };
  }
  addValueToFieldMemory(memory.types[typeName].fields, fieldPath, value);
}

function addToScalarMemory(memory: TypeMemory, fieldName: string, value: any): void {
  const key = getScalarTypeKey(fieldName, value);
  if (!memory.scalars[key]) {
    memory.scalars[key] = { values: [] };
  }
  addValueToFieldMemory({ [key]: memory.scalars[key] }, key, value);
}

function addValueToFieldMemory(fields: Record<string, FieldMemory>, path: string, value: any): void {
  if (!fields[path]) {
    fields[path] = { values: [] };
  }

  const fieldMemory = fields[path];
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

function pruneMemoryIfNeeded(memory: TypeMemory): void {
  const typeKeys = Object.keys(memory.types);
  if (typeKeys.length <= MAX_TYPES) {
    return;
  }

  const typeScores = typeKeys.map((key) => {
    const typeMemory = memory.types[key];
    let maxLastUsed = 0;
    for (const field of Object.values(typeMemory.fields)) {
      for (const value of field.values) {
        if (value.lastUsed > maxLastUsed) {
          maxLastUsed = value.lastUsed;
        }
      }
    }
    return { key, lastUsed: maxLastUsed };
  });

  typeScores.sort((a, b) => b.lastUsed - a.lastUsed);

  const keysToRemove = typeScores.slice(MAX_TYPES).map((s) => s.key);
  for (const key of keysToRemove) {
    delete memory.types[key];
  }
}

/**
 * Get memorized value for a message type field.
 * Used when generating defaults for nested message fields.
 */
export function getTypeMemorizedValue(typeName: string, fieldPath: string): any | undefined {
  const memory = getTypeMemory();
  const typeMemory = memory.types[typeName];
  if (!typeMemory) {
    return undefined;
  }

  const fieldMemory = typeMemory.fields[fieldPath];
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
  const memory = getTypeMemory();
  const key = `${scalarType}:${fieldName}`;
  const fieldMemory = memory.scalars[key];

  if (!fieldMemory || fieldMemory.values.length === 0) {
    return undefined;
  }

  return fieldMemory.values[0].value;
}

/**
 * Get all memorized values for a scalar field (for suggestions).
 */
export function getScalarMemorizedValues(fieldName: string, scalarType: "string" | "number" | "boolean"): MemorizedValue[] {
  const memory = getTypeMemory();
  const key = `${scalarType}:${fieldName}`;
  const fieldMemory = memory.scalars[key];

  if (!fieldMemory) {
    return [];
  }

  return fieldMemory.values;
}

import { getPersistedValue, setPersistedValue } from "./storage";

const TYPE_MEMORY_KEY = "typeMemory";
const MAX_VALUES_PER_FIELD = 10;
const MAX_METHODS = 1000;

export interface TypeMemory {
  version: 1;
  methods: Record<string, MethodMemory>;
}

export interface MethodMemory {
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
  return getPersistedValue<TypeMemory>(TYPE_MEMORY_KEY) ?? { version: 1, methods: {} };
}

export function setTypeMemory(memory: TypeMemory): void {
  setPersistedValue(TYPE_MEMORY_KEY, memory);
}

export function getMethodMemory(methodKey: string): MethodMemory | undefined {
  const memory = getTypeMemory();
  return memory.methods[methodKey];
}

export function createMethodKey(projectName: string, serviceName: string, methodName: string): string {
  return `${projectName}:${serviceName}:${methodName}`;
}

export function captureMethodInput(projectName: string, serviceName: string, methodName: string, input: any): void {
  const memory = getTypeMemory();
  const methodKey = createMethodKey(projectName, serviceName, methodName);

  if (!memory.methods[methodKey]) {
    memory.methods[methodKey] = { fields: {} };
  }

  walkObject(input, "", (path, value) => {
    if (isMemorizable(value)) {
      addValueToMemory(memory.methods[methodKey], path, value);
    }
  });

  pruneMemoryIfNeeded(memory);
  setTypeMemory(memory);
}

function walkObject(obj: any, prefix: string, callback: (path: string, value: any) => void): void {
  if (obj === null || obj === undefined) {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const path = prefix ? `${prefix}[${index}]` : `[${index}]`;
      if (isMemorizable(item)) {
        callback(path, item);
      } else if (typeof item === "object") {
        walkObject(item, path, callback);
      }
    });
    return;
  }

  if (typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];

      if (isMemorizable(value)) {
        callback(path, value);
      } else if (typeof value === "object") {
        walkObject(value, path, callback);
      }
    }
  }
}

function isMemorizable(value: any): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean";
}

function addValueToMemory(methodMemory: MethodMemory, path: string, value: any): void {
  if (!methodMemory.fields[path]) {
    methodMemory.fields[path] = { values: [] };
  }

  const fieldMemory = methodMemory.fields[path];
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
  const methodKeys = Object.keys(memory.methods);
  if (methodKeys.length <= MAX_METHODS) {
    return;
  }

  const methodScores = methodKeys.map((key) => {
    const methodMemory = memory.methods[key];
    let maxLastUsed = 0;
    for (const field of Object.values(methodMemory.fields)) {
      for (const value of field.values) {
        if (value.lastUsed > maxLastUsed) {
          maxLastUsed = value.lastUsed;
        }
      }
    }
    return { key, lastUsed: maxLastUsed };
  });

  methodScores.sort((a, b) => b.lastUsed - a.lastUsed);

  const keysToRemove = methodScores.slice(MAX_METHODS).map((s) => s.key);
  for (const key of keysToRemove) {
    delete memory.methods[key];
  }
}

export function getMemorizedValue(methodKey: string, fieldPath: string): any | undefined {
  const methodMemory = getMethodMemory(methodKey);
  if (!methodMemory) {
    return undefined;
  }

  const fieldMemory = methodMemory.fields[fieldPath];
  if (!fieldMemory || fieldMemory.values.length === 0) {
    return undefined;
  }

  return fieldMemory.values[0].value;
}

export function clearTypeMemory(): void {
  setTypeMemory({ version: 1, methods: {} });
}

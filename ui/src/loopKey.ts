/**
 * Fields whose value identifies the thing a call is about. One definition, read
 * twice: `scratchTitle` reads it off the source to name a script, and the run
 * log reads it off the request to tell two hundred calls to the same method
 * apart. Ordered — an explicit id beats a name.
 */
export const SUBJECT_FIELDS = [/^id$/i, /_id$/i, /Id$/, /^slug$/i, /^key$/i, /^code$/i, /^name$/i, /^email$/i, /^title$/i];

const MAX_KEY = 22;
// Deep enough for a request that wraps its subject in one envelope, shallow
// enough that a key never comes from somewhere nobody would look.
const MAX_DEPTH = 2;

/**
 * The value that tells one call in a loop from the next, read from the request
 * it was made with. Undefined when nothing in the request identifies anything,
 * which is the common case for a call made once — there the method name is
 * already unique in the run and the slot stays empty.
 */
export function loopKey(input: unknown): string | undefined {
  if (!isPlainObject(input)) return undefined;
  for (const pattern of SUBJECT_FIELDS) {
    const found = find(input, pattern, 0);
    if (found !== undefined) return found;
  }
  return undefined;
}

function find(object: { [key: string]: unknown }, pattern: RegExp, depth: number): string | undefined {
  for (const [name, value] of Object.entries(object)) {
    if (pattern.test(name)) {
      const scalar = identifying(value);
      if (scalar !== undefined) return scalar;
    }
    if (depth < MAX_DEPTH && isPlainObject(value)) {
      const nested = find(value, pattern, depth + 1);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

// A generated request holds zero values, so an empty string or a 0 is the
// absence of an answer rather than one worth showing. A 64-bit field is
// generated as a string, so its zero arrives as text.
function identifying(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" || /^-?0+$/.test(trimmed) ? undefined : truncate(trimmed);
  }
  if (typeof value === "number") return value === 0 ? undefined : truncate(String(value));
  if (typeof value === "bigint") return value === 0n ? undefined : truncate(String(value));
  return undefined;
}

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string): string {
  return value.length > MAX_KEY ? `${value.slice(0, MAX_KEY - 1)}…` : value;
}

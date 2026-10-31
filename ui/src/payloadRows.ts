import { readInstant } from "./cellTime";
import { lists } from "./pages";

/**
 * A payload read as a list of fields, one level at a time: what a phone draws in
 * place of the JSON text, which spends a 360px screen on indentation and quotes
 * and sends every long value off its right edge.
 *
 * Only the drawing changes. The fields come in the order the payload holds them,
 * a value is never rewritten into something the API did not send, and what is
 * copied is the JSON of the level on screen.
 */

export type Path = (string | number)[];

export type FieldValue =
  | { kind: "text"; text: string }
  | { kind: "instant"; text: string; date: Date }
  | { kind: "url"; text: string }
  | { kind: "number"; text: string }
  | { kind: "boolean"; text: string }
  | { kind: "null" }
  | { kind: "empty" }
  | { kind: "bytes"; length: number }
  | { kind: "object"; label?: string; count: number }
  | { kind: "array"; label?: string; count: number };

export interface Field {
  key: string | number;
  value: FieldValue;
}

// Past this many rows a level is a list nobody scrolls to the end of, and drawing
// it is what makes the pane slow to follow a run.
export const MAX_FIELDS = 500;

export function isContainer(node: unknown): node is Record<string, unknown> | unknown[] {
  return node !== null && typeof node === "object" && !ArrayBuffer.isView(node) && !(node instanceof Date);
}

// The node a path names, or undefined once the payload no longer has it — which is
// how a level held open across a new response is let go of.
export function nodeAt(root: unknown, path: Path): unknown {
  let node = root;
  for (const step of path) {
    if (!isContainer(node)) return undefined;
    node = (node as Record<string | number, unknown>)[step];
  }
  return node;
}

export function fields(node: unknown): Field[] {
  if (Array.isArray(node)) return node.slice(0, MAX_FIELDS).map((item, index) => ({ key: index, value: readValue(item) }));
  if (!isContainer(node)) return [];
  return Object.entries(node)
    .filter(([, item]) => item !== undefined)
    .slice(0, MAX_FIELDS)
    .map(([key, item]) => ({ key, value: readValue(item) }));
}

// The list a page is about, on kaja.pages' reading of a page: the one list on it, the
// rest being plain values such as a cursor or a total. Drawn in place at the top, so
// the rows are not a tap away; an empty list is left a row, a blank screen reading as
// the whole response.
export function pageList(node: unknown): string | undefined {
  if (!isContainer(node) || Array.isArray(node)) return undefined;
  const keys = lists(node);
  if (keys.length !== 1) return undefined;
  const items = node[keys[0]] as unknown[];
  if (items.length === 0) return undefined;
  const plain = Object.entries(node).every(([key, item]) => key === keys[0] || !isContainer(item));
  return plain ? keys[0] : undefined;
}

export function fieldCount(node: unknown): number {
  if (Array.isArray(node)) return node.length;
  if (!isContainer(node)) return 0;
  return Object.values(node).filter((item) => item !== undefined).length;
}

const URL_PATTERN = /^https?:\/\/\S+$/i;

export function readValue(value: unknown): FieldValue {
  if (value === null || value === undefined) return { kind: "null" };
  if (typeof value === "string") {
    if (value === "") return { kind: "empty" };
    const date = readInstant(value);
    if (date) return { kind: "instant", text: value, date };
    if (URL_PATTERN.test(value)) return { kind: "url", text: value };
    return { kind: "text", text: value };
  }
  if (typeof value === "number" || typeof value === "bigint") return { kind: "number", text: String(value) };
  if (typeof value === "boolean") return { kind: "boolean", text: String(value) };
  if (ArrayBuffer.isView(value)) return { kind: "bytes", length: value.byteLength };
  if (Array.isArray(value)) return { kind: "array", label: arrayLabel(value), count: value.length };
  if (isContainer(value)) return { kind: "object", label: objectLabel(value as Record<string, unknown>), count: fieldCount(value) };
  return { kind: "text", text: String(value) };
}

// The fields a person would call an object by, in the order they are asked. An id
// is last because it names a record without saying anything about it.
const NAME_KEYS = ["name", "title", "displayName", "fullName", "login", "username", "email", "label", "key", "summary", "id"];

// An object's row says which one it is, so a level can be read before it is opened.
export function objectLabel(node: Record<string, unknown>): string | undefined {
  for (const key of NAME_KEYS) {
    const value = node[key];
    if (typeof value === "string" && value !== "" && value.length <= 80) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

// A list of plain values says its first few; a list of records says nothing beyond
// its count, since the first record's name is not the list's.
function arrayLabel(items: unknown[]): string | undefined {
  const head = items.slice(0, 4);
  if (head.length === 0 || !head.every((item) => typeof item === "string" || typeof item === "number")) return undefined;
  const text = head.join(", ");
  return items.length > head.length ? `${text}, …` : text;
}

export function countLabel(value: { kind: "object" | "array"; count: number }): string {
  if (value.kind === "array") return value.count === 1 ? "1 item" : `${value.count} items`;
  return value.count === 1 ? "1 field" : `${value.count} fields`;
}

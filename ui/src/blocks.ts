/**
 * What a run drew. A script says what it made, never how it looks, so the set is
 * closed and small — the canvas renders these four and nothing else. The moment
 * a script can paint, the console is a rendering engine and every block becomes
 * a support surface.
 */
export interface TextBlock {
  kind: "text";
  text: string;
}

export interface CodeBlock {
  kind: "code";
  code: string;
  language?: string;
}

export interface TableBlock {
  kind: "table";
  columns: string[];
  rows: string[][];
}

/**
 * The one block that is a question rather than an answer. It has no value until
 * the run is answered, and until then the run is parked on it — which is what
 * makes the canvas a canvas rather than a report.
 */
export interface AskBlock {
  kind: "ask";
  question: string;
  answer?: string;
  cancelled?: boolean;
}

export type Block = TextBlock | CodeBlock | TableBlock | AskBlock;

let sequence = 0;

export function newBlockId(): string {
  sequence++;
  return `block-${Date.now().toString(36)}-${sequence}`;
}

// The run is stopped here until this is answered. A cancelled ask stopped the
// script instead, so it is settled rather than waiting.
export function isAwaitingAnswer(block: Block): boolean {
  return block.kind === "ask" && block.answer === undefined && block.cancelled !== true;
}

// How a block is named where only one line fits. A table is described by its
// size, because its first cell is rarely what tells two tables apart.
export function blockLabel(block: Block): string {
  switch (block.kind) {
    case "text":
      return firstLine(block.text) || "Text";
    case "code":
      return firstLine(block.code) || "Code";
    case "table":
      return `${block.rows.length} ${block.rows.length === 1 ? "row" : "rows"}`;
    case "ask":
      return block.question;
  }
}

// The canvas as text, for the copy button. A table goes out as its columns and
// rows rather than as a drawing of one, so it can be pasted somewhere useful.
export function blockText(block: Block): string {
  switch (block.kind) {
    case "text":
      return block.text;
    case "code":
      return block.code;
    case "table":
      return [block.columns, ...block.rows].map((cells) => cells.join("\t")).join("\n");
    case "ask":
      return block.cancelled ? `${block.question}\n(cancelled)` : `${block.question}\n${block.answer ?? ""}`;
  }
}

// Cells arrive from a script, so they are whatever the script had — a number, a
// date, an object it never meant to print. Everything lands as text, because a
// table column that is sometimes a value and sometimes "[object Object]" is
// worse than one that is always readable.
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

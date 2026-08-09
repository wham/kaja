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

/**
 * A table's rows are an iterable, and that is the whole of static-versus-live: an
 * array is one, and so is a generator the script left open. Everything here is
 * plain JSON because a block is stored as itself — the source that fills a live
 * table lives beside it, in the Kaja instance, keyed by the block's id.
 */
export interface TableBlock {
  kind: "table";
  columns: string[];
  rows: string[][];
  // Rows come from a source that is still open, so paging forward pulls more.
  live?: boolean;
  // A pull is in flight. The table says so; the run does not, because the run is
  // over — this is the canvas fetching, not the script running.
  loading?: boolean;
  // The source ran out, so the rows are the whole set and a live table has
  // become an ordinary one.
  exhausted?: boolean;
  // The source takes the search text, so a new search restarts it. Without this
  // the search box filters the rows already loaded and never fetches.
  serverSearch?: boolean;
  // Which search the loaded rows answer, for a source that takes one.
  loadedSearch?: string;
  // The source is gone — this run was read back from an earlier session, or its
  // closure was let go. Expiry is a stated state, not a Next that leads nowhere.
  expired?: boolean;
  // How many rows a page holds. Absent means the default.
  pageSize?: number;
  // What the last pull failed with. The call itself is in the log; this is what
  // the table says about why it stopped filling.
  error?: string;
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

/**
 * A call the script is holding back until it is approved. The other block that
 * stops the run — and the only one that decides something rather than showing
 * it: not approving stops the script where it stands, so the call it names is
 * one that never happened.
 */
export interface ApproveBlock {
  kind: "approve";
  // The call, as "Service.Method".
  method: string;
  // The request it is about to send, already text.
  request: string;
  decision?: "approved" | "rejected";
}

export type Block = TextBlock | CodeBlock | TableBlock | AskBlock | ApproveBlock;

let sequence = 0;

export function newBlockId(): string {
  sequence++;
  return `block-${Date.now().toString(36)}-${sequence}`;
}

// The run is stopped here until the user says something. A cancelled ask and a
// rejected call both stopped the script instead, so they are settled rather than
// waiting.
export function isAwaitingUser(block: Block): boolean {
  if (block.kind === "ask") return block.answer === undefined && block.cancelled !== true;
  if (block.kind === "approve") return block.decision === undefined;
  return false;
}

// How a block is named where only one line fits. A table is described by its
// size, because its first cell is rarely what tells two tables apart.
export function blockLabel(block: Block): string {
  switch (block.kind) {
    case "text":
      return firstLine(block.text) || "Text";
    case "code":
      return firstLine(block.code) || "Code";
    case "table": {
      const rows = `${block.rows.length} ${block.rows.length === 1 ? "row" : "rows"}`;
      // A live table's count is what it has so far, which is a different claim
      // from a static table's count and has to read as one.
      return block.live && !block.exhausted ? `${rows} loaded` : rows;
    }
    case "ask":
      return block.question;
    case "approve":
      // The verb is in the present tense only while it is still a question.
      switch (block.decision) {
        case "approved":
          return `${block.method} approved`;
        case "rejected":
          return `${block.method} not approved`;
        default:
          return `Approve ${block.method}`;
      }
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
    case "approve":
      return `${blockLabel(block)}\n${block.request}`;
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

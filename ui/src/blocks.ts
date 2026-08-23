import { AskAnswerType } from "./ask";

/**
 * What a run drew. A script says what it made, never how it looks, so the set is
 * closed and small — the moment a script can paint, the console is a rendering engine
 * and every block becomes a support surface.
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
 * A table's rows are an iterable, and that is the whole of static-versus-live.
 * Everything here is plain JSON because a block is stored as itself — the source that
 * fills a live table lives beside it on the Kaja instance, keyed by the block's id.
 */
/**
 * What a cell is doing instead of holding a value. No error means it is still coming;
 * an error means it stopped, and `retry` says whether asking again could work.
 *
 * Whether the work has *started* is not in here — that is the closure side's business.
 * A thunk nobody has reached and a promise still in flight are the same sentence to
 * the canvas, and it is the true one.
 */
export interface CellStatus {
  error?: string;
  retry?: boolean;
}

export interface TableBlock {
  kind: "table";
  columns: string[];
  rows: string[][];
  // Sparse at both levels and absent from a table that has none, so a table of plain
  // cells is stored exactly as it was before any of this existed.
  cells?: { [row: number]: { [column: number]: CellStatus } };
  // Rows come from a source that is still open, so paging forward pulls more.
  live?: boolean;
  // The table says so; the run does not, because the run is over — this is the canvas
  // fetching, not the script running.
  loading?: boolean;
  // The source ran out, so a live table has become an ordinary one.
  exhausted?: boolean;
  // The source takes the search text, so a new search restarts it. Without this the
  // search box filters the rows already loaded and never fetches.
  serverSearch?: boolean;
  loadedSearch?: string;
  // The source is gone — read back from an earlier session, or its closure let go.
  // Expiry is a stated state, not a Next that leads nowhere.
  expired?: boolean;
  // Absent means the default.
  pageSize?: number;
  // As the script reported it, which nothing else here could know. Absent is the
  // honest state of a cursor-based source.
  total?: number;
  // The call itself is in the log; this is what the table says about why it stopped.
  error?: string;
}

/**
 * The one block that is a question rather than an answer. It has no value until the
 * run is answered, and until then the run is parked on it.
 */
export interface AskBlock {
  kind: "ask";
  question: string;
  // The block carries it rather than the script, because the canvas draws the control
  // and checks the answer, and a run read back has to draw the same question it asked.
  answerType: AskAnswerType;
  // The answer is one of these, which is what makes a stored select readable without
  // its script.
  choices?: string[];
  // Always text, whatever was asked for — a block is stored as itself, and the typed
  // value is the script's copy rather than the run's record.
  answer?: string;
  cancelled?: boolean;
}

/**
 * A call the script is holding back until it is approved. The only block that decides
 * something rather than showing it: not approving stops the script, so the call it
 * names is one that never happened.
 */
export interface ApproveBlock {
  kind: "approve";
  method: string;
  // Already text.
  request: string;
  decision?: "approved" | "rejected";
  // The calls that ride on a standing approval draw no block of their own, so this is
  // the one place one is recorded — and what a run read back has to say instead of
  // falling silent about a decision made once and used ten times.
  standing?: boolean;
}

/**
 * How a held call is settled. Nothing here reaches past the run — a standing approval
 * is a decision about what is in front of you, not a policy the workspace keeps.
 */
export type ApproveGesture = "approved" | "all" | "rejected";

/**
 * What a perf test drew: the same tiles the Stats page opens with, and the way there.
 * A test that ran for a minute has to leave something on the canvas — a presented run
 * (a deeplink, an agent) would otherwise have nothing to show for it — but the canvas
 * is not where the charts belong, so the block is the headline and a link.
 */
export interface PerfBlock {
  kind: "perf";
  // What the schedule was: "1000 iter · 10 vu", or "30s · 10 vu".
  schedule: string;
  running?: boolean;
  requests: number;
  failures: number;
  errorRate: number;
  meanRps: number;
  p50?: number;
  p95?: number;
  p99?: number;
  durationMs?: number;
  excludedWarmup?: number;
  excludedFailures?: number;
}

export type Block = TextBlock | CodeBlock | TableBlock | AskBlock | ApproveBlock | PerfBlock;

export function cellStatus(block: TableBlock, row: number, column: number): CellStatus | undefined {
  return block.cells?.[row]?.[column];
}

/**
 * The same map with one cell set, or cleared once its value is here. A new object at
 * every level, on the same rule the rows follow: the canvas compares what it was
 * handed against what it holds, and a map written in place is invisible to it. An
 * empty map is dropped rather than kept as `{}`.
 */
export function withCellStatus(block: TableBlock, row: number, column: number, status: CellStatus | undefined): TableBlock["cells"] {
  const cells = { ...(block.cells ?? {}) };
  const inRow = { ...(cells[row] ?? {}) };
  if (status === undefined) delete inRow[column];
  else inRow[column] = status;
  if (Object.keys(inRow).length === 0) delete cells[row];
  else cells[row] = inRow;
  return Object.keys(cells).length === 0 ? undefined : cells;
}

/**
 * …and with a whole row's cells cleared, which is what rewriting a row does: the cells
 * that were on their way answered the row as it was.
 */
export function withoutRowStatus(block: TableBlock, row: number): TableBlock["cells"] {
  if (block.cells?.[row] === undefined) return block.cells;
  const cells = { ...block.cells };
  delete cells[row];
  return Object.keys(cells).length === 0 ? undefined : cells;
}

let sequence = 0;

export function newBlockId(): string {
  sequence++;
  return `block-${Date.now().toString(36)}-${sequence}`;
}

// A cancelled ask and a rejected call both stopped the script instead, so they are
// settled rather than waiting.
export function isAwaitingUser(block: Block): boolean {
  if (block.kind === "ask") return block.answer === undefined && block.cancelled !== true;
  if (block.kind === "approve") return block.decision === undefined;
  return false;
}

// A table is described by its size, because its first cell is rarely what tells two
// tables apart.
export function blockLabel(block: Block): string {
  switch (block.kind) {
    case "text":
      return firstLine(block.text) || "Text";
    case "code":
      return firstLine(block.code) || "Code";
    case "table": {
      const rows = `${block.rows.length} ${block.rows.length === 1 ? "row" : "rows"}`;
      // A live table's count is what it has so far, which is a different claim from a
      // static table's count and has to read as one.
      return block.live && !block.exhausted ? `${rows} loaded` : rows;
    }
    case "ask":
      return block.question;
    case "approve":
      // Present tense only while it is still a question.
      switch (block.decision) {
        case "approved":
          return block.standing ? `All ${block.method} approved` : `${block.method} approved`;
        case "rejected":
          return `${block.method} not approved`;
        default:
          return `Approve ${block.method}`;
      }
    case "perf":
      return block.running ? `Perf test · ${block.schedule}` : `Perf test · ${block.requests.toLocaleString()} requests`;
  }
}

// Cells arrive from a script, so they are whatever the script had. Everything lands
// as text: a column that is sometimes a value and sometimes "[object Object]" is
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

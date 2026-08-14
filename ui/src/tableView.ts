import { TableBlock } from "./blocks";

/**
 * How a table is windowed and searched. The pager is over **rows, not requests**:
 * Next means "the next page of rows, fetching if I have run out", so a source
 * that yields in batches of 25 fetches twice per page of 50 and one that yields
 * 500 does not fetch for ten pages. The script never thinks about it.
 */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * The frame a table is drawn in. The heights are stated here as well as in the
 * class names because the room a page takes is arithmetic the table does: a page
 * in flight holds exactly the height the page it is fetching will fill, so
 * nothing below the table moves while it is fetched.
 */
const ROW_HEIGHT = 26;
const HEADER_HEIGHT = 28;

// Where a table is currently pointed. This is view state rather than something
// the run drew, so it is held beside the console and not in the block.
export interface TableView {
  page: number;
  search: string;
}

export const NO_TABLE_VIEW: TableView = { page: 0, search: "" };

export function pageSizeOf(block: TableBlock): number {
  const size = block.pageSize;
  return size !== undefined && size > 0 ? Math.floor(size) : DEFAULT_PAGE_SIZE;
}

/**
 * Whether the search box goes to the source or filters what is on screen. A
 * source that declares a search parameter is asked; one that doesn't isn't, and
 * a local filter never fetches — searching would otherwise mean pulling an API
 * dry to find three rows.
 */
export function searchesLocally(block: TableBlock): boolean {
  return block.serverSearch !== true;
}

// A row matches if any of its cells contains the text. Cells are already
// formatted to strings by the time they reach a block, so there is one rule.
export function matchesSearch(row: string[], search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  return row.some((cell) => cell.toLowerCase().includes(needle));
}

// Whether the table shows a search box and a pager at all. Controls appear when
// there is something to control: a live table can always grow, and a static one
// that fits on a page reads exactly as it did before any of this existed.
export function hasControls(block: TableBlock): boolean {
  return block.live === true || block.expired === true || block.rows.length > pageSizeOf(block);
}

/**
 * How big the whole result set is, and whether that is the size of it or only
 * what has been seen so far. A script that has an API's count says it; one
 * paging a cursor has nothing to say, and the table counts what it has and marks
 * the number as a floor rather than passing it off as the total.
 */
export interface TableTotal {
  count: number;
  exact: boolean;
}

export function totalOf(block: TableBlock): TableTotal {
  // A total is a claim and exhaustion is the truth: a source that reported 2,431
  // and ran out at 2,000 has 2,000 rows in it. The other way round, a count the
  // rows have already passed is a number the table can see is wrong.
  if (block.total !== undefined && block.exhausted !== true) return { count: Math.max(block.total, block.rows.length), exact: true };
  return { count: block.rows.length, exact: !isOpen(block) };
}

export interface TableWindow {
  // The rows to draw, and where they sit in what the table has.
  rows: string[][];
  // Where each drawn row sits in `block.rows`, which is what a cell that isn't
  // here yet is addressed by. Arithmetic but for a local filter, which is
  // exactly what makes it worth carrying rather than recomputing.
  indices: number[];
  page: number;
  from: number;
  to: number;
  // Rows the window pages over: the loaded rows, or what a local search left.
  total: number;
  loaded: number;
  // A local search is narrowing the loaded rows.
  filtered: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  // How many rows the source must hold for this page to be full.
  want: number;
  // The page isn't here yet and the source can still bring it, so what is drawn
  // is a page in flight rather than the page as it is.
  pending: boolean;
  // What stays on screen while it is: the page that was being read, which is
  // dimmed rather than thrown away. Empty when there is nothing to hold — the
  // first draw of a table, or a source restarted by a search.
  held: string[][];
  heldIndices: number[];
  // How many rows this page holds once it is here. A total the source reported
  // is what makes a short last page reserve the room it will actually take.
  expected: number;
}

/**
 * What to draw for a page. The page is clamped rather than corrected, so a
 * search that shrinks the set shows its last page instead of an empty one.
 */
export function tableWindow(block: TableBlock, view: TableView): TableWindow {
  const size = pageSizeOf(block);
  const filtered = searchesLocally(block) && view.search.trim() !== "";
  // A filter keeps the rows it matched *and* where they came from: a cell is
  // addressed by its place in the table, not by where it landed on the page.
  const matched = filtered ? block.rows.flatMap((row, index) => (matchesSearch(row, view.search) ? [index] : [])) : undefined;
  const rows = matched ? matched.map((index) => block.rows[index]) : block.rows;
  // The last page of what is loaded — plus one while the source is open, since
  // paging into rows that aren't here yet is exactly how they are asked for.
  const loadedPages = Math.max(0, Math.ceil(rows.length / size) - 1);
  const page = Math.max(0, Math.min(view.page, canGrow(block) && !filtered ? loadedPages + 1 : loadedPages));
  const start = page * size;
  const shown = rows.slice(start, start + size);

  // A page that isn't full yet and a source that can still fill it: the rows are
  // on their way. An error is the one thing that says they are not — the table
  // stopped where it stopped, and Retry is what asks again.
  const pending = !filtered && block.error === undefined && shown.length < size && canGrow(block);
  const whole = totalOf(block);
  const expected = !filtered && whole.exact ? Math.max(0, Math.min(size, whole.count - start)) : size;
  // The range being fetched, not the rows in hand: the toolbar states the page
  // that was clicked for as long as it takes to arrive, rather than dropping to
  // zero and back on every click.
  const to = pending ? start + expected : start + shown.length;

  const at = (from: number, count: number) => (matched ? matched.slice(from, from + count) : Array.from({ length: count }, (_, offset) => from + offset));
  const held = pending && page > 0 ? rows.slice(start - size, start) : [];

  return {
    rows: shown,
    indices: at(start, shown.length),
    page,
    from: to === 0 ? 0 : start + 1,
    to,
    total: rows.length,
    loaded: block.rows.length,
    filtered,
    pending,
    held,
    heldIndices: at(start - size, held.length),
    expected,
    hasPrevious: page > 0,
    // No lookahead: pulling one row past the page to light the button up would
    // fetch a whole page to answer a question nobody asked. A live source offers
    // Next until it runs out, and a click that yields nothing closes it out —
    // unless it reported a total, which is exactly the click that saves.
    hasNext: start + shown.length < rows.length || (canGrow(block) && !filtered),
    want: (page + 1) * size,
  };
}

// Whether more rows can still be had from the source.
export function isOpen(block: TableBlock): boolean {
  return block.live === true && block.exhausted !== true && block.expired !== true;
}

// …and whether they are worth asking for. A source that reported a total has
// said where it ends, so the pager stops there rather than on the click that
// comes back with nothing.
export function canGrow(block: TableBlock): boolean {
  return isOpen(block) && (block.total === undefined || block.rows.length < block.total);
}

/**
 * Whether this page needs the source pulled, and for how many rows. Two things
 * ask for a pull: a page the loaded rows don't reach, and a search a source that
 * takes one hasn't answered yet. A local filter never does — it searches what is
 * loaded, which is what the footer says it is doing.
 */
export function pullNeeded(block: TableBlock, view: TableView): { needed: boolean; want: number } {
  const want = (Math.max(0, view.page) + 1) * pageSizeOf(block);
  // A source that was never there or is gone is the one thing nothing gets past.
  if (block.live !== true || block.expired === true) return { needed: false, want };

  // A search the source takes **restarts** it, so it outranks every state the
  // current result set is in: rows that ran out, a pull still filling them, and
  // the error the last one stopped on all belong to a question nobody is asking
  // any more. Reading them as reasons not to pull is what left the box dead
  // after one search that happened to exhaust its source.
  if (!searchesLocally(block) && (block.loadedSearch ?? "") !== view.search) return { needed: true, want };

  if (block.loading === true || block.error !== undefined || block.exhausted === true) return { needed: false, want };
  // Searching what is loaded must not pull an API dry to find three rows.
  if (searchesLocally(block) && view.search.trim() !== "") return { needed: false, want };
  return { needed: canGrow(block) && block.rows.length < want, want };
}

/** One cell of one row, which is what a cell that isn't here yet is asked for by. */
export interface CellRef {
  row: number;
  column: number;
  // Ask again for a cell that stopped. The canvas draws a failed cell on every
  // frame, so retrying on sight would be a loop rather than a retry — this is
  // the click and nothing else.
  retry?: boolean;
}

/**
 * Which cells the drawn rows are waiting for. A cell is asked for when it is
 * drawn, so a table of five hundred rows costs five hundred calls only if you
 * page through all of it — the same bargain the pager makes for the rows
 * themselves. Asking for one already running is free: the table starts a cell
 * once, and knows which ones it has started.
 */
export function pendingCells(block: TableBlock, indices: number[]): CellRef[] {
  // A source that is gone took its cells with it, and what is left is a state
  // the table already says: run it again to load the rest.
  if (block.cells === undefined || block.expired === true) return [];
  const refs: CellRef[] = [];
  for (const row of indices) {
    for (const [column, status] of Object.entries(block.cells[row] ?? {})) {
      if (status.error === undefined) refs.push({ row, column: Number(column) });
    }
  }
  return refs;
}

/** What identifies a set of cells to an effect that must not fire twice for it. */
export function cellsKey(cells: CellRef[]): string {
  return cells.map(({ row, column }) => `${row}:${column}`).join(",");
}

/**
 * Whether the frame keeps the height of a full page. A fetch is 200–800ms and a
 * table is drawn in the middle of a document, so a page that collapsed to a
 * loading row and grew back would move everything below it twice per click. The
 * frame holds for as long as the table can page; only the final page of a table
 * that can no longer page shrinks to its rows, and by then nothing is going to
 * move again. A local filter is instant and its result is the whole of it, so it
 * is the one narrowing that is allowed to shrink.
 */
export function holdsPage(block: TableBlock, window: TableWindow): boolean {
  if (!hasControls(block) || window.filtered) return false;
  return window.pending || block.loading === true || window.hasNext;
}

/** The height that hold comes to, or nothing where the rows decide it. */
export function bodyMinHeight(block: TableBlock, window: TableWindow): number | undefined {
  if (!holdsPage(block, window)) return undefined;
  return HEADER_HEIGHT + window.expected * ROW_HEIGHT;
}

/**
 * What the toolbar says about how much there is. One sentence in one shape —
 * `1–50 of 2,431` — with a `+` where the total is a floor rather than a count:
 * the script reported one, or the source ran out and what is loaded is all there
 * was, or neither and the table says how far it has got.
 */
export function tableSummary(block: TableBlock, window: TableWindow): string {
  const range = `${count(window.from)}–${count(window.to)}`;
  if (window.filtered) {
    return window.total === 0
      ? `No rows matching · ${count(window.loaded)} loaded`
      : `${range} of ${count(window.total)} matching · ${count(window.loaded)} loaded`;
  }
  const whole = totalOf(block);
  // A page in flight states the page that was clicked. A source that reported a
  // count says it too — that is the whole of what is known — and one that hasn't
  // says only which rows are on their way, rather than passing off what it
  // happens to hold as the size of the set.
  if (window.pending) return whole.exact && whole.count > 0 ? `${range} of ${count(whole.count)}` : `Loading ${range}…`;
  if (whole.count === 0) return "No rows";
  const total = `${count(whole.count)}${whole.exact ? "" : "+"}`;
  // A source that said how many there are and then stopped before sending any.
  if (window.to === 0) return `0 of ${total}`;
  if (block.expired === true) return `${range} of ${total} loaded — run to load the rest`;
  return `${range} of ${total}`;
}

function count(value: number): string {
  return value.toLocaleString();
}

const NUMBER = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?$/;

/**
 * Which columns read from the right. A script hands the table text, so this is
 * decided by what the cells are rather than by anything declared: a column is a
 * column of numbers when every cell in it that says anything is one. It is
 * settled on the page being drawn, which is the only place it shows.
 */
export function numericColumns(rows: string[][], columns: number): boolean[] {
  return Array.from({ length: columns }, (_, index) => {
    let seen = false;
    for (const row of rows) {
      const cell = (row[index] ?? "").trim();
      if (cell === "") continue;
      if (!NUMBER.test(cell)) return false;
      seen = true;
    }
    return seen;
  });
}

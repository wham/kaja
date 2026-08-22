import { TableBlock } from "./blocks";

/**
 * The pager is over rows, not requests: Next means "the next page of rows, fetching
 * if I have run out", so a source yielding in batches of 25 fetches twice per page of
 * 50 and one yielding 500 does not fetch for ten pages.
 */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * The heights are stated here as well as in the class names because the room a page
 * takes is arithmetic the table does: a page in flight holds exactly the height the
 * page it is fetching will fill, so nothing below the table moves.
 */
const ROW_HEIGHT = 26;
const HEADER_HEIGHT = 28;

// View state rather than something the run drew, so it is held beside the console
// and not in the block.
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
 * Whether the search box goes to the source or filters what is on screen. A source
 * that declares a search parameter is asked; a local filter never fetches, since
 * searching would otherwise mean pulling an API dry to find three rows.
 */
export function searchesLocally(block: TableBlock): boolean {
  return block.serverSearch !== true;
}

// Cells are already formatted to strings by the time they reach a block, so there
// is one rule.
export function matchesSearch(row: string[], search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  return row.some((cell) => cell.toLowerCase().includes(needle));
}

// Controls appear when there is something to control: a live table can always grow,
// and a static one that fits on a page needs neither.
export function hasControls(block: TableBlock): boolean {
  return block.live === true || block.expired === true || block.rows.length > pageSizeOf(block);
}

/**
 * How big the whole result set is, and whether that is the size of it or only what
 * has been seen. A script paging a cursor has nothing to say, so the table counts
 * what it has and marks the number as a floor.
 */
export interface TableTotal {
  count: number;
  exact: boolean;
}

export function totalOf(block: TableBlock): TableTotal {
  // A total is a claim and exhaustion is the truth: a source that reported 2,431 and
  // ran out at 2,000 has 2,000 rows. The other way round, a count the rows have
  // already passed is a number the table can see is wrong.
  if (block.total !== undefined && block.exhausted !== true) return { count: Math.max(block.total, block.rows.length), exact: true };
  return { count: block.rows.length, exact: !isOpen(block) };
}

export interface TableWindow {
  rows: string[][];
  // Where each drawn row sits in `block.rows`, which is what a cell that isn't here
  // yet is addressed by. Arithmetic but for a local filter, which is what makes it
  // worth carrying rather than recomputing.
  indices: number[];
  page: number;
  from: number;
  to: number;
  // The loaded rows, or what a local search left.
  total: number;
  loaded: number;
  filtered: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  want: number;
  // The page isn't here yet and the source can still bring it.
  pending: boolean;
  // The page that was being read, dimmed rather than thrown away. Empty when there is
  // nothing to hold — a first draw, or a source restarted by a search.
  held: string[][];
  heldIndices: number[];
  // A total the source reported is what makes a short last page reserve the room it
  // will actually take.
  expected: number;
}

/**
 * The page is clamped rather than corrected, so a search that shrinks the set shows
 * its last page instead of an empty one.
 */
export function tableWindow(block: TableBlock, view: TableView): TableWindow {
  const size = pageSizeOf(block);
  const filtered = searchesLocally(block) && view.search.trim() !== "";
  // A filter keeps the rows it matched *and* where they came from: a cell is addressed
  // by its place in the table, not by where it landed on the page.
  const matched = filtered ? block.rows.flatMap((row, index) => (matchesSearch(row, view.search) ? [index] : [])) : undefined;
  const rows = matched ? matched.map((index) => block.rows[index]) : block.rows;
  // Plus one while the source is open, since paging into rows that aren't here yet is
  // exactly how they are asked for.
  const loadedPages = Math.max(0, Math.ceil(rows.length / size) - 1);
  const page = Math.max(0, Math.min(view.page, canGrow(block) && !filtered ? loadedPages + 1 : loadedPages));
  const start = page * size;
  const shown = rows.slice(start, start + size);

  // A page that isn't full and a source that can still fill it. An error is the one
  // thing that says the rows are not coming.
  const pending = !filtered && block.error === undefined && shown.length < size && canGrow(block);
  const whole = totalOf(block);
  const expected = !filtered && whole.exact ? Math.max(0, Math.min(size, whole.count - start)) : size;
  // The range being fetched, not the rows in hand: the toolbar states the page that
  // was clicked rather than dropping to zero and back on every click.
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
    // No lookahead: pulling one row past the page to light the button up would fetch a
    // whole page to answer a question nobody asked. A live source offers Next until it
    // runs out — unless it reported a total, which is the click that saves.
    hasNext: start + shown.length < rows.length || (canGrow(block) && !filtered),
    want: (page + 1) * size,
  };
}

export function isOpen(block: TableBlock): boolean {
  return block.live === true && block.exhausted !== true && block.expired !== true;
}

// A source that reported a total has said where it ends, so the pager stops there
// rather than on the click that comes back with nothing.
export function canGrow(block: TableBlock): boolean {
  return isOpen(block) && (block.total === undefined || block.rows.length < block.total);
}

/**
 * Whether this page needs the source pulled, and for how many rows. Two things ask:
 * a page the loaded rows don't reach, and a search a source that takes one hasn't
 * answered yet. A local filter never does.
 */
export function pullNeeded(block: TableBlock, view: TableView): { needed: boolean; want: number } {
  const want = (Math.max(0, view.page) + 1) * pageSizeOf(block);
  // A source that was never there or is gone is the one thing nothing gets past.
  if (block.live !== true || block.expired === true) return { needed: false, want };

  // A search the source takes restarts it, so it outranks every state the current
  // result set is in: exhausted rows, a pull still filling them, and the error the last
  // one stopped on all belong to a question nobody is asking any more.
  if (!searchesLocally(block) && (block.loadedSearch ?? "") !== view.search) return { needed: true, want };

  if (block.loading === true || block.error !== undefined || block.exhausted === true) return { needed: false, want };
  // Searching what is loaded must not pull an API dry to find three rows.
  if (searchesLocally(block) && view.search.trim() !== "") return { needed: false, want };
  return { needed: canGrow(block) && block.rows.length < want, want };
}

export interface CellRef {
  row: number;
  column: number;
  // The canvas draws a failed cell on every frame, so retrying on sight would be a
  // loop rather than a retry — this is the click and nothing else.
  retry?: boolean;
}

/**
 * Which cells the drawn rows are waiting for. A cell is asked for when it is drawn,
 * so five hundred rows cost five hundred calls only if you page through all of them.
 * Asking for one already running is free: the table starts a cell once.
 */
export function pendingCells(block: TableBlock, indices: number[]): CellRef[] {
  // A source that is gone took its cells with it.
  if (block.cells === undefined || block.expired === true) return [];
  const refs: CellRef[] = [];
  for (const row of indices) {
    for (const [column, status] of Object.entries(block.cells[row] ?? {})) {
      if (status.error === undefined) refs.push({ row, column: Number(column) });
    }
  }
  return refs;
}

export function cellsKey(cells: CellRef[]): string {
  return cells.map(({ row, column }) => `${row}:${column}`).join(",");
}

/**
 * Whether the frame keeps the height of a full page. A fetch is 200–800ms and a table
 * sits in the middle of a document, so a page that collapsed and grew back would move
 * everything below it twice per click. Only the final page of a table that can no
 * longer page shrinks; a local filter is instant, so it is the one narrowing allowed to.
 */
export function holdsPage(block: TableBlock, window: TableWindow): boolean {
  if (!hasControls(block) || window.filtered) return false;
  return window.pending || block.loading === true || window.hasNext;
}

export function bodyMinHeight(block: TableBlock, window: TableWindow): number | undefined {
  if (!holdsPage(block, window)) return undefined;
  return HEADER_HEIGHT + window.expected * ROW_HEIGHT;
}

/**
 * What the toolbar says about how much there is: `1–50 of 2,431`, with a `+` where the
 * total is a floor rather than a count.
 */
export function tableSummary(block: TableBlock, window: TableWindow): string {
  const range = `${count(window.from)}–${count(window.to)}`;
  if (window.filtered) {
    return window.total === 0
      ? `No rows matching · ${count(window.loaded)} loaded`
      : `${range} of ${count(window.total)} matching · ${count(window.loaded)} loaded`;
  }
  const whole = totalOf(block);
  // A page in flight states the page that was clicked. A source that reported a count
  // says it too; one that hasn't says only which rows are on their way, rather than
  // passing off what it happens to hold as the size of the set.
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
 * Which columns read from the right. A script hands the table text, so this is decided
 * by what the cells are: a column is numeric when every cell in it that says anything
 * is a number. Settled on the page being drawn, which is the only place it shows.
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

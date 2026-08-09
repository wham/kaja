import { TableBlock } from "./blocks";

/**
 * How a table is windowed and searched. The pager is over **rows, not requests**:
 * Next means "the next page of rows, fetching if I have run out", so a source
 * that yields in batches of 25 fetches twice per page of 50 and one that yields
 * 500 does not fetch for ten pages. The script never thinks about it.
 */
export const DEFAULT_PAGE_SIZE = 50;

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

export interface TableWindow {
  // The rows to draw, and where they sit in what the table has.
  rows: string[][];
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
}

/**
 * What to draw for a page. The page is clamped rather than corrected, so a
 * search that shrinks the set shows its last page instead of an empty one.
 */
export function tableWindow(block: TableBlock, view: TableView): TableWindow {
  const size = pageSizeOf(block);
  const filtered = searchesLocally(block) && view.search.trim() !== "";
  const rows = filtered ? block.rows.filter((row) => matchesSearch(row, view.search)) : block.rows;
  // The last page of what is loaded — plus one while the source is open, since
  // paging into rows that aren't here yet is exactly how they are asked for.
  const loadedPages = Math.max(0, Math.ceil(rows.length / size) - 1);
  const page = Math.max(0, Math.min(view.page, isOpen(block) && !filtered ? loadedPages + 1 : loadedPages));
  const start = page * size;
  const shown = rows.slice(start, start + size);

  return {
    rows: shown,
    page,
    from: shown.length === 0 ? 0 : start + 1,
    to: start + shown.length,
    total: rows.length,
    loaded: block.rows.length,
    filtered,
    hasPrevious: page > 0,
    // No lookahead: pulling one row past the page to light the button up would
    // fetch a whole page to answer a question nobody asked. A live source offers
    // Next until it runs out, and a click that yields nothing closes it out.
    hasNext: start + shown.length < rows.length || (isOpen(block) && !filtered),
    want: (page + 1) * size,
  };
}

// Whether more rows can still be had from the source.
export function isOpen(block: TableBlock): boolean {
  return block.live === true && block.exhausted !== true && block.expired !== true;
}

/**
 * Whether this page needs the source pulled, and for how many rows. Two things
 * ask for a pull: a page the loaded rows don't reach, and a search a source that
 * takes one hasn't answered yet. A local filter never does — it searches what is
 * loaded, which is what the footer says it is doing.
 */
export function pullNeeded(block: TableBlock, view: TableView): { needed: boolean; want: number } {
  const want = (Math.max(0, view.page) + 1) * pageSizeOf(block);
  if (!isOpen(block) || block.loading === true || block.error !== undefined) return { needed: false, want };
  if (!searchesLocally(block)) {
    if ((block.loadedSearch ?? "") !== view.search) return { needed: true, want };
  } else if (view.search.trim() !== "") {
    return { needed: false, want };
  }
  return { needed: block.rows.length < want, want };
}

/**
 * What the footer says about how much there is. A static table knows its total;
 * a live one only knows what it has, and says so rather than implying the count
 * is the answer.
 */
export function tableSummary(block: TableBlock, window: TableWindow): string {
  const range = window.total === 0 ? "No rows" : `${window.from}–${window.to} of ${window.total}`;
  if (window.filtered) return `${range} matching, of ${window.loaded} loaded`;
  if (block.expired === true) return `${range} loaded — run to load the rest`;
  if (isOpen(block)) return `${window.from}–${window.to} · ${window.loaded} loaded`;
  return range;
}

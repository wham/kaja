import { describe, expect, it } from "bun:test";
import { TableBlock } from "./blocks";
import { bodyMinHeight, cellsKey, hasControls, numericColumns, pendingCells, pullNeeded, tableSummary, tableWindow, totalOf } from "./tableView";

function table(rows: number, extra: Partial<TableBlock> = {}): TableBlock {
  return {
    kind: "table",
    columns: ["id", "title"],
    rows: Array.from({ length: rows }, (_, index) => [`${index}`, `show ${index}`]),
    pageSize: 10,
    ...extra,
  };
}

describe("tableWindow", () => {
  it("pages over the rows it has", () => {
    const shown = tableWindow(table(25), { page: 1, search: "" });

    expect(shown.rows).toHaveLength(10);
    expect(shown.rows[0][0]).toBe("10");
    expect([shown.from, shown.to, shown.total]).toEqual([11, 20, 25]);
    expect([shown.hasPrevious, shown.hasNext]).toEqual([true, true]);
  });

  // A cell is addressed by where its row sits in the table, which is arithmetic
  // until a local filter takes rows out of the middle.
  it("says where the drawn rows sit in the table", () => {
    expect(tableWindow(table(25), { page: 1, search: "" }).indices).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

    const filtered = tableWindow(table(25), { page: 0, search: "show 2" });
    expect(filtered.rows.map((row) => row[0])).toEqual(["2", "20", "21", "22", "23", "24"]);
    expect(filtered.indices).toEqual([2, 20, 21, 22, 23, 24]);
  });

  // The page held on screen while the next one is fetched is drawn from the same
  // cells as any other page, so it is addressed the same way.
  it("says where the page it is holding sits too", () => {
    const shown = tableWindow(table(10, { live: true }), { page: 1, search: "" });

    expect(shown.held).toHaveLength(10);
    expect(shown.heldIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tableWindow(table(25), { page: 1, search: "" }).heldIndices).toEqual([]);
  });

  it("has no next page on the last page of a static table", () => {
    expect(tableWindow(table(25), { page: 2, search: "" }).hasNext).toBe(false);
  });

  // A search that shrinks the set shows its last page rather than an empty one.
  it("clamps a page the rows no longer reach", () => {
    const shown = tableWindow(table(25), { page: 9, search: "" });

    expect(shown.page).toBe(2);
    expect(shown.rows).toHaveLength(5);
  });

  // Paging into rows that aren't here yet is how they are asked for, so the
  // clamp lets a page past the loaded end through — but only one, since that is
  // as far as a click can get.
  it("lets one page past the loaded rows through while the source is open", () => {
    const block = table(20, { live: true });

    expect(tableWindow(block, { page: 2, search: "" }).page).toBe(2);
    expect(tableWindow(block, { page: 5, search: "" }).page).toBe(2);
    expect(tableWindow({ ...block, exhausted: true }, { page: 2, search: "" }).page).toBe(1);
  });

  it("filters on any cell, for a source that doesn't take the search", () => {
    const shown = tableWindow(table(25), { page: 0, search: "SHOW 2" });

    // show 2, and show 20 through 24.
    expect(shown.total).toBe(6);
    expect(shown.filtered).toBe(true);
    expect(shown.loaded).toBe(25);
  });

  // A source that takes the search has already answered it; filtering its rows
  // again would hide what it sent back.
  it("does not filter the rows of a source that takes the search", () => {
    const shown = tableWindow(table(25, { live: true, serverSearch: true, loadedSearch: "vera" }), { page: 0, search: "vera" });

    expect(shown.filtered).toBe(false);
    expect(shown.total).toBe(25);
  });

  // No lookahead: a live source offers Next until it runs out, because pulling
  // one row past the page to light the button up is a fetch nobody asked for.
  it("offers a next page while a source is still open", () => {
    expect(tableWindow(table(10, { live: true }), { page: 0, search: "" }).hasNext).toBe(true);
    expect(tableWindow(table(10, { live: true, exhausted: true }), { page: 0, search: "" }).hasNext).toBe(false);
    expect(tableWindow(table(10, { live: true, expired: true }), { page: 0, search: "" }).hasNext).toBe(false);
  });

  // A local filter searches what is loaded and never fetches, so it pages only
  // what it matched.
  it("does not offer a next page past a local filter's matches", () => {
    expect(tableWindow(table(25, { live: true }), { page: 0, search: "show 2" }).hasNext).toBe(false);
  });

  // A source that reported a total has said where it ends, which is the one
  // thing that spares the click that comes back with nothing.
  it("stops at a total the source reported", () => {
    expect(tableWindow(table(20, { live: true, total: 20 }), { page: 1, search: "" }).hasNext).toBe(false);
    expect(tableWindow(table(20, { live: true, total: 200 }), { page: 1, search: "" }).hasNext).toBe(true);
    // …and the clamp stops letting a page past the loaded rows through with it.
    expect(tableWindow(table(20, { live: true, total: 20 }), { page: 5, search: "" }).page).toBe(1);
  });
});

describe("a page in flight", () => {
  // Nothing is destroyed and nothing resizes: the page that was on screen stays
  // there while the next one is fetched.
  it("holds the page that was on screen", () => {
    const shown = tableWindow(table(10, { live: true }), { page: 1, search: "" });

    expect(shown.pending).toBe(true);
    expect(shown.rows).toEqual([]);
    expect(shown.held.map((row) => row[0])).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  // The first draw of a table has nothing to hold, which is what the skeleton
  // rows are for — and how many of them there are is what the frame reserves.
  it("has nothing to hold on a first draw, and expects a full page", () => {
    const shown = tableWindow(table(0, { live: true }), { page: 0, search: "" });

    expect([shown.pending, shown.held.length, shown.expected]).toEqual([true, 0, 10]);
  });

  it("expects the short last page a reported total pins down", () => {
    expect(tableWindow(table(20, { live: true, total: 25 }), { page: 2, search: "" }).expected).toBe(5);
  });

  // A page that stopped is not a page on its way: Retry is what asks again.
  it("is not pending once the source ran out, was counted out, or failed", () => {
    expect(tableWindow(table(10, { live: true, exhausted: true }), { page: 1, search: "" }).pending).toBe(false);
    expect(tableWindow(table(20, { live: true, total: 20 }), { page: 1, search: "" }).pending).toBe(false);
    expect(tableWindow(table(10, { live: true, error: "unreachable" }), { page: 1, search: "" }).pending).toBe(false);
    expect(tableWindow(table(25, { live: true }), { page: 0, search: "show 2" }).pending).toBe(false);
  });
});

describe("holdsPage", () => {
  function hold(block: TableBlock, view = { page: 0, search: "" }) {
    return bodyMinHeight(block, tableWindow(block, view));
  }

  // A fetch is 200–800ms and a table sits in the middle of a document: a page
  // that collapsed and grew back would move everything below it twice a click.
  it("keeps a full page's height while the table can page", () => {
    // header 28 + 10 rows × 26.
    expect(hold(table(0, { live: true }))).toBe(288);
    expect(hold(table(10, { live: true }), { page: 1, search: "" })).toBe(288);
    expect(hold(table(25, { live: true, exhausted: true }))).toBe(288);
  });

  // …and only then. By the last page of a table that can no longer page nothing
  // is going to move again, and a local filter's result is the whole of it.
  it("lets the rows decide once there is nothing left to page to", () => {
    expect(hold(table(25, { live: true, exhausted: true }), { page: 2, search: "" })).toBeUndefined();
    expect(hold(table(25), { page: 2, search: "" })).toBeUndefined();
    expect(hold(table(25, { live: true }), { page: 0, search: "show 2" })).toBeUndefined();
    // A table that fits on a page was never a frame with a pager in it.
    expect(hold(table(10))).toBeUndefined();
  });

  // A short last page still reserves what it is about to take, not a page.
  it("reserves what a counted last page will fill", () => {
    expect(hold(table(20, { live: true, total: 25 }), { page: 2, search: "" })).toBe(158);
  });
});

describe("pullNeeded", () => {
  it("asks for rows a page doesn't reach, and only then", () => {
    expect(pullNeeded(table(10, { live: true }), { page: 0, search: "" })).toEqual({ needed: false, want: 10 });
    expect(pullNeeded(table(10, { live: true }), { page: 1, search: "" })).toEqual({ needed: true, want: 20 });
  });

  it("never asks on behalf of a static table", () => {
    expect(pullNeeded(table(10), { page: 4, search: "" }).needed).toBe(false);
  });

  it("never asks while one is already in flight, or after one failed", () => {
    expect(pullNeeded(table(10, { live: true, loading: true }), { page: 1, search: "" }).needed).toBe(false);
    expect(pullNeeded(table(10, { live: true, error: "unreachable" }), { page: 1, search: "" }).needed).toBe(false);
  });

  it("asks for a search the source hasn't answered yet", () => {
    const block = table(30, { live: true, serverSearch: true, loadedSearch: "" });

    expect(pullNeeded(block, { page: 0, search: "vera" }).needed).toBe(true);
    expect(pullNeeded({ ...block, loadedSearch: "vera" }, { page: 0, search: "vera" }).needed).toBe(false);
  });

  // A search restarts the source, so the state its last answer left behind is
  // not a reason to sit still: a narrow search that ran the source out used to
  // leave the box dead for every search after it.
  it("asks for a new search however the last one ended", () => {
    const answered = table(3, { live: true, serverSearch: true, loadedSearch: "vera" });

    expect(pullNeeded({ ...answered, exhausted: true }, { page: 0, search: "lune" }).needed).toBe(true);
    expect(pullNeeded({ ...answered, loading: true }, { page: 0, search: "lune" }).needed).toBe(true);
    expect(pullNeeded({ ...answered, error: "unreachable" }, { page: 0, search: "lune" }).needed).toBe(true);
    // Clearing the box is a new search like any other.
    expect(pullNeeded({ ...answered, exhausted: true }, { page: 0, search: "" }).needed).toBe(true);
  });

  it("stops asking once the source has answered a search and run out", () => {
    const block = table(3, { live: true, serverSearch: true, loadedSearch: "vera", exhausted: true });

    expect(pullNeeded(block, { page: 0, search: "vera" }).needed).toBe(false);
    expect(pullNeeded(block, { page: 1, search: "vera" }).needed).toBe(false);
  });

  // The pager is over rows, so a search the source answered still pages forward.
  it("still asks for a page past what a server search has loaded", () => {
    const block = table(10, { live: true, serverSearch: true, loadedSearch: "vera" });

    expect(pullNeeded(block, { page: 1, search: "vera" })).toEqual({ needed: true, want: 20 });
  });

  it("stops asking once it holds every row the source counted", () => {
    expect(pullNeeded(table(20, { live: true, total: 20 }), { page: 2, search: "" }).needed).toBe(false);
    expect(pullNeeded(table(20, { live: true, total: 200 }), { page: 2, search: "" }).needed).toBe(true);
  });

  it("never asks on behalf of a source that is gone", () => {
    const block = table(3, { live: true, expired: true, serverSearch: true, loadedSearch: "vera" });

    expect(pullNeeded(block, { page: 0, search: "lune" }).needed).toBe(false);
  });

  // Searching what is loaded must not pull an API dry to find three rows.
  it("never asks on behalf of a local filter", () => {
    expect(pullNeeded(table(10, { live: true }), { page: 1, search: "show" }).needed).toBe(false);
  });
});

describe("hasControls", () => {
  // Controls appear when there is something to control: a table that fits on a
  // page reads exactly as it did before any of this existed.
  it("is false for a static table that fits on one page", () => {
    expect(hasControls(table(10))).toBe(false);
    expect(hasControls(table(11))).toBe(true);
  });

  it("is true for a table that can still grow, or could have", () => {
    expect(hasControls(table(3, { live: true }))).toBe(true);
    expect(hasControls(table(3, { expired: true }))).toBe(true);
  });
});

describe("pendingCells", () => {
  const waiting = { 1: { 1: {} }, 12: { 0: {}, 1: { error: "429 Too Many Requests", retry: true } } };

  // A cell is asked for when it is drawn: the rows you never page to cost
  // nothing, which is the whole reason a cell can be a function.
  it("asks for the cells of the rows being drawn, and no others", () => {
    const block = table(25, { cells: waiting });

    expect(pendingCells(block, tableWindow(block, { page: 0, search: "" }).indices)).toEqual([{ row: 1, column: 1 }]);
    expect(pendingCells(block, tableWindow(block, { page: 1, search: "" }).indices)).toEqual([{ row: 12, column: 0 }]);
  });

  // The canvas draws a failed cell on every frame, so asking on sight would be a
  // loop rather than a retry. It is asked for when someone asks.
  it("never asks again for a cell that stopped", () => {
    expect(pendingCells(table(25, { cells: waiting }), [12]).map((cell) => cell.column)).toEqual([0]);
  });

  // A run read back has lost the closures, which is a state the table already
  // says rather than a row of bars that will never fill.
  it("asks nothing of a table whose source is gone", () => {
    expect(pendingCells(table(25, { cells: waiting, expired: true }), [1, 12])).toEqual([]);
    expect(pendingCells(table(25), [1, 12])).toEqual([]);
  });

  it("keys a set of cells by what is in it", () => {
    expect(cellsKey(pendingCells(table(25, { cells: waiting }), [1, 12]))).toBe("1:1,12:0");
    expect(cellsKey([])).toBe("");
  });
});

describe("totalOf", () => {
  it("is the rows, until a source says otherwise", () => {
    expect(totalOf(table(25))).toEqual({ count: 25, exact: true });
    // A source that is still open has only counted this far, and says so.
    expect(totalOf(table(25, { live: true }))).toEqual({ count: 25, exact: false });
    expect(totalOf(table(25, { live: true, total: 2431 }))).toEqual({ count: 2431, exact: true });
  });

  // A total is a claim and exhaustion is the truth.
  it("prefers what the source turned out to hold", () => {
    expect(totalOf(table(20, { live: true, exhausted: true, total: 2431 }))).toEqual({ count: 20, exact: true });
    expect(totalOf(table(25, { live: true, total: 10 }))).toEqual({ count: 25, exact: true });
  });
});

describe("tableSummary", () => {
  it("states a total the script reported, and marks one it inferred", () => {
    const block = table(25);
    expect(tableSummary(block, tableWindow(block, { page: 0, search: "" }))).toBe("1–10 of 25");

    const live = table(25, { live: true });
    expect(tableSummary(live, tableWindow(live, { page: 0, search: "" }))).toBe("1–10 of 25+");

    const counted = table(25, { live: true, total: 2431 });
    expect(tableSummary(counted, tableWindow(counted, { page: 0, search: "" }))).toBe("1–10 of 2,431");

    const expired = table(25, { expired: true, total: 2431 });
    expect(tableSummary(expired, tableWindow(expired, { page: 0, search: "" }))).toBe("1–10 of 2,431 loaded. Run to load the rest");
  });

  it("says a local filter is searching what is loaded", () => {
    const block = table(25, { live: true });
    expect(tableSummary(block, tableWindow(block, { page: 0, search: "show 2" }))).toBe("1–6 of 6 matching · 25 loaded");
    expect(tableSummary(block, tableWindow(block, { page: 0, search: "vera" }))).toBe("No rows matching · 25 loaded");
  });

  it("says so when there is nothing", () => {
    const block = table(0, { live: true, exhausted: true });
    expect(tableSummary(block, tableWindow(block, { page: 0, search: "" }))).toBe("No rows");
  });

  // The count used to drop to zero and back on every click, because the range
  // was read off rows that hadn't arrived. A page in flight states the page that
  // was clicked, and the count once the source has reported one.
  it("states the page being fetched rather than the rows in hand", () => {
    const first = table(0, { live: true });
    expect(tableSummary(first, tableWindow(first, { page: 0, search: "" }))).toBe("Loading 1–10…");

    const counted = table(0, { live: true, total: 2431 });
    expect(tableSummary(counted, tableWindow(counted, { page: 0, search: "" }))).toBe("1–10 of 2,431");

    const paging = table(10, { live: true, total: 2431 });
    expect(tableSummary(paging, tableWindow(paging, { page: 1, search: "" }))).toBe("11–20 of 2,431");

    // A source that reported a count knows where its last page ends, so the
    // range it states is the short one it is about to draw.
    const last = table(20, { live: true, total: 25 });
    expect(tableSummary(last, tableWindow(last, { page: 2, search: "" }))).toBe("21–25 of 25");
  });
});

describe("numericColumns", () => {
  // A script hands the table text, so a column of numbers is one that looks like
  // it — decided per column, and never by one cell that happens to be a digit.
  it("reads a column of numbers off the page", () => {
    const rows = [
      ["ten_zvm78", "17mar2022", "4", "1,204"],
      ["ent_YEQwo", "adam-user", "", "-12.5"],
    ];

    expect(numericColumns(rows, 4)).toEqual([false, false, true, true]);
  });

  it("calls an empty column nothing", () => {
    expect(numericColumns([["", ""]], 2)).toEqual([false, false]);
    expect(numericColumns([], 2)).toEqual([false, false]);
  });
});

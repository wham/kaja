import { describe, expect, it } from "bun:test";
import { TableBlock } from "./blocks";
import { hasControls, pullNeeded, tableSummary, tableWindow } from "./tableView";

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

describe("tableSummary", () => {
  it("states a total it knows, and a count it doesn't", () => {
    const block = table(25);
    expect(tableSummary(block, tableWindow(block, { page: 0, search: "" }))).toBe("1–10 of 25");

    const live = table(25, { live: true });
    expect(tableSummary(live, tableWindow(live, { page: 0, search: "" }))).toBe("1–10 · 25 loaded");

    const expired = table(25, { expired: true });
    expect(tableSummary(expired, tableWindow(expired, { page: 0, search: "" }))).toBe("1–10 of 25 loaded — run to load the rest");
  });

  it("says a local filter is searching what is loaded", () => {
    const block = table(25, { live: true });
    expect(tableSummary(block, tableWindow(block, { page: 0, search: "show 2" }))).toBe("1–6 of 6 matching, of 25 loaded");
  });
});

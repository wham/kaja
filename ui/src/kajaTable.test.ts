import { describe, expect, it } from "bun:test";
import { Block, TableBlock } from "./blocks";
import { Kaja, LiveTables } from "./kaja";
import { bodyMinHeight, tableSummary, tableWindow } from "./tableView";

// A Kaja with nowhere to draw but a map of what it drew, which is what a table
// is: a block that keeps being handed back with more in it.
function draw() {
  const blocks = new Map<string, Block>();
  const kaja = new Kaja({
    onMethodCallUpdate: () => {},
    onAsk: () => Promise.reject(new Error("not asked")),
    onApprove: () => Promise.reject(new Error("not approved")),
    onBlockUpdate: (blockId, block) => void blocks.set(blockId, block),
    onLog: () => {},
  });
  const only = (): TableBlock => {
    const block = [...blocks.values()].find((block) => block.kind === "table");
    if (block?.kind !== "table") throw new Error("no table was drawn");
    return block;
  };
  const id = () => [...blocks.entries()].find(([, block]) => block.kind === "table")![0];
  return { kaja, only, id };
}

describe("kaja.table", () => {
  it("draws an array as it is, and stays static", () => {
    const { kaja, only } = draw();
    kaja.table([{ id: 1, title: "Vera" }]);

    expect(only().columns).toEqual(["id", "title"]);
    expect(only().rows).toEqual([["1", "Vera"]]);
    expect(only().live).toBeUndefined();
  });

  it("turns each item into a row with the columns function", () => {
    const { kaja, only } = draw();
    kaja.table([{ id: 1, name: { first: "Vera" } }], (show: { id: number; name: { first: string } }) => ({
      first: show.name.first,
      id: show.id,
    }));

    expect(only().columns).toEqual(["first", "id"]);
    expect(only().rows).toEqual([["Vera", "1"]]);
  });

  // Picked keys are the header before there is a row to read one off.
  it("picks the named keys off each item", () => {
    const { kaja, only } = draw();
    kaja.table([], ["id", "title"]);
    expect(only().columns).toEqual(["id", "title"]);

    const other = draw();
    other.kaja.table([{ id: 1, title: "Vera", secret: "x" }], ["title", "id"]);
    expect(other.only().columns).toEqual(["title", "id"]);
    expect(other.only().rows).toEqual([["Vera", "1"]]);
  });

  it("takes a title and a page size", () => {
    const { kaja, only } = draw();
    kaja.table([{ id: 1 }], { title: "Users", pageSize: 25 });
    expect(only().title).toBe("Users");
    expect(only().pageSize).toBe(25);

    const empty = draw();
    empty.kaja.table({ title: "Users" });
    expect(empty.only().title).toBe("Users");
    expect(empty.only().columns).toEqual([]);
  });

  // An array is what a row used to be, and its indices would be a header nobody can read.
  it("refuses a row that isn't an object", () => {
    const { kaja } = draw();
    expect(() => kaja.table([[1, "Vera"]])).toThrow(/a row is an object whose keys are its columns/);
    expect(() => kaja.table().row(1 as never)).toThrow(/a row is an object/);
  });

  it("keeps taking rows from the handle", () => {
    const { kaja, only } = draw();
    const table = kaja.table();
    table.row({ id: 1 });
    table.row({ id: 2 });

    expect(only().rows).toEqual([["1"], ["2"]]);
  });

  // A row is written when the work starts and rewritten when it finishes, which
  // is what makes a summary table paint rather than report at the end.
  it("rewrites the columns an update names, and leaves the rest", () => {
    const { kaja, only } = draw();
    const table = kaja.table();
    const first = table.row({ id: 1, status: "checking…" });
    const second = table.row({ id: 2, status: "checking…" });

    second.update({ status: "matched" });
    expect(only().rows).toEqual([
      ["1", "checking…"],
      ["2", "matched"],
    ]);

    first.update({ status: "failed" });
    expect(only().rows).toEqual([
      ["1", "failed"],
      ["2", "matched"],
    ]);
  });

  // The canvas compares what it was handed against what it holds, so a row
  // rewritten in place would repaint nothing.
  it("hands the canvas a new array for every update", () => {
    const { kaja, only } = draw();
    const table = kaja.table();
    const row = table.row({ id: 1 });
    const before = only().rows;

    row.update({ id: 2 });
    expect(only().rows).not.toBe(before);
    expect(before).toEqual([["1"]]);
  });

  // A column is added the first time a row names it, so the rows already drawn
  // grow a blank for it rather than a ragged edge.
  it("grows every row when a row names a new column", () => {
    const { kaja, only } = draw();
    const table = kaja.table();
    const row = table.row({ id: 1 });
    table.row({ id: 2, status: "matched" });

    expect(only().columns).toEqual(["id", "status"]);
    expect(only().rows).toEqual([
      ["1", ""],
      ["2", "matched"],
    ]);

    row.update({ status: "failed" });
    expect(only().rows[0]).toEqual(["1", "failed"]);
  });

  // An object puts keys that look like whole numbers first, which a Map doesn't.
  it("keeps the order a Map row was written in", () => {
    const { kaja, only } = draw();
    kaja.table(
      ["A"],
      (letter: string) =>
        new Map([
          ["row", letter],
          ["1", `${letter}1`],
          ["2", `${letter}2`],
        ]),
    );
    expect(only().columns).toEqual(["row", "1", "2"]);
    expect(only().rows).toEqual([["A", "A1", "A2"]]);
  });

  // Keys are matched by name, so a row naming them in another order lands in
  // the same columns.
  it("places a cell by its column, not its position", () => {
    const { kaja, only } = draw();
    kaja.table([
      { id: 1, name: "Vera" },
      { name: "Lune", id: 2 },
    ]);
    expect(only().rows).toEqual([
      ["1", "Vera"],
      ["2", "Lune"],
    ]);
  });

  // A source that takes the search is restarted from the top, so the rows a
  // handle pointed into answer a question nobody is asking. Nothing to rewrite,
  // so nothing happens — better than a script ending on someone else's search.
  it("goes quiet when the row it points at is gone", async () => {
    const { kaja, only, id } = draw();
    const table = kaja.table(async function* (search: string) {
      yield { n: `${search || "all"}-1` };
    });
    await kaja.settleTables();

    const row = table.row({ n: "written" });
    expect(only().rows).toHaveLength(2);

    await kaja.pullTable(id(), "vera", 50);
    expect(only().rows).toEqual([["vera-1"]]);

    row.update({ n: "rewritten" });
    expect(only().rows).toEqual([["vera-1"]]);
  });

  /**
   * The whole claim: a source is pulled for the page that is being looked at and
   * not one row further. A generator makes that structural — the loop simply
   * hasn't reached its next fetch.
   */
  it("pulls a source only as far as the page being drawn", async () => {
    const { kaja, only, id } = draw();
    const fetched: number[] = [];
    kaja.table(async function* () {
      for (let page = 0; page < 100; page++) {
        fetched.push(page);
        yield* [0, 1, 2, 3, 4].map((row) => ({ n: page * 5 + row }));
      }
    });
    await kaja.settleTables();

    // The first page is drawn by the run itself, so a canvas nobody is watching
    // still has rows on it.
    expect(only().rows).toHaveLength(50);
    expect(fetched).toHaveLength(10);

    await kaja.pullTable(id(), "", 100);
    expect(only().rows).toHaveLength(100);
    expect(fetched).toHaveLength(20);
  });

  it("marks a source that runs out, so the count becomes the total", async () => {
    const { kaja, only, id } = draw();
    kaja.table(async function* () {
      yield { n: "one" };
      yield { n: "two" };
    });
    await kaja.settleTables();

    expect(only().rows).toHaveLength(2);
    expect(only().exhausted).toBe(true);
    expect(await kaja.pullTable(id(), "", 100)).toBe(true);
  });

  // Declaring the parameter is what asks for the search text; the source is
  // started again with it, because a new search is a new result set.
  it("restarts a source that takes the search", async () => {
    const { kaja, only, id } = draw();
    const searches: string[] = [];
    kaja.table(async function* (search: string) {
      searches.push(search);
      yield { n: `${search || "all"}-1` };
      yield { n: `${search || "all"}-2` };
    });
    await kaja.settleTables();

    expect(only().serverSearch).toBe(true);
    expect(searches).toEqual([""]);

    await kaja.pullTable(id(), "vera", 50);
    expect(searches).toEqual(["", "vera"]);
    expect(only().rows).toEqual([["vera-1"], ["vera-2"]]);
    expect(only().loadedSearch).toBe("vera");

    // A search that runs the source out is still only one search: the next one
    // opens it again rather than reading the last answer as the end of it.
    expect(only().exhausted).toBe(true);
    await kaja.pullTable(id(), "lune", 50);
    expect(searches).toEqual(["", "vera", "lune"]);
    expect(only().rows).toEqual([["lune-1"], ["lune-2"]]);
  });

  // A source that ignores the text is never restarted for it: it would fetch the
  // same first page back on every keystroke. The box filters what is loaded.
  it("leaves a source that doesn't take the search alone", async () => {
    const { kaja, only, id } = draw();
    let started = 0;
    kaja.table(async function* () {
      started++;
      yield { n: "one" };
    });
    await kaja.settleTables();
    await kaja.pullTable(id(), "vera", 50);

    expect(started).toBe(1);
    expect(only().serverSearch).toBe(false);
  });

  it("reports a source that failed, and fills again when it is retried", async () => {
    const { kaja, only, id } = draw();
    let attempt = 0;
    kaja.table(async function* () {
      if (attempt++ === 0) throw new Error("upstream is down");
      yield { n: "one" };
    });
    await kaja.settleTables();

    expect(only().error).toBe("upstream is down");
    expect(only().loading).toBe(false);

    // A generator that threw is finished, so a retry is the source opened again
    // from the top rather than the dead one resumed.
    await kaja.pullTable(id(), "", 50);
    expect(only().error).toBeUndefined();
    expect(only().rows).toEqual([["one"]]);
  });

  // The count an API reports beside a page is the one thing the table cannot
  // work out for itself, so the script hands it on.
  it("takes a total from the script", () => {
    const { kaja, only } = draw();
    const table = kaja.table();

    table.total(2431);
    expect(only().total).toBe(2431);

    // A source that stops reporting one leaves the table where a cursor-based
    // source always is, and anything that isn't a count says nothing at all.
    table.total(undefined);
    expect(only().total).toBeUndefined();
    table.total(Number.NaN);
    expect(only().total).toBeUndefined();
  });

  // A source reports its total from inside its own loop, through the handle the
  // script is still assigning — so nothing it yields may run before it is.
  it("takes a total from a source, through the handle", async () => {
    const { kaja, only, id } = draw();
    const shows: { total(count: number): void } = kaja.table(async function* (search: string) {
      shows.total(search === "" ? 2431 : 12);
      yield { n: "one" };
      yield { n: "two" };
    });
    await kaja.settleTables();

    expect(only().rows).toHaveLength(2);
    expect(only().total).toBe(2431);

    // A new search is a new result set, so the count it had answers a question
    // nobody is asking any more.
    await kaja.pullTable(id(), "vera", 50);
    expect(only().total).toBe(12);
  });

  // A block read back from the store has no source; Next has to say so rather
  // than lead nowhere.
  it("reports a table whose source it no longer holds", async () => {
    const { kaja } = draw();
    expect(await kaja.pullTable("block-gone", "", 50)).toBe(false);
  });

  /**
   * The whole of what paging looks like, against the shape a real script has: a
   * source that fetches a page at a time and reports the count it was sent
   * beside it. Nothing about the frame may move between these states — the range
   * never drops to zero, and the height is a full page throughout.
   */
  it("never drops to nothing between one page and the next", async () => {
    const { kaja, only, id } = draw();
    const shows = kaja.table(async function* () {
      for (let page = 1; ; page++) {
        shows.total(2431);
        yield* Array.from({ length: 50 }, (_, row) => ({ id: `show-${(page - 1) * 50 + row}` }));
      }
    });

    const height = 28 + 50 * 26;
    const at = (page: number) => {
      const window = tableWindow(only(), { page, search: "" });
      return { summary: tableSummary(only(), window), height: bodyMinHeight(only(), window), rows: window.rows.length, held: window.held.length };
    };

    // Drawn, and its first page not yet asked for: the count is the one thing
    // nothing knows yet, so the table says which rows are on their way.
    expect(at(0)).toEqual({ summary: "Loading 1–50…", height, rows: 0, held: 0 });

    await kaja.settleTables();
    expect(at(0)).toEqual({ summary: "1–50 of 2,431", height, rows: 50, held: 0 });

    // Next, before the pull it asks for has landed: the page that was on screen
    // is what stays there, and the toolbar already states the page being read.
    expect(at(1)).toEqual({ summary: "51–100 of 2,431", height, rows: 0, held: 50 });

    await kaja.pullTable(id(), "", 100);
    expect(at(1)).toEqual({ summary: "51–100 of 2,431", height, rows: 50, held: 0 });
  });

  it("takes rows from an iterable source", async () => {
    const { kaja, only } = draw();
    kaja.table([{ n: "a" }, { n: "b" }].values());
    await kaja.settleTables();

    expect(only().rows).toEqual([["a"], ["b"]]);
    expect(only().live).toBe(true);
  });
});

// A value the script has and one it is getting are the same cell to everything
// downstream: the row is drawn with what it already has, and the rest lands in
// place. Which of the two it is decided by what the cell is — a promise is work
// already started, a function is work nobody has asked for yet.
describe("kaja.table cells", () => {
  it("draws the row at once and fills a promise in when it lands", async () => {
    const { kaja, only } = draw();
    const table = kaja.table();
    table.row({ id: 1, rating: Promise.resolve(4.6) });

    expect(only().rows).toEqual([["1", ""]]);
    expect(only().cells).toEqual({ 0: { 1: {} } });

    await kaja.settleTables();
    expect(only().rows).toEqual([["1", "4.6"]]);
    // A table whose cells have all landed is the plain table it has become.
    expect(only().cells).toBeUndefined();
  });

  // The run is not over until the cells it handed over are here: they are work
  // the script started, on the same rule a live table's first page is.
  it("waits for the cells the script handed over", async () => {
    const { kaja, only } = draw();
    const table = kaja.table();
    table.row({ id: new Promise((resolve) => setTimeout(() => resolve("late"), 5)) });

    await kaja.settleTables();
    expect(only().rows).toEqual([["late"]]);
  });

  /**
   * The whole reason a function is worth having beside a promise: it is work
   * nobody has asked for. The first page is asked for with the table, so a run
   * nobody is watching still fills one; everything past it costs a call only if
   * you page to it.
   */
  it("calls a function when its row is drawn, and not before", async () => {
    const { kaja, only, id } = draw();
    const called: number[] = [];
    const table = kaja.table({ pageSize: 2 });
    for (const row of [0, 1, 2, 3]) {
      table.row({
        n: () => {
          called.push(row);
          return `row-${row}`;
        },
      });
    }

    await kaja.settleTables();
    expect(called).toEqual([0, 1]);
    expect(only().rows).toEqual([["row-0"], ["row-1"], [""], [""]]);

    // The second page is drawn: its cells ask for themselves.
    expect(
      await kaja.pullCells(id(), [
        { row: 2, column: 0 },
        { row: 3, column: 0 },
      ]),
    ).toBe(true);
    expect(called).toEqual([0, 1, 2, 3]);
    expect(only().rows).toEqual([["row-0"], ["row-1"], ["row-2"], ["row-3"]]);
  });

  // The canvas asks for every cell it can see on every frame it draws, so asking
  // is what has to be idempotent — not the work.
  it("starts a cell once, however often it is asked for", async () => {
    const { kaja, id } = draw();
    let called = 0;
    const table = kaja.table();
    table.row({ n: () => ++called });

    await kaja.pullCells(id(), [{ row: 0, column: 0 }]);
    await kaja.pullCells(id(), [{ row: 0, column: 0 }]);
    await kaja.settleTables();
    expect(called).toBe(1);
  });

  it("keeps a cell that stopped, and fills it when it is retried", async () => {
    const { kaja, only, id } = draw();
    let attempt = 0;
    const table = kaja.table();
    table.row({
      id: 1,
      rating: () => {
        if (attempt++ === 0) throw new Error("429 Too Many Requests");
        return 4.1;
      },
    });
    await kaja.settleTables();

    expect(only().rows).toEqual([["1", ""]]);
    expect(only().cells).toEqual({ 0: { 1: { error: "429 Too Many Requests", retry: true } } });

    // Drawing it again must not retry it: that is a loop, not a retry.
    await kaja.pullCells(id(), [{ row: 0, column: 1 }]);
    expect(attempt).toBe(1);

    await kaja.pullCells(id(), [{ row: 0, column: 1, retry: true }]);
    await kaja.settleTables();
    expect(only().rows).toEqual([["1", "4.1"]]);
    expect(only().cells).toBeUndefined();
  });

  // A promise is finished, whatever it settled as. Retry is offered only where
  // it could work.
  it("has nothing to call again when a promise rejects", async () => {
    const { kaja, only } = draw();
    const table = kaja.table();
    table.row({ id: 1, rating: Promise.reject(new Error("upstream is down")) });
    await kaja.settleTables();

    expect(only().cells).toEqual({ 0: { 1: { error: "upstream is down" } } });
  });

  // Thrown or returned, an Error is a cell that stopped — a script that hands
  // its failures back rather than throwing them says the same thing.
  it("reads a returned Error as a failure", async () => {
    const { kaja, only } = draw();
    const table = kaja.table();
    table.row({ a: new Error("as a value"), b: () => new Error("from a function"), c: Promise.resolve(new Error("from a promise")) });
    await kaja.settleTables();

    expect(only().rows).toEqual([["", "", ""]]);
    expect(only().cells).toEqual({
      0: { 0: { error: "as a value" }, 1: { error: "from a function", retry: true }, 2: { error: "from a promise" } },
    });
  });

  // A cell rewritten is a different cell: what was on its way answered the one
  // that was there.
  it("drops a cell that has been rewritten", async () => {
    const { kaja, only } = draw();
    let land: (value: string) => void = () => {};
    const table = kaja.table();
    const row = table.row({ id: 1, status: new Promise<string>((resolve) => (land = resolve)) });

    row.update({ status: "settled" });
    expect(only().cells).toBeUndefined();

    land("late");
    await kaja.settleTables();
    expect(only().rows).toEqual([["1", "settled"]]);
    expect(only().cells).toBeUndefined();
  });

  // An update rewrites the columns it names, so a cell in another column is
  // still the cell it was.
  it("leaves a cell on its way when another column is updated", async () => {
    const { kaja, only } = draw();
    const table = kaja.table();
    const row = table.row({ id: 1, rating: Promise.resolve(4.6), status: "checking…" });

    row.update({ status: "done" });
    await kaja.settleTables();
    expect(only().rows).toEqual([["1", "4.6", "done"]]);
  });

  // A source that takes the search is restarted from the top, and the cells of
  // the rows it had belong to a question nobody is asking any more.
  it("drops the cells of a source that is restarted", async () => {
    const { kaja, only, id } = draw();
    let land = () => {};
    kaja.table(async function* (search: string) {
      yield { n: search === "" ? new Promise<string>((resolve) => (land = () => resolve("late"))) : `${search}-1` };
    });
    // The rows, without waiting for the cell: settling waits for a cell the
    // script handed over, and this one is deliberately still out there.
    await kaja.pullTable(id(), "", 50);
    expect(only().cells).toEqual({ 0: { 0: {} } });

    await kaja.pullTable(id(), "vera", 50);
    land();
    await kaja.settleTables();

    expect(only().rows).toEqual([["vera-1"]]);
    expect(only().cells).toBeUndefined();
  });

  // A page draw asks for every cell it can see at once, and fifty rows must not
  // put fifty requests on the wire in one frame.
  it("fetches a handful of cells at a time", async () => {
    const { kaja } = draw();
    let running = 0;
    let most = 0;
    const table = kaja.table({ pageSize: 30 });
    for (let row = 0; row < 20; row++) {
      table.row({
        n: async () => {
          running++;
          most = Math.max(most, running);
          await new Promise((resolve) => setTimeout(resolve, 1));
          running--;
          return row;
        },
      });
    }
    await kaja.settleTables();

    expect(most).toBe(6);
  });

  it("reports a table whose cells it no longer holds", async () => {
    const { kaja } = draw();
    expect(await kaja.pullCells("block-gone", [{ row: 0, column: 0 }])).toBe(false);
  });
});

// The one cell that is a destination rather than a value, and the one that survives
// being stored: it is a script's name and a map of text, so nothing about it is held
// on the Kaja instance and nothing about it can expire.
describe("kaja.run", () => {
  // A link in a column is labelled by the column, which is what the header
  // above it already says.
  it("draws its column's name and carries where it goes", () => {
    const { kaja, only } = draw();
    kaja.table([{ id: 1, churn: kaja.run("reports/churn", { id: 7 }) }]);

    expect(only().rows).toEqual([["1", "churn"]]);
    expect(only().runs).toEqual({ 0: { 1: { script: "reports/churn", input: { id: "7" } } } });

    const other = draw();
    other.kaja.table([{ history: other.kaja.run("admin/audit-log") }]);
    expect(other.only().rows).toEqual([["history"]]);
  });

  it("takes a label, and an extension off the name", () => {
    const { kaja, only } = draw();
    kaja.table([{ refund: kaja.run("refund.ts", { order: "a-1" }, { label: "Refund" }) }]);

    expect(only().rows).toEqual([["Refund"]]);
    expect(only().runs).toEqual({ 0: { 0: { script: "refund", input: { order: "a-1" } } } });
  });

  // Outside a cell there is no column to be named by.
  it("is the script's own name anywhere but a cell", () => {
    const { kaja } = draw();
    expect(String(kaja.run("reports/churn"))).toBe("churn");
  });

  // Every value is text, as a link's values are, so a script reads kaja.input.id
  // without the caller spelling the conversion out.
  it("says every value as text, and says nothing where there is none", () => {
    const { kaja, only } = draw();
    kaja.table([{ audit: kaja.run("audit", { at: new Date("2024-03-01T00:00:00Z"), open: true }) }]);
    expect(only().runs?.[0]?.[0]).toEqual({ script: "audit", input: { at: "2024-03-01T00:00:00.000Z", open: "true" } });

    const other = draw();
    other.kaja.table([{ audit: other.kaja.run("audit") }]);
    expect(other.only().runs?.[0]?.[0]).toEqual({ script: "audit", input: undefined });
  });

  it("is one cell among the others, and rewriting it lets it go", () => {
    const { kaja, only } = draw();
    const table = kaja.table();
    const row = table.row({ id: 1, detail: kaja.run("detail", { id: 1 }), rating: Promise.resolve("4.6") });

    expect(only().rows).toEqual([["1", "detail", ""]]);
    expect(only().runs).toEqual({ 0: { 1: { script: "detail", input: { id: "1" } } } });

    row.update({ detail: "gone", rating: "4.6" });
    expect(only().rows).toEqual([["1", "gone", "4.6"]]);
    expect(only().runs).toBeUndefined();
    expect(only().cells).toBeUndefined();
  });

  // A table of plain cells is stored exactly as it was before any of this existed.
  it("leaves a table that has none untouched", () => {
    const { kaja, only } = draw();
    kaja.table([{ id: 1 }]);
    expect(only().runs).toBeUndefined();
  });

  it("refuses a destination that names nothing", () => {
    const { kaja } = draw();
    expect(() => kaja.run("  ")).toThrow(/name the script to run/);
  });
});

// A list method paged by cursor, read as the items it lists.
describe("kaja.table over kaja.pages", () => {
  function users(count: number, failOn?: string) {
    const asked: string[] = [];
    let failed = false;
    const list = (cursor: string) => {
      asked.push(cursor);
      if (cursor === failOn && !failed) {
        failed = true;
        return Promise.resolve(undefined);
      }
      const start = cursor === "" ? 0 : Number(cursor);
      const items = Array.from({ length: Math.min(10, count - start) }, (_, at) => ({ id: start + at }));
      const next = start + 10 < count ? String(start + 10) : "";
      return Promise.resolve({ items, nextToken: next, totalSize: count });
    };
    return { asked, list };
  }

  it("pulls the pages a table draws and takes their total", async () => {
    const { kaja, only, id } = draw();
    const { asked, list } = users(100);
    kaja.table(kaja.pages(list), (user: { id: number }) => ({ id: user.id }), { pageSize: 20 });
    await kaja.settleTables();

    expect(asked).toEqual(["", "10"]);
    expect(only().rows).toHaveLength(20);
    expect(only().total).toBe(100);

    await kaja.pullTable(id(), "", 40);
    expect(asked).toEqual(["", "10", "20", "30"]);
  });

  // The failed call is in the log; the table says the list stopped there, and
  // Retry asks for that page again rather than starting over.
  it("stops at a page that failed, and Retry asks for that page again", async () => {
    const { kaja, only, id } = draw();
    const { asked, list } = users(30, "10");
    kaja.table(kaja.pages(list), ["id"]);
    await kaja.settleTables();

    expect(only().rows).toHaveLength(10);
    expect(only().error).toMatch(/A page failed to load/);

    await kaja.pullTable(id(), "", 50);
    expect(asked).toEqual(["", "10", "10", "20"]);
    expect(only().rows).toHaveLength(30);
    expect(only().exhausted).toBe(true);
  });
});

describe("LiveTables", () => {
  it("lets go of the tables whose rows are gone, and the owner with them", () => {
    const tables = new LiveTables();
    const owner = {} as Kaja;
    tables.open("table-1", {} as never, owner);
    tables.open("table-2", {} as never, owner);

    tables.drop(["table-1", "never-opened"]);

    expect(tables.size).toBe(1);
    expect(tables.has("table-1")).toBe(false);
    expect(tables.owner("table-2")).toBe(owner);
    expect(tables.ownedBy(owner)).toHaveLength(1);

    tables.drop(["table-2"]);
    expect(tables.ownedBy(owner)).toHaveLength(0);
  });
});

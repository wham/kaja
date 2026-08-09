import { describe, expect, it } from "bun:test";
import { Block, TableBlock } from "./blocks";
import { Kaja } from "./kaja";

// A Kaja with nowhere to draw but a map of what it drew, which is what a table
// is: a block that keeps being handed back with more in it.
function draw() {
  const blocks = new Map<string, Block>();
  const kaja = new Kaja(
    () => {},
    () => Promise.reject(new Error("not asked")),
    (blockId, block) => void blocks.set(blockId, block),
  );
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
    kaja.table(["id", "title"], [[1, "Vera"]]);

    expect(only().rows).toEqual([["1", "Vera"]]);
    expect(only().live).toBeUndefined();
  });

  it("keeps taking rows from the handle", () => {
    const { kaja, only } = draw();
    const table = kaja.table(["id"]);
    table.row(1);
    table.row(2);

    expect(only().rows).toEqual([["1"], ["2"]]);
  });

  /**
   * The whole claim: a source is pulled for the page that is being looked at and
   * not one row further. A generator makes that structural — the loop simply
   * hasn't reached its next fetch.
   */
  it("pulls a source only as far as the page being drawn", async () => {
    const { kaja, only, id } = draw();
    const fetched: number[] = [];
    kaja.table(["n"], async function* () {
      for (let page = 0; page < 100; page++) {
        fetched.push(page);
        yield* [0, 1, 2, 3, 4].map((row) => [page * 5 + row]);
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
    kaja.table(["n"], async function* () {
      yield ["one"];
      yield ["two"];
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
    kaja.table(["n"], async function* (search: string) {
      searches.push(search);
      yield [`${search || "all"}-1`];
      yield [`${search || "all"}-2`];
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
    kaja.table(["n"], async function* () {
      started++;
      yield ["one"];
    });
    await kaja.settleTables();
    await kaja.pullTable(id(), "vera", 50);

    expect(started).toBe(1);
    expect(only().serverSearch).toBe(false);
  });

  it("reports a source that failed, and fills again when it is retried", async () => {
    const { kaja, only, id } = draw();
    let attempt = 0;
    kaja.table(["n"], async function* () {
      if (attempt++ === 0) throw new Error("upstream is down");
      yield ["one"];
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

  // A block read back from the store has no source; Next has to say so rather
  // than lead nowhere.
  it("reports a table whose source it no longer holds", async () => {
    const { kaja } = draw();
    expect(await kaja.pullTable("block-gone", "", 50)).toBe(false);
  });

  it("takes a plain array of rows from an iterable source", async () => {
    const { kaja, only } = draw();
    kaja.table(["n"], [["a"], ["b"]].values());
    await kaja.settleTables();

    expect(only().rows).toEqual([["a"], ["b"]]);
    expect(only().live).toBe(true);
  });
});

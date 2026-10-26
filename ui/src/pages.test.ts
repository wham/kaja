import { describe, expect, it } from "bun:test";
import { Pages } from "./pages";

async function all<T>(pages: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of pages) items.push(item);
  return items;
}

describe("Pages", () => {
  it("reads the one list and the cursor off each page", async () => {
    const asked: string[] = [];
    const pages = new Pages<number>((cursor) => {
      asked.push(cursor);
      return Promise.resolve(cursor === "" ? { users: [1, 2], nextPageToken: "b" } : { users: [3], nextPageToken: "" });
    });

    expect(await all(pages)).toEqual([1, 2, 3]);
    expect(asked).toEqual(["", "b"]);
  });

  it("starts from the first page on every pass", async () => {
    const pages = new Pages<number>(() => Promise.resolve({ items: [1], nextToken: "" }));
    expect(await all(pages)).toEqual([1]);
    expect(await all(pages)).toEqual([1]);
  });

  it("takes items and next from the script where the page can't say", async () => {
    const pages = new Pages<string>(
      (cursor) => Promise.resolve(cursor === "" ? { open: ["a"], closed: ["x"], after: "2" } : { open: ["b"], closed: [], after: "" }),
      { items: (page) => page.open, next: (page) => page.after },
    );
    expect(await all(pages)).toEqual(["a", "b"]);
  });

  it("names the lists when there is more than one", async () => {
    const pages = new Pages(() => Promise.resolve({ open: [], closed: [], nextToken: "" }));
    await expect(all(pages)).rejects.toThrow(/2 lists \(open, closed\)/);
  });

  it("asks for the cursor when the page has none it knows", async () => {
    const pages = new Pages(() => Promise.resolve({ items: [1], after: "2" }));
    await expect(all(pages)).rejects.toThrow(/no cursor named nextPageToken/);
  });

  // An API that hands the same cursor back would be paged forever.
  it("stops on a cursor it was just given", async () => {
    let calls = 0;
    const pages = new Pages<number>(() => {
      calls++;
      return Promise.resolve({ items: [calls], nextToken: "same" });
    });
    expect(await all(pages)).toEqual([1, 2]);
  });

  it("refuses a call that isn't a function of the cursor", () => {
    expect(() => new Pages(Promise.resolve({}) as never)).toThrow(/a function of the cursor/);
  });
});

// GitHub's shape: page 1, 2, 3 … of perPage items, the last one short.
function numbered(count: number, perPage: number) {
  const asked: number[] = [];
  const list = (page: number) => {
    asked.push(page);
    const start = (page - 1) * perPage;
    return Promise.resolve({ items: Array.from({ length: Math.max(0, Math.min(perPage, count - start)) }, (_, at) => start + at) });
  };
  return { asked, list };
}

describe("Pages by number", () => {
  it("counts up from the first page and stops at a short one", async () => {
    const { asked, list } = numbered(23, 10);
    const items = await all(new Pages<number>(list, { page: 1 }));

    expect(items).toHaveLength(23);
    expect(asked).toEqual([1, 2, 3]);
  });

  it("asks once more where the last page is full, and stops at the empty one", async () => {
    const { asked, list } = numbered(20, 10);
    expect(await all(new Pages<number>(list, { page: 1 }))).toHaveLength(20);
    expect(asked).toEqual([1, 2, 3]);
  });

  it("starts where it is told", async () => {
    const asked: number[] = [];
    await all(
      new Pages<number>(
        (page: number) => {
          asked.push(page);
          return Promise.resolve({ items: page < 2 ? [page] : [] });
        },
        { page: 0 },
      ),
    );
    expect(asked).toEqual([0, 1, 2]);
  });

  // An API that drops items it pages past, so a short page isn't the last.
  it("goes on to an empty page when told to", async () => {
    const sizes = [10, 7, 10, 0];
    const asked: number[] = [];
    const pages = new Pages<number>(
      (page: number) => {
        asked.push(page);
        return Promise.resolve({ items: Array.from({ length: sizes[page - 1] }, () => page) });
      },
      { page: 1, until: "empty" },
    );
    expect(await all(pages)).toHaveLength(27);
    expect(asked).toEqual([1, 2, 3, 4]);
  });

  it("moves an offset on by the items a page held", async () => {
    const asked: number[] = [];
    const pages = new Pages<number>(
      (offset: number) => {
        asked.push(offset);
        return Promise.resolve({ results: Array.from({ length: Math.max(0, Math.min(50, 120 - offset)) }, (_, at) => offset + at) });
      },
      { offset: 0 },
    );
    expect(await all(pages)).toHaveLength(120);
    expect(asked).toEqual([0, 50, 100]);
  });

  it("asks for the same page again after one failed", async () => {
    const asked: number[] = [];
    let failed = false;
    const iterator = new Pages<number>(
      (page: number) => {
        asked.push(page);
        if (page === 2 && !failed) {
          failed = true;
          return Promise.resolve(undefined);
        }
        return Promise.resolve({ items: page < 3 ? [page, page] : [] });
      },
      { page: 1 },
    )[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.next();
    await expect(iterator.next()).rejects.toThrow(/A page failed to load/);
    expect((await iterator.next()).value).toBe(2);
    expect(asked).toEqual([1, 2, 2]);
  });

  it("refuses options that say two things", () => {
    const list = () => Promise.resolve({ items: [] });
    expect(() => new Pages(list, { page: 1, offset: 0 })).toThrow(/by page or by offset/);
    expect(() => new Pages(list, { page: 1, next: () => "" })).toThrow(/takes no next/);
    expect(() => new Pages(list, { until: "empty" })).toThrow(/until is for page and offset/);
  });
});

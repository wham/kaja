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

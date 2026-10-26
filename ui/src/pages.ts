/**
 * `kaja.pages`: a cursor-paged list method read as the items it lists. The loop every
 * paging script wrote — the cursor, the failed call, the stop — is written once here,
 * so what is left in the script is the call.
 *
 * Where the items and the next cursor are is read off the page when the script
 * doesn't say: the one list on it, and the first cursor field kaja knows by name. The
 * declaration asks for `items` or `next` exactly where that would be a guess, so a
 * page this can't read is an error in the editor rather than one page and a stop.
 */

export interface PagesOptions<P = any, T = unknown> {
  items?: (page: P) => Iterable<T>;
  next?: (page: P) => string | undefined | null;
  total?: (page: P) => number | undefined;
}

// In the order they are tried, which only matters for a page naming two.
export const CURSOR_KEYS = ["nextPageToken", "nextToken", "nextCursor", "endCursor"] as const;
export const TOTAL_KEYS = ["totalSize", "totalCount", "total"] as const;

function lists(page: object): string[] {
  return Object.entries(page)
    .filter(([, value]) => Array.isArray(value))
    .map(([key]) => key);
}

function readItems(page: any, options: PagesOptions): Iterable<unknown> {
  if (options.items) return options.items(page);
  const keys = lists(page);
  if (keys.length !== 1) {
    const found = keys.length === 0 ? "no list" : `${keys.length} lists (${keys.join(", ")})`;
    throw new Error(`kaja.pages: the page has ${found}, so say which holds the items: { items: (page) => page.${keys[0] ?? "items"} }`);
  }
  return page[keys[0]];
}

function readNext(page: any, options: PagesOptions): string | undefined {
  if (options.next) return options.next(page) ?? undefined;
  const key = CURSOR_KEYS.find((name) => typeof page[name] === "string");
  if (key === undefined) {
    throw new Error(`kaja.pages: the page has no cursor named ${CURSOR_KEYS.join(", ")}, so say where it is: { next: (page) => page.cursor }`);
  }
  return page[key];
}

function readTotal(page: any, options: PagesOptions): number | undefined {
  if (options.total) return options.total(page);
  const key = TOTAL_KEYS.find((name) => typeof page[name] === "number");
  return key === undefined ? undefined : page[key];
}

/**
 * One pass over the pages. Not a generator, because a generator that threw is over:
 * this one keeps its cursor, so asking again after a failed page asks for that page
 * again — which is what a table's Retry does.
 */
export class PageIterator<T> implements AsyncIterator<T> {
  // A table reads the total off the pages it pulls through this.
  onTotal?: (count: number) => void;
  #cursor = "";
  #buffer: T[] = [];
  #done = false;

  constructor(
    private readonly fetch: (cursor: string) => PromiseLike<unknown>,
    private readonly options: PagesOptions,
  ) {}

  async next(): Promise<IteratorResult<T>> {
    while (this.#buffer.length === 0) {
      if (this.#done) return { done: true, value: undefined };
      const page = await this.fetch(this.#cursor);
      // A failed call hands back undefined rather than throwing. The call is a row in
      // the log already; this says the pages stopped there.
      if (page === undefined || page === null) throw new Error("A page failed to load, so the list stops here. The call is in the log.");
      const total = readTotal(page, this.options);
      if (total !== undefined) this.onTotal?.(total);
      this.#buffer = [...readItems(page, this.options)] as T[];
      const next = readNext(page, this.options);
      // The same cursor twice is an API that would page forever.
      if (!next || next === this.#cursor) this.#done = true;
      else this.#cursor = next;
    }
    return { done: false, value: this.#buffer.shift()! };
  }
}

export class Pages<T> implements AsyncIterable<T> {
  constructor(
    private readonly fetch: (cursor: string) => PromiseLike<unknown>,
    private readonly options: PagesOptions = {},
  ) {
    if (typeof fetch !== "function") {
      throw new Error("kaja.pages: pass the call as a function of the cursor: kaja.pages((cursor) => Users.List({ pageToken: cursor }))");
    }
  }

  // Every pass starts from the first page.
  [Symbol.asyncIterator](): PageIterator<T> {
    return new PageIterator<T>(this.fetch, this.options);
  }
}

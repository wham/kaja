// The declaration of the `kaja` module — what a script gets from
// `import { kaja } from "kaja"`.
//
// It is written once and read twice: Monaco backs the import with it (see
// registerKajaModule in Editor.tsx) and the MCP catalog carries it to an agent
// (see mcpCatalog.ts), on the same rule the service declarations follow — the
// answer is the TypeScript a script is checked against, because a second model
// of it can disagree with the code, and did. The canvas verbs existed here for
// the editor and were described from memory in the MCP guide, which is exactly
// how an agent came to write a Markdown table by hand.

// Build the `variables` member type from the configured names so the editor
// suggests them and flags typos. With names it is an exact object; with none it
// falls back to an index signature so `kaja.variables.foo` isn't flagged before
// any variable exists.
function kajaVariablesType(variableNames: string[]): string {
  if (variableNames.length === 0) {
    return "{ [key: string]: string }";
  }
  const members = variableNames.map((name) => `    ${JSON.stringify(name)}: string;`).join("\n");
  return `{\n${members}\n  }`;
}

// The header states what the type system can't: that a script is a body of
// statements rather than a function, so it has no return value, and that what it
// produces it produces by drawing it.
const header = `// The Kaja runtime, imported as: import { kaja } from "kaja";
//
// A script is a body of statements, not a function: top-level \`await\` works and
// a top-level \`return\` is an error, so a script never returns anything. What it
// produces it draws — kaja.text/code/table draw on the run's canvas, which is
// what the person who ran it reads, and the calls it makes are recorded whether
// or not it mentions them.
//
// console.log and friends write a log beside that: the console's Calls view can
// mix those lines in among the calls, which is where a line is worth reading
// against the call before it. It is somewhere to probe rather than somewhere to
// put a script's output — the canvas is the output. There is no kaja.log; the
// standard console is the logging API, at every level.`;

export function kajaModuleDeclaration(variableNames: string[]): string {
  return `${header}

/**
 * A call that hasn't been made yet, which is what every service method hands
 * back: \`Shows.ListShows({})\` is the call, and awaiting it is what sends it.
 *
 * A call starts when it is awaited — or at the end of the tick, if nothing has
 * claimed it — so a bare \`Shows.Ping({})\` still goes out, and
 * \`Promise.all([a(), b()])\` still runs both at once. The gap of one tick is
 * what kaja.approve holds a call in.
 */
export interface Call<T> extends PromiseLike<T> {}

/** A plain JSON value, as accepted by kaja.value and friends. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** google.protobuf.Value. */
export interface Value {
  kind:
    | { oneofKind: "nullValue"; nullValue: 0 }
    | { oneofKind: "numberValue"; numberValue: number }
    | { oneofKind: "stringValue"; stringValue: string }
    | { oneofKind: "boolValue"; boolValue: boolean }
    | { oneofKind: "structValue"; structValue: Struct }
    | { oneofKind: "listValue"; listValue: ListValue };
}

/** google.protobuf.Struct. */
export interface Struct {
  fields: { [key: string]: Value };
}

/** google.protobuf.ListValue. */
export interface ListValue {
  values: Value[];
}

/**
 * A cell a table draws. Anything is a value and is rendered as text — but a
 * value you do not have yet is one of these two instead, and the cell draws as
 * loading until it arrives:
 *
 *   () => Ratings.GetRating({ id })   a function: nothing has been called yet,
 *                                     so it is called when the row is drawn —
 *                                     the rows you never page to cost nothing —
 *                                     and can be called again if it fails.
 *   ratings.then((r) => r[id])        a promise: work already under way, which
 *                                     the table only waits for.
 *
 * An Error, thrown or returned, is a cell that stopped: it draws as "—" with the
 * message on hover, and the rest of the table carries on filling.
 */
export type Cell = unknown;

/** A table being filled in on the run's canvas. */
export interface Table {
  /**
   * Append a row. It appears at once, so a loop paints as it runs. Fewer cells
   * than there are columns leaves the rest blank, so a row can be written before
   * the work that fills it is done — the handle it hands back is how you finish
   * it.
   *
   * A cell that isn't a value yet is a promise or a function (see Cell), which
   * is how a row is drawn from what you already have while the rest of it is
   * fetched:
   *
   *   for (const show of shows) {
   *     table.row(show.id, show.title, () => Ratings.GetRating({ id: show.id }));
   *   }
   */
  row(...cells: Cell[]): Row;
  /**
   * Add a column, once the run knows it needs one. The rows already drawn grow a
   * blank cell for it.
   */
  column(name: string): void;
  /**
   * State how many rows there are in the whole result set — the count an API
   * reports beside a page, which is the only place it can come from. Say it as
   * you learn it; the last word wins, and a new search starts the question over.
   *
   *   const customers = kaja.table(["key", "name"], async function* (search) {
   *     for (let page = 1; ; page++) {
   *       const result = await Customers.ListCustomers({ page, search });
   *       customers.total(result.totalCount);
   *       yield* result.items.map((customer) => [customer.key, customer.name]);
   *     }
   *   });
   *
   * A source paging a cursor has nothing to say here and says nothing: the table
   * then reports how many rows it has loaded and that there are more, rather
   * than passing that count off as the total.
   */
  total(count: number | undefined): void;
}

/** A row already on the canvas, which the run can keep up to date. */
export interface Row {
  /**
   * Rewrite the row: the same cells in the same order row() took them. A row is
   * only ever the whole of itself, so pass every cell, not just the one that
   * changed.
   *
   *   const row = table.row(account.id, "checking…");
   *   row.update(account.id, await check(account));
   *
   * Cells that were still on their way when a row is rewritten are dropped: they
   * answered the row as it was.
   */
  update(...cells: Cell[]): void;
}

/**
 * Rows a table draws. An array is an iterable; so is an async generator, and one
 * of those only runs when something pulls it — which is what makes paging fetch
 * a page and nothing else.
 */
export type Rows = Iterable<unknown[]> | AsyncIterable<unknown[]>;

/**
 * …or a function returning one, which is what a search that reaches the server
 * needs: a new search is a new result set, so the source is started again with
 * the text in hand. Declare the parameter and the search box goes to your
 * source; leave it out and the box filters the rows already loaded.
 */
export type RowSource = Rows | ((search: string) => Rows);

/** An option kaja.askSelect offers when the label isn't the value. */
export interface Choice<V> {
  label: string;
  value: V;
}

/** The Kaja runtime object. Import it with: import { kaja } from "kaja"; */
export declare const kaja: {
  /**
   * What a \`kaja://run/<script>?url=…&note=…\` link handed this run, read by
   * name: \`kaja.input.url\`. Every value is text, and the whole query belongs
   * to the script — no parameter name is reserved.
   *
   * Empty when the script is run from the editor, so a parameter the link
   * didn't carry is undefined: guard it (\`kaja.input.url ?? ""\`), or ask for
   * it with \`kaja.askStr\` and the script works both ways.
   */
  input: { [name: string]: string };
  /**
   * User-defined variables. Manage them in the Variables tab; read them here,
   * e.g. kaja.variables.API_BASE_URL. A variable whose value this machine holds
   * (your keychain, or an environment variable) reads the same way.
   */
  variables: ${kajaVariablesType(variableNames)};
  /**
   * Ask the user for text, and park the run on the answer. The question is
   * drawn on the run's canvas and the run stops there until it is answered; if
   * the user cancels, the script stops.
   *
   *   const name = await kaja.askStr("Which customer?");
   */
  askStr(question: string): Promise<string>;
  /**
   * Ask the user for a whole number. The field will not submit anything else,
   * so this always resolves with a number — never ask for text and parse it
   * yourself.
   *
   *   const limit = await kaja.askInt("How many rows?");
   */
  askInt(question: string): Promise<number>;
  /**
   * Ask the user to pick one of a fixed list. Strings resolve as themselves;
   * give { label, value } pairs and the value comes back, so picking from a list
   * of records hands you the record.
   *
   *   const region = await kaja.askSelect("Which region?", ["eu", "us"]);
   *
   *   const show = await kaja.askSelect(
   *     "Which show?",
   *     shows.map((show) => ({ label: show.title, value: show })),
   *   );
   */
  askSelect(question: string, options: readonly string[]): Promise<string>;
  askSelect<V>(question: string, options: readonly Choice<V>[]): Promise<V>;
  /**
   * Hold a call until it is approved. The call and the request it is about to
   * send are drawn on the run's canvas and the run stops there; approving sends
   * it and hands back the response, and not approving stops the script.
   *
   *   const show = await kaja.approve(Shows.CreateShow({ title: "Vera Lune" }));
   *
   * Write the call inside the parentheses. That is what makes it a call that
   * hasn't happened yet: a call kept in a variable and awaited elsewhere has
   * already gone out, and approving one is then too late to mean anything.
   *
   * Beside Approve the canvas offers **Approve all**, which settles this call
   * and every later one to the same method in this run — so a loop can be read
   * a couple of times and then let go. Nothing about that is the script's to
   * decide: write kaja.approve around every call worth a decision, and which of
   * them are read one by one is settled in front of them.
   */
  approve<T>(call: Call<T>): Promise<T>;
  /**
   * Write a line onto the run's canvas.
   *
   *   kaja.text(\`Reconciling \${accounts.length} accounts\`);
   */
  text(text: string): void;
  /**
   * Put a snippet of code on the run's canvas.
   *
   *   kaja.code(query, "sql");
   */
  code(code: string, language?: string): void;
  /**
   * Draw a table on the run's canvas and hand back a handle to fill it. Rows
   * appear as they are added, so a loop paints rather than reporting at the end.
   * This is how a script renders a table: never build one out of Markdown or
   * ASCII, and never return it.
   *
   *   const table = kaja.table(["id", "name", "status"]);
   *   for (const account of accounts) {
   *     table.row(account.id, account.name, await check(account));
   *   }
   *
   * A row hands back a handle, so a table can keep saying what is true while the
   * run goes on: write the row when the work starts, update it when it ends.
   * This is how a summary table is built — never redraw the whole table.
   *
   *   const rows = accounts.map((account) => ({
   *     account,
   *     row: table.row(account.id, account.name, "checking…"),
   *   }));
   *   for (const { account, row } of rows) {
   *     row.update(account.id, account.name, await check(account));
   *   }
   *
   * A cell whose value comes from somewhere else can be handed over as a promise
   * or a function instead, and draws as loading until it lands. The rows appear
   * with everything they already have:
   *
   *   const ratings = Ratings.GetRatings({ ids });
   *   for (const show of shows) {
   *     table.row(show.id, show.title, ratings.then((r) => r.byId[show.id]));
   *   }
   *
   * The rows can be given instead — an array, or a source that yields them as
   * the table is paged through. A source is only pulled when paging asks for
   * rows it hasn't got, so the second page costs a call and the tenth costs one
   * only if you go there. The table searches and pages either way.
   *
   *   kaja.table(["id", "title"], shows.map((show) => [show.id, show.title]));
   *
   *   kaja.table(["id", "title"], async function* (search) {
   *     for (let pageToken = ""; ; ) {
   *       const page = await Shows.ListShows({ pageSize: 25, pageToken, query: search });
   *       yield* page.shows.map((show) => [show.id, show.title]);
   *       if (!(pageToken = page.nextPageToken)) return;
   *     }
   *   });
   *
   * The table counts the rows it has. An API that reports how many there are in
   * total is the only thing that knows, so hand that on with the handle's
   * total() as the pages arrive.
   */
  table(columns: string[], rows?: RowSource, options?: { pageSize?: number }): Table;
  /**
   * Generate a random version 4 UUID, e.g. "9b2b1a94-3c6e-4f6e-9d2a-0f6b7c8d9e0f".
   *
   *   const id = kaja.uuidV4();
   */
  uuidV4(): string;
  /**
   * Build a google.protobuf.Value from a plain JSON value, instead of writing
   * its oneof out by hand. Objects and arrays are converted all the way down.
   *
   *   kaja.value("ready");
   *   kaja.value({ retries: 3, tags: ["a", "b"] });
   */
  value(input: JsonValue): Value;
  /**
   * Build a google.protobuf.Struct from a plain object.
   *
   *   kaja.struct({ region: "eu", replicas: 2 });
   */
  struct(input: { [key: string]: JsonValue }): Struct;
  /**
   * Build a google.protobuf.ListValue from a plain array.
   *
   *   kaja.listValue(["a", 1, true]);
   */
  listValue(input: JsonValue[]): ListValue;
};
`;
}

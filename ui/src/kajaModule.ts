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
// produces it produces by saying so.
const header = `// The Kaja runtime, imported as: import { kaja } from "kaja";
//
// A script is a body of statements, not a function: top-level \`await\` works and
// a top-level \`return\` is an error, so a script never returns anything. What it
// produces it draws or prints — kaja.text/code/table draw on the run's canvas,
// console.log writes the transcript beside it, and the calls it makes are
// recorded whether or not it mentions them.`;

export function kajaModuleDeclaration(variableNames: string[]): string {
  return `${header}

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

/** A table being filled in on the run's canvas. */
export interface Table {
  /**
   * Append a row. It appears at once, so a loop paints as it runs. A cell can be
   * anything; it is rendered as text.
   */
  row(...cells: unknown[]): void;
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
   * The selected text passed in when the script is launched from the macOS
   * "Run Kaja Script" text service. Undefined when the script is run manually
   * from the editor, so guard with a fallback (e.g. kaja.input ?? "").
   */
  input?: string;
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

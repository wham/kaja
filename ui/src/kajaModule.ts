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
   * Pause the script and ask the user for input. The question is drawn on the
   * run's canvas and the run stops there until it is answered. Resolves with
   * the submitted text; if the user cancels, the script stops.
   *
   *   const name = await kaja.ask("What's your name?");
   */
  ask(message: string): Promise<string>;
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
   */
  table(columns: string[], rows?: unknown[][]): Table;
  /** UUID helpers. */
  uuid: {
    /**
     * Generate a random version 4 UUID, e.g. "9b2b1a94-3c6e-4f6e-9d2a-0f6b7c8d9e0f".
     *
     *   const id = kaja.uuid.v4();
     */
    v4(): string;
  };
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

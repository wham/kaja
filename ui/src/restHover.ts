import * as monaco from "monaco-editor";
import { App } from "./apps";
import { appFor } from "./appImports";
import { restCallAt } from "./restCallAt";
import { getApiClient } from "./server/connection";

/**
 * What an API says about the operation under the cursor, shown over the path in the
 * script that calls it.
 *
 * The generated declarations carry what could be modelled — the request, the
 * response, which fields travel in the path — and the overload carries the API's own
 * summary. What is left is most of what a person reads before writing a call: the
 * prose under each parameter, the examples, the response codes that are never values,
 * the vendor extensions. That is served from the document itself.
 *
 * It sits over the path string because the TypeScript worker has nothing to say
 * there — it reports no hover at all inside a string literal argument — so this is an
 * empty slot rather than a second opinion. Where the worker does speak, on the
 * receiver and on the request, hovers from every provider are shown stacked, so
 * nothing here is in front of anything.
 *
 * Fetched when hovered rather than carried with the app: a document with nine hundred
 * operations would otherwise ride along with every compile to answer for the one under
 * the cursor. That is what an async provider buys, and why the fragment is nowhere in
 * the generated module or in the MCP catalog, both of which are read whole.
 */

// A document's own prose is the API's, and can run to paragraphs. It is not repeated
// in the fragment below, so this is the only place it is shown and the bound is
// generous — but a hover three screens tall is not a hover.
const MAX_DESCRIPTION = 600;

// Bounded for the same reason a payload pane is: one operation of a large document can
// be hundreds of lines, and a hover taller than the window is not one.
const MAX_DOCUMENT_LINES = 60;

let hoverApps: App[] = [];

export function setHoverApps(apps: App[]): void {
  hoverApps = apps;
}

// Keyed on the app's target as well as the operation, so a recompile that replaces the
// instance is a different question rather than a stale answer. A miss is remembered
// too: an app that documents nothing must not be asked once per hover.
const answers = new Map<string, Promise<monaco.IMarkdownString[] | undefined>>();

export function registerRestHover(): monaco.IDisposable {
  return monaco.languages.registerHoverProvider("typescript", {
    async provideHover(model, position) {
      const call = restCallAt(model.getValue(), model.getOffsetAt(position));
      if (!call) return null;

      const app = appFor(hoverApps, call.appSpecifier);
      if (!app?.target) return null;

      const contents = await documentationFor(app, `${call.verb} ${call.path}`);
      if (!contents) return null;

      const start = model.getPositionAt(call.start);
      const end = model.getPositionAt(call.end);
      return { range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), contents };
    },
  });
}

function documentationFor(app: App, operation: string): Promise<monaco.IMarkdownString[] | undefined> {
  const key = `${app.target}\n${operation}`;
  const held = answers.get(key);
  if (held) return held;

  const asked = getApiClient()
    .getMethodDocumentation({ target: app.target, method: operation })
    .response.then(({ documentation }) => (documentation ? card(operation, documentation) : undefined))
    // A hover that could not ask says nothing, and asks again next time rather than
    // remembering that it failed.
    .catch(() => {
      answers.delete(key);
      return undefined;
    });

  answers.set(key, asked);
  return asked;
}

interface Documentation {
  summary: string;
  description: string;
  deprecated: boolean;
  document: string;
  language: string;
}

// The card is three things in the order they are wanted: what the operation is, what
// the API says about it, and the declaration itself.
function card(operation: string, documentation: Documentation): monaco.IMarkdownString[] {
  const headline = [`**\`${operation}\`**`];
  if (documentation.deprecated) headline.push("· _deprecated_");
  if (documentation.summary) headline.push(`\n\n${documentation.summary}`);

  const contents: monaco.IMarkdownString[] = [{ value: headline.join(" ") }];

  // The summary is already the headline, and a description that only repeats it is a
  // second copy rather than more to read. The fragment below carries neither, so this
  // is the one place the API's prose is stated.
  const description = clamp(documentation.description, MAX_DESCRIPTION);
  if (description && description !== documentation.summary) {
    contents.push({ value: description });
  }

  const document = clampLines(documentation.document, MAX_DOCUMENT_LINES);
  if (document) {
    contents.push({ value: "```" + (documentation.language || "yaml") + "\n" + document + "\n```" });
  }
  return contents;
}

function clamp(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? trimmed.slice(0, limit).trimEnd() + "…" : trimmed;
}

// A cut says how much it left, because a fragment that stops without saying so reads
// as an operation that declares less than it does.
function clampLines(text: string, limit: number): string {
  const lines = text.split("\n");
  if (lines.length <= limit) return text.trimEnd();
  return lines.slice(0, limit).join("\n") + `\n# … ${lines.length - limit} more lines`;
}

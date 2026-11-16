import { printJson } from "./payloadText";

/**
 * A string that is itself a JSON document.
 *
 * An API with nowhere to put structure puts it in a string: an MCP tool that
 * declares no output schema returns its result as the text of a content block,
 * and a gRPC or REST field called `payload` does the same thing. The document is
 * there, escaped, on one line, and reading it is what the pane is open for.
 *
 * So the reading is offered rather than applied, at the string itself. Nothing
 * about the call changes: the wire, the generated type and what a script gets back
 * are all still the string, on the rule `unwrapEnvelope` is under. Only the pane
 * draws the document in place of the string, and only where it is asked to.
 */

// readEmbedded returns the document a string carries, or undefined when it
// carries text. A document is an object or an array and nothing else: "123",
// "true" and "null" all parse, and a number an API chose to send as a string is a
// string — drawing it as a number would be the pane saying what the API did not.
export function readEmbedded(text: string): unknown {
  const trimmed = text.trim();
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

// One string in a printed payload that carries a document: where it was drawn, and
// whether it was drawn as the string or opened into the document. `key` is the path
// to it, which is what stays the same from one call of a method to the next.
export interface EmbeddedMark {
  key: string;
  open: boolean;
  from: number;
  to: number;
}

export interface PrintedPayload {
  text: string;
  marks: EmbeddedMark[];
}

const MARKER = /"\\u0001(\d+)\\u0001"/g;

/**
 * printEmbedded prints a payload the way `printJson` does, with each string that
 * carries a document drawn either as the string or, where its key is in `opened`,
 * as the document indented in its place. The walk goes as deep as the payload
 * does, since the string is rarely at the top — an MCP result carries it two
 * levels down — but never into what it read: a document inside a document is one
 * guess built on another.
 *
 * Each such string is swapped for a marker before printing and the marker for the
 * text after, so everything else is printed by the one printer there is.
 */
export function printEmbedded(payload: unknown, opened: ReadonlySet<string>, prefix = ""): PrintedPayload {
  const found: { key: string; sent: string; document: unknown }[] = [];

  const walk = (node: unknown, path: string): unknown => {
    if (typeof node === "string") {
      const document = readEmbedded(node);
      if (document === undefined) return node;
      found.push({ key: path, sent: node, document });
      return `\u0001${found.length - 1}\u0001`;
    }
    if (Array.isArray(node)) {
      const read = node.map((item, index) => walk(item, `${path}/${index}`));
      return read.some((item, index) => item !== node[index]) ? read : node;
    }
    if (!isRecord(node)) return node;
    let changed = false;
    const read: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(node)) {
      read[key] = walk(item, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
      if (read[key] !== item) changed = true;
    }
    return changed ? read : node;
  };

  const printed = printJson(walk(payload, prefix));
  if (found.length === 0) return { text: printed, marks: [] };

  const marks: EmbeddedMark[] = [];
  let text = "";
  let last = 0;
  for (const match of printed.matchAll(MARKER)) {
    const { key, sent, document } = found[Number(match[1])];
    text += printed.slice(last, match.index);
    const indent = /[ ]*/.exec(printed.slice(printed.lastIndexOf("\n", match.index) + 1))![0];
    const open = opened.has(key);
    const drawn = open ? printJson(document).replaceAll("\n", `\n${indent}`) : JSON.stringify(sent);
    marks.push({ key, open, from: text.length, to: text.length + drawn.length });
    text += drawn;
    last = match.index + match[0].length;
  }
  return { text: text + printed.slice(last), marks };
}

// A payload is a generated message rather than an object literal, and the runtime
// creates one over a prototype of its own — so a walk that descended only into
// objects made by `{}` never reached a response at all.
function isRecord(node: unknown): node is Record<string, unknown> {
  if (node === null || typeof node !== "object") return false;
  return !ArrayBuffer.isView(node) && !(node instanceof Date) && !(node instanceof Map) && !(node instanceof Set);
}

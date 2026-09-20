/**
 * A string that is itself a JSON document.
 *
 * An API with nowhere to put structure puts it in a string: an MCP tool that
 * declares no output schema returns its result as the text of a content block,
 * and a gRPC or REST field called `payload` does the same thing. The document is
 * there, escaped, on one line, and reading it is what the pane is open for.
 *
 * So the reading is offered rather than applied. Nothing about the call changes:
 * the wire, the generated type and what a script gets back are all still the
 * string, on the rule `unwrapEnvelope` is under. Only the pane draws the document
 * in place of the string, and only while it is asked to.
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

// What a payload holds once its strings have been read, and whether any of them
// were. The pair is one walk, because the button offering the reading exists
// exactly when the reading changes something.
export interface EmbeddedPayload {
  value: unknown;
  found: boolean;
}

/**
 * spliceEmbedded rewrites a payload with each document its strings carry read in
 * place of the string. The walk goes as deep as the payload does, since the
 * string is rarely at the top — an MCP result carries it two levels down — but it
 * never descends into what it just read. A document inside a document is one
 * guess built on another, and the first wrong one would take the rest with it.
 *
 * Anything holding no fields is handed back as it was: a bytes field is a
 * Uint8Array, and walking one would draw it as a map of indices.
 */
export function spliceEmbedded(payload: unknown): EmbeddedPayload {
  let found = false;

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      const document = readEmbedded(node);
      if (document === undefined) return node;
      found = true;
      return document;
    }
    if (Array.isArray(node)) {
      const read = node.map(walk);
      return read.some((item, index) => item !== node[index]) ? read : node;
    }
    if (!isRecord(node)) return node;
    let changed = false;
    const read: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(node)) {
      read[key] = walk(item);
      if (read[key] !== item) changed = true;
    }
    return changed ? read : node;
  };

  return { value: walk(payload), found };
}

// A payload is a generated message rather than an object literal, and the runtime
// creates one over a prototype of its own — so a walk that descended only into
// objects made by `{}` never reached a response at all.
function isRecord(node: unknown): node is Record<string, unknown> {
  if (node === null || typeof node !== "object") return false;
  return !ArrayBuffer.isView(node) && !(node instanceof Date) && !(node instanceof Map) && !(node instanceof Set);
}

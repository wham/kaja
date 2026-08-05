// The Variables tab's JSON view edits the same map its table does, so the two
// have to mean the same thing. Parsing is the strict direction: the variables
// block of kaja.json is a flat map of strings, and anything else is a mistake
// the error bar should name rather than a row the switch back would drop.
//
// Messages carry no closing full stop: the bar that shows them follows each one
// with a sentence of its own.

export interface ParsedVariablesJson {
  variables?: { [key: string]: string };
  error?: string;
  // Whether the text failed to parse at all, as opposed to parsing into
  // something that isn't a variables block. Only the former has a position an
  // editor diagnostic could point at.
  syntax?: boolean;
}

export function parseVariablesJson(text: string): ParsedVariablesJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: describeJsonError(text, error), syntax: true };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "The variables block is an object of names and values" };
  }

  const variables: { [key: string]: string } = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") {
      return { error: `${name} must be a string` };
    }
    variables[name] = value;
  }
  return { variables };
}

// describeJsonMarker phrases the editor's own diagnostic, which is the better
// source: it carries a line whatever engine the app is running on.
export function describeJsonMarker(line: number, message: string): string {
  return `Line ${line} — ${lowercase(message.replace(/\.$/, "").trim())}`;
}

// describeJsonError names where the text stops parsing, for when there is no
// diagnostic to read. Engines phrase the failure differently and only some of
// them carry a position, so the line is counted back from it when there is one.
export function describeJsonError(text: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const detail = jsonErrorDetail(raw);
  const line = jsonErrorLine(text, raw);
  return line === undefined ? capitalize(detail) : `Line ${line} — ${detail}`;
}

const END_OF_INPUT = /unexpected (end of (json )?input|eof)/i;

function jsonErrorDetail(raw: string): string {
  if (END_OF_INPUT.test(raw)) {
    return "unexpected end of input";
  }
  // Trim what the engine wraps around the failure: WebKit's prefix, V8's
  // trailing position. The line is stated separately.
  const detail = raw
    .replace(/^JSON Parse error:\s*/i, "")
    .replace(/\s+(in JSON )?at position.*$/i, "")
    .trim();
  return detail ? lowercase(detail) : "invalid JSON";
}

function jsonErrorLine(text: string, raw: string): number | undefined {
  const stated = raw.match(/\bline (\d+)/i);
  if (stated) return Number(stated[1]);

  const position = raw.match(/position (\d+)/i);
  if (position) {
    const offset = Math.min(Number(position[1]), text.length);
    return text.slice(0, offset).split("\n").length;
  }

  // An input that just stops has no position: it failed at the end of it.
  if (END_OF_INPUT.test(raw)) {
    return text.split("\n").length;
  }
  return undefined;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowercase(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

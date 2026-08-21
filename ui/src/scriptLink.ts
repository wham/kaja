/**
 * `kaja://run/<script>?key=value&key=value` — the link that runs a script.
 *
 * The verb is the host and the script is the path, which is what leaves the
 * whole query string to the script: there are no reserved parameter names, so
 * a script is free to take one called `script` or `run` without knowing this
 * file exists. A script reads them as `kaja.input.<key>`.
 *
 * The link is a handle for whatever can open a URL — a Raycast quicklink, an
 * Alfred workflow, a Shortcut on a hotkey, `open` from a shell — so it carries
 * text and only text, and every value arrives as a string.
 */

export const LINK_SCHEME = "kaja";

export interface ScriptLink {
  /** The script the link names, without its extension. */
  script: string;
  /** The query, verbatim. What the script reads as `kaja.input`. */
  input: { [key: string]: string };
}

export type ParsedScriptLink = { ok: true; link: ScriptLink } | { ok: false; error: string };

/**
 * The name a link spells a script with: its name within the scripts folder,
 * without the `.ts`. A file in a folder keeps the folder — `reports/churn` —
 * because that is its name, and two files can share a base name.
 */
export function linkName(fileName: string): string {
  return fileName.replace(/\.ts$/, "");
}

/**
 * Whether a script file is the one a link names, written with or without `.ts`.
 * A link that names no folder matches by base name, which is what every link
 * written before folders existed says.
 */
export function isLinkedScript(scriptName: string, named: string): boolean {
  const wanted = linkName(named);
  if (linkName(scriptName) === wanted) return true;
  return !wanted.includes("/") && baseName(linkName(scriptName)) === wanted;
}

/** The link that runs a script. What the sidebar's Copy link puts on the clipboard. */
export function scriptLink(fileName: string, input?: { [key: string]: string }): string {
  return scriptLinkParts(fileName, input)
    .map((part) => part.text)
    .join("");
}

/**
 * The same link, split into what it is made of. The sheet shows the URL whole
 * and dims everything that is the scheme rather than the script's own — so the
 * link it displays is the link it copies, by construction rather than by two
 * functions agreeing.
 */
export type LinkPart = { kind: "scheme" | "script" | "key" | "value"; text: string };

export function scriptLinkParts(fileName: string, input?: { [key: string]: string }): LinkPart[] {
  const path = linkName(fileName)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const parts: LinkPart[] = [
    { kind: "scheme", text: `${LINK_SCHEME}://run/` },
    { kind: "script", text: path },
  ];

  const entries = Object.entries(input ?? {});
  entries.forEach(([name, value], index) => {
    // Encoded a pair at a time, by the same URLSearchParams that writes the
    // whole query, so splitting the link up can't change what it says.
    const pair = new URLSearchParams([[name, value]]).toString();
    const equals = pair.indexOf("=");
    parts.push({ kind: "key", text: `${index === 0 ? "?" : "&"}${pair.slice(0, equals + 1)}` });
    if (equals + 1 < pair.length) parts.push({ kind: "value", text: pair.slice(equals + 1) });
  });

  return parts;
}

function baseName(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? path : path.slice(at + 1);
}

export function parseScriptLink(text: string): ParsedScriptLink {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { ok: false, error: `Not a link: ${text}` };
  }
  if (url.protocol !== `${LINK_SCHEME}:`) {
    return { ok: false, error: `A Kaja link starts with ${LINK_SCHEME}://` };
  }
  // A kaja:// host is opaque, so it keeps the case it was written in.
  if (url.host.toLowerCase() !== "run") {
    return { ok: false, error: `${LINK_SCHEME}://${url.host} is not something Kaja does. Links run a script: ${LINK_SCHEME}://run/<script>` };
  }
  const script = url.pathname.replace(/^\/+/, "").split("/").map(decodeSegment).join("/").trim();
  if (!script) {
    return { ok: false, error: `This link names no script. Links run a script: ${LINK_SCHEME}://run/<script>` };
  }
  return { ok: true, link: { script: linkName(script), input: Object.fromEntries(url.searchParams) } };
}

// A path this malformed is the caller's typing rather than an encoding, so it
// is read as what it says instead of failing the whole link.
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

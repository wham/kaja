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

/** The name a link spells a script with: its file name, without the `.ts`. */
export function linkName(fileName: string): string {
  return fileName.replace(/\.ts$/, "");
}

/** Whether a script file is the one a link names, written with or without `.ts`. */
export function isLinkedScript(fileName: string, named: string): boolean {
  return linkName(fileName) === linkName(named);
}

/** The link that runs a script. What the sidebar's Copy Link puts on the clipboard. */
export function scriptLink(fileName: string, input?: { [key: string]: string }): string {
  const link = `${LINK_SCHEME}://run/${encodeURIComponent(linkName(fileName))}`;
  const query = new URLSearchParams(input ?? {}).toString();
  return query ? `${link}?${query}` : link;
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
  const script = decodeSegment(url.pathname.replace(/^\/+/, "")).trim();
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

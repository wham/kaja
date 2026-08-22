import { isWailsEnvironment } from "./wails";

/**
 * `kaja://run/<script>?key=value&key=value` — the deeplink that runs a script.
 *
 * The verb is the host and the script is the path, which leaves the whole query string
 * to the script: there are no reserved parameter names, so a script may take one
 * called `script` or `run`. Every value arrives as a string, read as `kaja.input.<key>`.
 *
 * A page can't register a scheme, so the web says the same thing after a `#`:
 * `https://kaja.example.com/#run/<script>?key=value`. The fragment is the `kaja://`
 * link minus its scheme and is read as exactly that — one grammar, one parser. A
 * fragment rather than a path because it is never sent to a server and never has to be
 * routed by one; rather than a `?run=` of its own because a query parameter named here
 * is one a script can never take.
 */

export const LINK_SCHEME = "kaja";
/** The verb, which is the host of a `kaja://` link and the head of a fragment. */
export const LINK_VERB = "run";

/** Where a `kaja://` deeplink starts. What the desktop copies. */
export const DESKTOP_LINK_BASE = `${LINK_SCHEME}://${LINK_VERB}/`;

export interface ScriptLink {
  /** The script the link names, without its extension. */
  script: string;
  /** The query, verbatim. What the script reads as `kaja.input`. */
  input: { [key: string]: string };
}

export type ParsedScriptLink = { ok: true; link: ScriptLink } | { ok: false; error: string };

/**
 * Where a deeplink to *this* Kaja starts — the one function here that asks what it is
 * running in. The desktop registered a scheme, so it owns `kaja://run/`; a browser can
 * only address itself.
 */
export function linkBase(): string {
  if (isWailsEnvironment()) return DESKTOP_LINK_BASE;
  try {
    // Where Kaja is served from rather than where it currently points, so a Kaja under a
    // base path copies links that come back to it and one opened with a query of its own
    // doesn't bake that query into everything it hands out.
    const here = new URL(window.location.href);
    here.search = "";
    here.hash = "";
    return `${here.href}#${LINK_VERB}/`;
  } catch {
    return DESKTOP_LINK_BASE;
  }
}

/**
 * The name a deeplink spells a script with: its name within the scripts folder,
 * without the `.ts`. A file in a folder keeps the folder (`reports/churn`).
 *
 * The extension is off the path because a deeplink is meant to outlive the file: a
 * rename or a move should not break a quicklink saved a month ago. The cost is that
 * two scripts can't share a name across extensions, which the sidebar already says.
 */
export function linkName(fileName: string): string {
  return fileName.replace(/\.ts$/, "");
}

/**
 * Whether a script file is the one a link names, written with or without `.ts`. A link
 * that names no folder matches by base name, which is what every link written before
 * folders existed says.
 */
export function isLinkedScript(scriptName: string, named: string): boolean {
  const wanted = linkName(named);
  if (linkName(scriptName) === wanted) return true;
  return !wanted.includes("/") && baseName(linkName(scriptName)) === wanted;
}

/** The deeplink that runs a script. What Copy deeplink puts on the clipboard. */
export function scriptLink(fileName: string, input?: { [key: string]: string }, base: string = linkBase()): string {
  return scriptLinkParts(fileName, input, base)
    .map((part) => part.text)
    .join("");
}

/**
 * The same deeplink, split into what it is made of, so the link the sheet displays is
 * the link it copies by construction rather than by two functions agreeing.
 */
export type LinkPart = { kind: "base" | "script" | "key" | "value"; text: string };

export function scriptLinkParts(fileName: string, input?: { [key: string]: string }, base: string = linkBase()): LinkPart[] {
  const path = linkName(fileName)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const parts: LinkPart[] = [
    { kind: "base", text: base },
    { kind: "script", text: path },
  ];

  const entries = Object.entries(input ?? {});
  entries.forEach(([name, value], index) => {
    // Encoded a pair at a time, by the same URLSearchParams that writes the whole query,
    // so splitting the link up can't change what it says.
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

/**
 * Whether a page's URL carries a deeplink in its fragment. Anything else after a `#`
 * is somebody else's anchor and is left alone.
 */
export function hasScriptLink(href: string): boolean {
  return scriptLinkFragment(href) !== undefined;
}

export function parseScriptLink(text: string): ParsedScriptLink {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { ok: false, error: `Not a link: ${text}` };
  }
  if (url.protocol !== `${LINK_SCHEME}:`) {
    // The fragment is the link minus its scheme, so it is read by putting the scheme back
    // on rather than by a second parser.
    const fragment = scriptLinkFragment(text);
    if (fragment === undefined) {
      return { ok: false, error: `A Kaja link is ${DESKTOP_LINK_BASE}<script>, or #${LINK_VERB}/<script> on the web.` };
    }
    try {
      url = new URL(`${LINK_SCHEME}://${fragment}`);
    } catch {
      return { ok: false, error: `Not a link: ${text}` };
    }
  }
  // A kaja:// host is opaque, so it keeps the case it was written in.
  if (url.host.toLowerCase() !== LINK_VERB) {
    return { ok: false, error: `${LINK_SCHEME}://${url.host} is not something Kaja does. Links run a script: ${DESKTOP_LINK_BASE}<script>` };
  }
  const script = url.pathname.replace(/^\/+/, "").split("/").map(decodeSegment).join("/").trim();
  if (!script) {
    return { ok: false, error: `This link names no script. Links run a script: ${DESKTOP_LINK_BASE}<script>` };
  }
  return { ok: true, link: { script: linkName(script), input: Object.fromEntries(url.searchParams) } };
}

/** The `run/…` a page URL carries after its `#`, if that is what it carries. */
function scriptLinkFragment(href: string): string | undefined {
  let hash: string;
  try {
    hash = new URL(href.trim()).hash;
  } catch {
    return undefined;
  }
  const fragment = hash.slice(1);
  return new RegExp(`^${LINK_VERB}(?:$|[/?])`, "i").test(fragment) ? fragment : undefined;
}

// A path this malformed is the caller's typing rather than an encoding, so it is read
// as what it says instead of failing the whole link.
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

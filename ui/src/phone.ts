import { Method } from "./apps";
import { streamingKind } from "./streaming";

/**
 * One breakpoint. Under it the window is a phone: no splitters, no status bar, and
 * the sidebar is a drawer under the page. Above it the desktop frame is drawn
 * unchanged, so an iPad in landscape is the desktop.
 */
export const PHONE_QUERY = "(max-width: 639px)";

/** An iPhone, in the app or in Safari, whatever width the window is drawn at. */
export function isIPhone(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPod/.test(navigator.userAgent);
}

// A flick decides by its direction; anything slower by which end is nearest.
const FLICK_VELOCITY = 0.4;

/**
 * Where the drawer lands when it is let go. `progress` is how far open it was left,
 * 0 to 1, and `velocity` is in px/ms, positive toward open. A flick goes its own way
 * however little it travelled; anything slower by which end is nearer.
 */
export function snapDrawer(progress: number, velocity: number): boolean {
  if (velocity > FLICK_VELOCITY) return true;
  if (velocity < -FLICK_VELOCITY) return false;
  return progress >= 0.5;
}

export type MethodTag = "write" | "stream";

/**
 * The one word a finder row carries beside a method. `write` is read off the HTTP
 * verb, which is the only thing that states whether a call changes something; a
 * method with no verb gets no guess. `stream` names the kind of call, whether or not
 * Kaja can make it.
 */
export function methodTag(method: Method): MethodTag | undefined {
  if (streamingKind(method) !== undefined) return "stream";
  const verb = method.http?.split(" ")[0]?.toUpperCase();
  if (!verb) return undefined;
  return verb === "GET" || verb === "HEAD" || verb === "OPTIONS" || verb === "TRACE" ? undefined : "write";
}

export interface MatchPart {
  text: string;
  match: boolean;
}

/**
 * A name split around the first place the query occurs in it, so the row can draw
 * the letters that matched at full weight. A query that occurs nowhere is one part.
 */
export function matchParts(text: string, query: string): MatchPart[] {
  const term = query.trim().toLowerCase();
  if (term === "") return [{ text, match: false }];
  const at = text.toLowerCase().indexOf(term);
  if (at === -1) return [{ text, match: false }];
  const parts: MatchPart[] = [];
  if (at > 0) parts.push({ text: text.slice(0, at), match: false });
  parts.push({ text: text.slice(at, at + term.length), match: true });
  if (at + term.length < text.length) parts.push({ text: text.slice(at + term.length), match: false });
  return parts;
}

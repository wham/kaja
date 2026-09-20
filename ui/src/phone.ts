import { Method } from "./apps";
import { streamingKind } from "./streaming";

/**
 * One breakpoint. Under it the window is a phone: no sidebar, no splitters, no status
 * bar, and the finder is the whole of the navigation. Above it the desktop frame is
 * drawn unchanged, so an iPad in landscape is the desktop.
 */
export const PHONE_QUERY = "(max-width: 639px)";

export type SheetPosition = "rest" | "up";

// A flick decides by its direction; anything slower by which end is nearer.
const FLICK_VELOCITY = 0.4;

/**
 * Where a sheet lands when it is let go. `offset` is how far down from `up` it sits,
 * `restOffset` is where it sits at rest, and `velocity` is in px/ms, positive
 * downward.
 */
export function snapSheet(offset: number, restOffset: number, velocity: number): SheetPosition {
  if (velocity > FLICK_VELOCITY) return "rest";
  if (velocity < -FLICK_VELOCITY) return "up";
  return offset < restOffset / 2 ? "up" : "rest";
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

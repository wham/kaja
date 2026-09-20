import { Method } from "./apps";
import { streamingKind } from "./streaming";

/**
 * One breakpoint. Under it the window is a phone: no sidebar, no splitters, no status
 * bar, and the finder is the whole of the navigation. Above it the desktop frame is
 * drawn unchanged, so an iPad in landscape is the desktop.
 */
export const PHONE_QUERY = "(max-width: 639px)";

/**
 * Where the script's sheet sits. `rest` is the grabber alone, `half` shows the code
 * over the run it produced, and `full` is what editing needs — a keyboard leaves
 * nothing over for the run anyway.
 */
export type SheetPosition = "rest" | "half" | "full";

export interface SheetStop {
  position: SheetPosition;
  // How far down from `full` this place sits.
  offset: number;
}

// A flick decides by its direction; anything slower by which place is nearest.
const FLICK_VELOCITY = 0.4;

// Where the middle place sits, as a share of the way from full down to rest.
const HALF_SHARE = 0.45;

/**
 * The three places a sheet has, given how far down its resting place is. Ordered
 * from the top down, which is what makes a flick one step through the list.
 */
export function sheetStops(restOffset: number): SheetStop[] {
  return [
    { position: "full", offset: 0 },
    { position: "half", offset: Math.round(restOffset * HALF_SHARE) },
    { position: "rest", offset: restOffset },
  ];
}

/**
 * Where a sheet lands when it is let go. `offset` is how far down from `full` it was
 * left, `from` is where the drag started, and `velocity` is in px/ms, positive
 * downward. A flick moves one place in its own direction rather than to the end, so
 * the middle place is reachable by the same gesture that leaves it.
 */
export function snapSheet(offset: number, stops: SheetStop[], velocity: number, from: SheetPosition): SheetPosition {
  const step = velocity > FLICK_VELOCITY ? 1 : velocity < -FLICK_VELOCITY ? -1 : 0;
  if (step !== 0) {
    const at = stops.findIndex((stop) => stop.position === from);
    return stops[Math.max(0, Math.min(stops.length - 1, (at === -1 ? 0 : at) + step))].position;
  }
  return stops.reduce((nearest, stop) => (Math.abs(stop.offset - offset) < Math.abs(nearest.offset - offset) ? stop : nearest)).position;
}

/** A tap on the chrome raises a resting sheet and drops a raised one. */
export function tapSheet(position: SheetPosition): SheetPosition {
  return position === "rest" ? "half" : "rest";
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

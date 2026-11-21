import { App } from "./apps";
import { editableRows } from "./requestEdits";

/**
 * The values a script's requests write, as places to put the caret: what the phone's
 * bar steps through with Prev and Next, the way a form is filled in field by field.
 * A string's stop is inside its quotes, so what is typed replaces the text and keeps
 * the literal.
 */
export interface FieldStop {
  key: string;
  from: number;
  to: number;
}

export function fieldStops(code: string, apps: App[]): FieldStop[] {
  return editableRows(code, apps).map(({ key, value }) => {
    const quoted = value.kind === "string";
    return { key, from: value.start + (quoted ? 1 : 0), to: value.end - (quoted ? 1 : 0) };
  });
}

export function stopAt(stops: FieldStop[], head: number): number | undefined {
  const index = stops.findIndex((stop) => stop.from <= head && head <= stop.to);
  return index < 0 ? undefined : index;
}

// The stop after the caret, or before it, counting from the one it is in.
export function hop(stops: FieldStop[], head: number, forward: boolean): number | undefined {
  const current = stopAt(stops, head);
  if (current !== undefined) {
    const next = current + (forward ? 1 : -1);
    return next >= 0 && next < stops.length ? next : undefined;
  }
  if (forward) {
    const next = stops.findIndex((stop) => stop.from > head);
    return next < 0 ? undefined : next;
  }
  const before = stops.findLastIndex((stop) => stop.to < head);
  return before < 0 ? undefined : before;
}

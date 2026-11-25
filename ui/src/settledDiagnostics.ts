import { Diagnostic } from "@codemirror/lint";

export const SETTLE_MS = 1500;

/**
 * What to draw while somebody is typing: code half written is wrong in ways the next
 * keystroke fixes, so a new mark waits for a pause and one that is gone goes at once.
 */
export function settledDiagnostics(found: Diagnostic[], shown: Diagnostic[], sinceEdit: number): Diagnostic[] {
  if (sinceEdit >= SETTLE_MS) return found;
  return found.filter((diagnostic) =>
    shown.some((other) => other.message === diagnostic.message && other.from <= diagnostic.to && diagnostic.from <= other.to),
  );
}

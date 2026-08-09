/**
 * The most a response is drawn at. Past it Monaco spends longer tokenizing than
 * anyone spends reading, so the tail is cut and the cut says so — the same
 * bargain the store makes with expired payloads, and better than a pane that
 * takes a second to paint something nobody scrolls to the end of.
 */
const MAX_DRAWN_CHARS = 2_000_000;

/**
 * A response is printed, not formatted. Prettier costs about 2 ms a payload and
 * a parser download, against a fiftieth of that for the printer built into the
 * language, and the two disagree only in places nobody reads a response for. It
 * is also synchronous, which is what stops a slow payload landing over a newer
 * one — the selection follows a run as it happens.
 */
export function printJson(value: unknown): string {
  try {
    // A 64-bit field arrives as a bigint under some jstype settings, and
    // stringify throws on one rather than printing it.
    return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item), 2) ?? "";
  } catch {
    return String(value);
  }
}

// What is handed to the editor: the payload, or its head and a line saying how
// much of it is not being drawn.
export function drawnText(text: string): string {
  if (text.length <= MAX_DRAWN_CHARS) return text;
  const dropped = text.length - MAX_DRAWN_CHARS;
  return `${text.slice(0, MAX_DRAWN_CHARS)}\n\n… ${dropped.toLocaleString()} more characters not shown — copy to get all of it`;
}

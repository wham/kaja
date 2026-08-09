// What an ask is asking for, and the one rule its answer has to satisfy.
//
// It lives here rather than in the block or in the canvas because three places
// need the same reading of it: the canvas draws the control, the fallback dialog
// draws the same control without a canvas, and `kaja.askStr`/`askInt`/`askSelect` hand the script
// back the kind of thing it asked for. The point of the typed asks is that the
// parse happens where the person who typed it can still fix it, so the check has
// to be in front of them rather than in the script a line later.

/** The kinds of thing a script can ask for. */
export type AskAnswerType = "str" | "int" | "select";

const INTEGER = /^[+-]?\d+$/;

/**
 * The whole number this text is, or undefined if it isn't one. Strict on
 * purpose: "3.5" and "3 apples" are not whole numbers, and quietly taking the 3
 * out of either is the bug the typed ask exists to prevent.
 */
export function parseInteger(text: string): number | undefined {
  const trimmed = text.trim();
  if (!INTEGER.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * Why this text doesn't answer the question, or undefined if it does. An empty
 * answer is a valid string — the script asked for text and got text — so only an
 * int has anything to reject.
 */
export function answerProblem(answerType: AskAnswerType, text: string): string | undefined {
  if (answerType !== "int") return undefined;
  if (parseInteger(text) !== undefined) return undefined;
  return text.trim() === "" ? "Enter a whole number" : "Not a whole number";
}

/**
 * The answer as it is recorded, once it passes. An int is normalised, so the run
 * stores the number that was read rather than the spacing it was typed with.
 */
export function normalizeAnswer(answerType: AskAnswerType, text: string): string {
  if (answerType !== "int") return text;
  const value = parseInteger(text);
  return value === undefined ? text : String(value);
}

/** What the field says before anything is typed into it. */
export function answerPlaceholder(answerType: AskAnswerType): string {
  return answerType === "int" ? "Whole number…" : "Answer…";
}

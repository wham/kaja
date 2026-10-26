/**
 * A cell holding an instant is drawn as how long ago it was. The block keeps the
 * instant itself, so a run read back next week says how long ago it is then, and
 * copying a cell copies what the API sent.
 *
 * Only a date with a time and a zone is an instant; a bare date is a day, and a
 * time with no zone is a wall clock somewhere nobody said.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

export function readInstant(text: string): Date | undefined {
  if (!INSTANT.test(text)) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Past two months a count of days is arithmetic the reader has to do, so the date is
// the answer.
export function timeAgo(date: Date, now: number): string {
  const ms = now - date.getTime();
  const span = Math.abs(ms);
  if (span < MINUTE) return "just now";
  if (span > 60 * DAY) return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const amount = span < HOUR ? `${Math.round(span / MINUTE)}m` : span < 48 * HOUR ? `${Math.round(span / HOUR)}h` : `${Math.round(span / DAY)}d`;
  return ms >= 0 ? `${amount} ago` : `in ${amount}`;
}

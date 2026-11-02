export interface TimestampMatch {
  fieldName: string;
  seconds: string;
  nanos: number;
  // Offsets into the text: where the picker is anchored (the brace), and the whole
  // `field: { … }` it rewrites.
  anchor: number;
  from: number;
  to: number;
}

export function findTimestamps(text: string): TimestampMatch[] {
  const matches: TimestampMatch[] = [];

  // Matches: fieldName: { ... seconds: "digits" ... nanos: digits ... }, however it is laid out.
  const regex = /(\w+):\s*\{([^{}]*seconds:\s*"(\d+)"[^{}]*nanos:\s*(\d+)[^{}]*)\}/gs;

  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      fieldName: match[1],
      seconds: match[3],
      nanos: parseInt(match[4], 10),
      anchor: text.indexOf("{", match.index),
      from: match.index,
      to: match.index + match[0].length,
    });
  }

  return matches;
}

export function timestampToDate(seconds: string, nanos: number): Date {
  const ms = parseInt(seconds, 10) * 1000 + Math.floor(nanos / 1_000_000);
  return new Date(ms);
}

export function dateToTimestamp(date: Date): { seconds: string; nanos: number } {
  const ms = date.getTime();
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms % 1000) * 1_000_000;
  return { seconds: seconds.toString(), nanos };
}

export function formatTimestampCode(fieldName: string, seconds: string, nanos: number): string {
  return `${fieldName}: { seconds: "${seconds}", nanos: ${nanos} }`;
}

export function formatDateForDisplay(date: Date): string {
  // Display in local timezone with timezone abbreviation
  const timeZone = new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() || "";
  return date.toLocaleString() + " " + timeZone;
}

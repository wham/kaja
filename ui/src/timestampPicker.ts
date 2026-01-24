import * as monaco from "monaco-editor";

// Regex to match timestamp objects: timestamp: { seconds: "...", nanos: ... }
// or { seconds: "...", nanos: ... } when it's a Timestamp field
const TIMESTAMP_REGEX = /(\w+):\s*\{\s*seconds:\s*"(\d+)",\s*nanos:\s*(\d+)\s*\}/g;

export interface TimestampMatch {
  fieldName: string;
  seconds: string;
  nanos: number;
  range: monaco.Range;
  fullMatch: string;
}

export function findTimestamps(model: monaco.editor.ITextModel): TimestampMatch[] {
  const matches: TimestampMatch[] = [];
  const text = model.getValue();
  const lines = text.split("\n");

  let lineNumber = 1;
  for (const line of lines) {
    TIMESTAMP_REGEX.lastIndex = 0;
    let match;
    while ((match = TIMESTAMP_REGEX.exec(line)) !== null) {
      const startColumn = match.index + 1;
      const endColumn = startColumn + match[0].length;

      matches.push({
        fieldName: match[1],
        seconds: match[2],
        nanos: parseInt(match[3], 10),
        range: new monaco.Range(lineNumber, startColumn, lineNumber, endColumn),
        fullMatch: match[0],
      });
    }
    lineNumber++;
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
  if (date.getTime() === 0) {
    return "Not set (epoch)";
  }
  return date.toLocaleString();
}

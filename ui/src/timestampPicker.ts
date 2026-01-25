import * as monaco from "monaco-editor";

export interface TimestampMatch {
  fieldName: string;
  seconds: string;
  nanos: number;
  range: monaco.Range;
  fullRange: monaco.Range;
}

export function findTimestamps(model: monaco.editor.ITextModel): TimestampMatch[] {
  const matches: TimestampMatch[] = [];
  const text = model.getValue();

  // Use multi-line regex to find timestamp objects regardless of formatting
  // Matches: fieldName: { ... seconds: "digits" ... nanos: digits ... }
  const regex = /(\w+):\s*\{([^{}]*seconds:\s*"(\d+)"[^{}]*nanos:\s*(\d+)[^{}]*)\}/gs;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const fieldName = match[1];
    const seconds = match[3];
    const nanos = parseInt(match[4], 10);

    // Find positions in the document
    const startOffset = match.index;
    const endOffset = startOffset + match[0].length;
    const braceOffset = text.indexOf("{", startOffset);

    const startPos = model.getPositionAt(startOffset);
    const endPos = model.getPositionAt(endOffset);
    const bracePos = model.getPositionAt(braceOffset);

    matches.push({
      fieldName,
      seconds,
      nanos,
      range: new monaco.Range(bracePos.lineNumber, bracePos.column, bracePos.lineNumber, bracePos.column + 1),
      fullRange: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
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
  if (date.getTime() === 0) {
    return "Not set";
  }
  // Display in local timezone with timezone abbreviation
  const timeZone = new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() || "";
  return date.toLocaleString() + " " + timeZone;
}

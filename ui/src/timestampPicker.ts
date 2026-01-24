import * as monaco from "monaco-editor";

export interface TimestampMatch {
  fieldName: string;
  seconds: string;
  nanos: number;
  range: monaco.Range;
  fullRange: monaco.Range;
}

// Pattern for single-line: fieldName: { seconds: "...", nanos: ... }
const SINGLE_LINE_REGEX = /(\w+):\s*\{\s*seconds:\s*"(\d+)",\s*nanos:\s*(\d+)\s*\}/g;

// Pattern to match "fieldName: {" at end of line (multi-line opening, brace on same line)
const FIELD_OPEN_BRACE_REGEX = /(\w+):\s*\{\s*$/;
// Pattern to match "fieldName:" at end of line (brace on next line)
const FIELD_ONLY_REGEX = /(\w+):\s*$/;
// Pattern to match just "{" (opening brace on its own line)
const BRACE_ONLY_REGEX = /^\s*\{\s*$/;
// Pattern to match seconds value
const SECONDS_REGEX = /seconds:\s*"(\d+)"/;
// Pattern to match nanos value
const NANOS_REGEX = /nanos:\s*(\d+)/;

export function findTimestamps(model: monaco.editor.ITextModel): TimestampMatch[] {
  const matches: TimestampMatch[] = [];
  const text = model.getValue();
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try single-line format first
    SINGLE_LINE_REGEX.lastIndex = 0;
    let singleMatch;
    while ((singleMatch = SINGLE_LINE_REGEX.exec(line)) !== null) {
      const fieldName = singleMatch[1];
      const seconds = singleMatch[2];
      const nanos = parseInt(singleMatch[3], 10);
      const startColumn = singleMatch.index + 1;
      const braceIndex = line.indexOf("{", singleMatch.index);
      const endColumn = singleMatch.index + singleMatch[0].length + 1;

      matches.push({
        fieldName,
        seconds,
        nanos,
        range: new monaco.Range(i + 1, braceIndex + 1, i + 1, braceIndex + 2),
        fullRange: new monaco.Range(i + 1, startColumn, i + 1, endColumn),
      });
    }

    // Try multi-line format: "fieldName: {" on same line
    const fieldBraceMatch = FIELD_OPEN_BRACE_REGEX.exec(line);
    if (fieldBraceMatch) {
      const result = scanForTimestamp(lines, i, i, fieldBraceMatch[1], fieldBraceMatch.index);
      if (result) matches.push(result);
      continue;
    }

    // Try multi-line format: "fieldName:" then "{" on next line
    const fieldOnlyMatch = FIELD_ONLY_REGEX.exec(line);
    if (fieldOnlyMatch && i + 1 < lines.length && BRACE_ONLY_REGEX.test(lines[i + 1])) {
      const result = scanForTimestamp(lines, i, i + 1, fieldOnlyMatch[1], fieldOnlyMatch.index);
      if (result) matches.push(result);
    }
  }

  return matches;
}

function scanForTimestamp(
  lines: string[],
  fieldLine: number,
  braceLine: number,
  fieldName: string,
  fieldIndex: number
): TimestampMatch | null {
  let seconds: string | null = null;
  let nanos: number | null = null;
  let closingLine = -1;

  // Look ahead for seconds, nanos, and closing brace (within next 5 lines after brace)
  for (let j = braceLine + 1; j < Math.min(braceLine + 6, lines.length); j++) {
    const nextLine = lines[j];

    const secondsMatch = SECONDS_REGEX.exec(nextLine);
    if (secondsMatch) {
      seconds = secondsMatch[1];
    }

    const nanosMatch = NANOS_REGEX.exec(nextLine);
    if (nanosMatch) {
      nanos = parseInt(nanosMatch[1], 10);
    }

    if (nextLine.includes("}")) {
      closingLine = j;
      break;
    }
  }

  if (seconds !== null && nanos !== null && closingLine !== -1) {
    const startColumn = fieldIndex + 1;
    const openBraceColumn = lines[braceLine].indexOf("{") + 1;

    return {
      fieldName,
      seconds,
      nanos,
      range: new monaco.Range(braceLine + 1, openBraceColumn, braceLine + 1, openBraceColumn + 1),
      fullRange: new monaco.Range(fieldLine + 1, startColumn, closingLine + 1, lines[closingLine].indexOf("}") + 2),
    };
  }

  return null;
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

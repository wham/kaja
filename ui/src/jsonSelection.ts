const TOKEN = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|\b(?:true|false|null)\b/g;

/**
 * The value a press on a printed line lands on, as Monaco columns (1-based,
 * end exclusive). A string is taken without its quotes, because what is copied
 * off a payload is almost always an id to paste somewhere that adds its own.
 */
export function valueAt(line: string, column: number): { start: number; end: number } | undefined {
  const offset = column - 1;
  for (const match of line.matchAll(TOKEN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset < start || offset >= end) continue;
    if (match[0].startsWith('"') && match[0].length > 2) return { start: start + 2, end };
    return { start: start + 1, end: end + 1 };
  }
  return undefined;
}

export interface LineRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/**
 * The next selection out from `range`: the member a value belongs to, then the
 * object or array holding that member, and so on to the whole document. Read
 * off indentation, which is what the pane prints, so a raw payload that isn't
 * indented goes straight to the whole of it. Lines are 1-based, as in Monaco.
 */
export function expandRange(lines: string[], range: LineRange): LineRange {
  const own = member(lines, range.startLine);
  if (contains(own, range) && !same(own, range)) return own;
  for (let line = range.startLine - 1; line >= 1; line--) {
    if (lines[line - 1].trim() === "" || indent(lines[line - 1]) >= indent(lines[range.startLine - 1])) continue;
    return member(lines, line);
  }
  const last = lines.length;
  return { startLine: 1, startColumn: 1, endLine: last, endColumn: lines[last - 1].length + 1 };
}

function member(lines: string[], line: number): LineRange {
  const text = lines[line - 1];
  let end = line;
  if (/[{[]$/.test(text.trimEnd())) {
    for (let next = line + 1; next <= lines.length; next++) {
      if (lines[next - 1].trim() !== "" && indent(lines[next - 1]) <= indent(text)) {
        end = next;
        break;
      }
    }
  }
  const tail = lines[end - 1].trimEnd();
  return { startLine: line, startColumn: indent(text) + 1, endLine: end, endColumn: (tail.endsWith(",") ? tail.length - 1 : tail.length) + 1 };
}

function indent(line: string): number {
  return line.length - line.trimStart().length;
}

function before(line: number, column: number, otherLine: number, otherColumn: number): boolean {
  return line < otherLine || (line === otherLine && column <= otherColumn);
}

function contains(outer: LineRange, inner: LineRange): boolean {
  return (
    before(outer.startLine, outer.startColumn, inner.startLine, inner.startColumn) && before(inner.endLine, inner.endColumn, outer.endLine, outer.endColumn)
  );
}

function same(a: LineRange, b: LineRange): boolean {
  return a.startLine === b.startLine && a.startColumn === b.startColumn && a.endLine === b.endLine && a.endColumn === b.endColumn;
}

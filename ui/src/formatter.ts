/**
 * The TypeScript language service's own formatter, which settles whitespace and
 * nothing else: it will not break a long line or insert a missing semicolon.
 * That is enough here because everything it is handed came off appLoader's
 * printer, one statement to a line. Handing it code nobody printed gets that
 * code back with its indentation tidied and nothing else.
 */

import ts from "typescript";

const FILE = "format.ts";

const settings: ts.FormatCodeSettings = {
  ...ts.getDefaultFormatCodeSettings("\n"),
  convertTabsToSpaces: true,
  tabSize: 2,
  indentSize: 2,
  indentStyle: ts.IndentStyle.Smart,
};

export function formatTypeScript(code: string): string {
  return applyEdits(code, editsFor(code));
}

/**
 * Formats and remaps an offset in the original code to the corresponding offset
 * in the formatted code, so positions survive the reformatting.
 */
export function formatTypeScriptWithCursor(code: string, cursorOffset: number): { code: string; cursorOffset: number } {
  const edits = editsFor(code);
  let moved = cursorOffset;

  for (const edit of edits) {
    const end = edit.span.start + edit.span.length;
    if (end <= cursorOffset) {
      moved += edit.newText.length - edit.span.length;
    } else if (edit.span.start < cursorOffset) {
      moved = edit.span.start + edit.newText.length;
    }
  }

  return { code: applyEdits(code, edits), cursorOffset: moved };
}

function editsFor(code: string): ts.TextChange[] {
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [FILE],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => (name === FILE ? ts.ScriptSnapshot.fromString(code) : undefined),
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => ({}),
    getDefaultLibFileName: () => "lib.d.ts",
    fileExists: (name) => name === FILE,
    readFile: (name) => (name === FILE ? code : undefined),
  };

  try {
    return ts.createLanguageService(host).getFormattingEditsForDocument(FILE, settings);
  } catch {
    console.warn("Failed to format typescript", code);
    return [];
  }
}

// Back to front, so an earlier edit's span still addresses the text it was read from.
function applyEdits(code: string, edits: ts.TextChange[]): string {
  let formatted = code;

  for (const edit of [...edits].sort((a, b) => b.span.start - a.span.start)) {
    formatted = formatted.slice(0, edit.span.start) + edit.newText + formatted.slice(edit.span.start + edit.span.length);
  }

  return formatted;
}

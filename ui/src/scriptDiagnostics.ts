import { noSuchScript } from "./scriptLink";
import { demandScriptParameters } from "./scriptParameters";
import { readRunReferences, RunReference, unresolvedIn } from "./scriptRuns";
import { lineColumnAt } from "./textBuffer";
import { askTypeScript, DIAGNOSTIC_ERROR, isSyntaxCode, writeTypeScriptFile } from "./typescriptService";

/**
 * What the editor says about a script nobody has open.
 *
 * A script's types are erased, not compiled (scriptRunner), so nothing on the run path
 * checks anything: a script with type errors runs, and one that doesn't parse stops
 * with no more than that to say. The person who opens the file sees the rest, because the editor's
 * TypeScript checks every script against the generated app modules — so this asks that
 * same worker rather than standing up a second checker, which is what keeps what an
 * agent is told from disagreeing with the squiggles in the window.
 *
 * A `kaja.run` naming no script is the one complaint the worker cannot make, a
 * destination being a name rather than an import. It is read from the same
 * `unresolvedIn` the editor marks with, for that same reason. What a destination
 * *takes* the worker does make, against a declaration read off the folder as it is
 * asked for — so this waits for the destinations it names rather than reporting on
 * whichever of them the window happened to have read.
 */

export interface ScriptDiagnostic {
  line: number;
  column: number;
  message: string;
}

// Where a script with no editor of its own is checked. Flat, like every script buffer,
// because the depth is what makes `import { Repos } from "github"` resolve to the app's
// barrel the way it does for an open script.
const CHECK_PATH = "/agent-check.ts";

// An import that names no app is left to the run, which refuses it by name — where
// the compiler's own two codes for it answer with tsconfig options (`moduleResolution`,
// `paths`) that a script has no access to and Kaja settles itself.
const MODULE_NOT_FOUND = [2307, 2792];

// One buffer, so checks are taken one at a time: two runs at once would otherwise
// read each other's diagnostics.
let queue: Promise<unknown> = Promise.resolve();

export function checkScript(code: string, scriptNames: string[]): Promise<ScriptDiagnostic[]> {
  const references = readRunReferences(code) ?? [];
  const known = demandScriptParameters(references.map((reference) => reference.name)).catch(() => {});
  const checked = queue.then(
    () => known.then(() => diagnose(code)),
    () => known.then(() => diagnose(code)),
  );
  queue = checked.catch(() => {});
  return checked.then((diagnostics) =>
    [...diagnostics, ...runDiagnostics(references, code, scriptNames)].sort((a, b) => a.line - b.line || a.column - b.column),
  );
}

function runDiagnostics(references: RunReference[], code: string, scriptNames: string[]): ScriptDiagnostic[] {
  return unresolvedIn(references, scriptNames).map((reference) => {
    const before = code.slice(0, reference.start);
    const newline = before.lastIndexOf("\n");
    return { line: before.split("\n").length, column: reference.start - newline, message: noSuchScript(reference.name) };
  });
}

async function diagnose(code: string): Promise<ScriptDiagnostic[]> {
  try {
    writeTypeScriptFile(CHECK_PATH, code);
    // The worker reports a file's syntax errors alone where it has any, since what the
    // checker says past one is noise.
    const found = await askTypeScript("diagnostics", CHECK_PATH);
    return found
      .filter((diagnostic) => diagnostic.category === DIAGNOSTIC_ERROR && (isSyntaxCode(diagnostic.code) || !MODULE_NOT_FOUND.includes(diagnostic.code)))
      .map((diagnostic) => {
        const { line, column } = lineColumnAt(code, diagnostic.start);
        return { line, column, message: diagnostic.message };
      });
  } catch {
    // A window whose worker failed says nothing rather than failing a run over it.
    return [];
  }
}

import * as monaco from "monaco-editor";
import { noSuchScript } from "./scriptLink";
import { demandScriptParameters } from "./scriptParameters";
import { readRunReferences, RunReference, unresolvedIn } from "./scriptRuns";

/**
 * What the editor says about a script nobody has open.
 *
 * A script's types are erased, not compiled (scriptRunner), so nothing on the run path
 * checks anything: a script with type errors runs, and one that doesn't parse stops
 * with no more than that to say. The person who opens the file sees the rest, because Monaco
 * checks every script model against the generated app modules — so this asks that
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

// Where a script with no editor of its own is checked. Flat, like every editor model
// (ts:/draft-….ts), because the depth is what makes `import { Shows } from "theatre"`
// resolve to the app's barrel model the way it does for an open script.
const CHECK_URI = "ts:/agent-check.ts";

// monaco's typescript namespace exports no DiagnosticCategory; the values are the
// compiler's own (warning 0, error 1, suggestion 2, message 3).
const ERROR = 1;

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
    const uri = monaco.Uri.parse(CHECK_URI);
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(code, "typescript", uri);
    if (model.getValue() !== code) model.setValue(code);

    const worker = await (await monaco.typescript.getTypeScriptWorker())(uri);
    const file = uri.toString();

    // A file that doesn't parse has no types to check, and what the checker says past a
    // syntax error is noise.
    const syntactic = (await worker.getSyntacticDiagnostics(file)).filter((diagnostic) => diagnostic.category === ERROR);
    if (syntactic.length > 0) return syntactic.map((diagnostic) => locate(model, diagnostic));

    const semantic = await worker.getSemanticDiagnostics(file);
    return semantic
      .filter((diagnostic) => diagnostic.category === ERROR && !MODULE_NOT_FOUND.includes(diagnostic.code))
      .map((diagnostic) => locate(model, diagnostic));
  } catch {
    // The worker belongs to the editor. A window without one says nothing rather than
    // failing a run over it.
    return [];
  }
}

function locate(model: monaco.editor.ITextModel, diagnostic: monaco.typescript.Diagnostic): ScriptDiagnostic {
  const position = model.getPositionAt(diagnostic.start ?? 0);
  return { line: position.lineNumber, column: position.column, message: flatten(diagnostic.messageText) };
}

/**
 * A message is one string or a chain of them, and the chain is where the explanation
 * is — "Type X is not assignable to type Y" on its own doesn't say which property
 * disagreed.
 */
function flatten(message: monaco.typescript.Diagnostic["messageText"]): string {
  if (typeof message === "string") return message;
  return [message.messageText, ...(message.next ?? []).map(flatten)].join(" ");
}

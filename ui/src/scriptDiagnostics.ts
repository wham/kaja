import * as monaco from "monaco-editor";

/**
 * What the type checker says about a script nobody has open.
 *
 * A script is transpiled, not compiled (scriptRunner), so nothing on the run path
 * type-checks: a script with type errors runs, and a syntax error is the only thing
 * that stops one. The person who opens the file sees the rest anyway, because Monaco
 * checks every script model against the generated app modules — so this asks that
 * same worker rather than standing up a second checker, which is what keeps what an
 * agent is told from disagreeing with the squiggles in the window.
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

export function checkScript(code: string): Promise<ScriptDiagnostic[]> {
  const checked = queue.then(
    () => diagnose(code),
    () => diagnose(code),
  );
  queue = checked.catch(() => {});
  return checked;
}

async function diagnose(code: string): Promise<ScriptDiagnostic[]> {
  try {
    const uri = monaco.Uri.parse(CHECK_URI);
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(code, "typescript", uri);
    if (model.getValue() !== code) model.setValue(code);

    const worker = await (await monaco.typescript.getTypeScriptWorker())(uri);
    const file = uri.toString();

    // A file that doesn't parse has no types to check: the run reports the syntax
    // error itself, and what the checker says past one is noise.
    const syntactic = await worker.getSyntacticDiagnostics(file);
    if (syntactic.some((diagnostic) => diagnostic.category === ERROR)) return [];

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

import type { Node } from "@babel/types";
import { runtimeNames } from "./scriptBindings";
import { isLinkedScript, linkName } from "./scriptLink";
import { isCall, literalText, memberAccess, parseScript, walk } from "./scriptSyntax";

/**
 * The scripts a script says it can reach: every `kaja.run("…")` in it, and where the
 * name sits.
 *
 * A destination is a name rather than a handle, so nothing in the language checks it —
 * a script whose target was renamed goes on compiling and fails at the click. Reading
 * the names off the AST is what gives the three answers around that one rule: the
 * squiggle over a name that reaches nothing, the completion inside the quotes, and the
 * rewrite a rename makes. All three resolve through `isLinkedScript`, which is what the
 * click itself resolves through, so none of them can disagree with what clicking does.
 *
 * The AST rather than a pattern over the text, for scriptInputs' reason: `kaja` is an
 * ordinary local binding, and a `kaja.run` in a comment or a string is not a
 * destination. A name the script computes is left alone rather than guessed at.
 */
export interface RunReference {
  /** The name between the quotes, as it is written. */
  name: string;
  /** Offsets of the contents, so a rewrite or a marker covers the name and not its quotes. */
  start: number;
  end: number;
}

/** Every destination the script names, in source order, or undefined where it doesn't parse. */
export function readRunReferences(code: string): RunReference[] | undefined {
  const file = parseScript(code);
  if (!file) return undefined;
  // A file mid-edit may not have written the import yet, and the runtime is spelled
  // `kaja` everywhere it isn't aliased.
  const runtime = runtimeNames(file);
  const receivers = runtime.size > 0 ? runtime : new Set(["kaja"]);

  const references: RunReference[] = [];
  walk(file.program, (node) => {
    if (!isCall(node)) return;
    const callee = memberAccess(node.callee);
    if (callee?.name === "run" && callee.object.type === "Identifier" && receivers.has(callee.object.name)) {
      const reference = contents(node.arguments[0], code);
      if (reference) references.push(reference);
    }
  });

  return references;
}

/** The destination the cursor is inside, which is where a script name is being typed. */
export function runNameAt(code: string, offset: number): RunReference | undefined {
  return readRunReferences(code)?.find((reference) => offset >= reference.start && offset <= reference.end);
}

/**
 * The destinations that reach nothing, against the names the scripts folder holds.
 * A blank one is left out: it is a script that named no script, which is what the run
 * itself refuses by name.
 */
export function unresolvedRuns(code: string, scriptNames: string[]): RunReference[] {
  return unresolvedIn(readRunReferences(code) ?? [], scriptNames);
}

/** The same, over references already read, so one pass answers everything asked of it. */
export function unresolvedIn(references: RunReference[], scriptNames: string[]): RunReference[] {
  return references.filter((reference) => reference.name !== "" && !scriptNames.some((script) => isLinkedScript(script, reference.name)));
}

/**
 * The same code with every destination a rename broke pointing at where its script went.
 *
 * The rule is asked twice: a name that reached the script before the rename and doesn't
 * after is a name the rename broke. A name that still resolves is left exactly as it
 * was, so a file moved between folders keeps every bare-name link to it — following a
 * move would rewrite a link that never stopped working.
 */
export function remapRunReferences(code: string, renames: Map<string, string>): string {
  if (renames.size === 0) return code;
  let next = code;
  // Back to front, so an earlier edit cannot move a later one's offsets.
  for (const reference of (readRunReferences(code) ?? []).reverse()) {
    const moved = destinationAfter(reference.name, renames);
    if (moved === undefined) continue;
    next = next.slice(0, reference.start) + moved + next.slice(reference.end);
  }
  return next;
}

function destinationAfter(name: string, renames: Map<string, string>): string | undefined {
  for (const [from, to] of renames) {
    if (!isLinkedScript(from, name) || isLinkedScript(to, name)) continue;
    // The extension is optional in a link and whoever wrote it chose, so the rewrite
    // says the new name the way the old one was said.
    return name.endsWith(".ts") ? `${linkName(to)}.ts` : linkName(to);
  }
  return undefined;
}

function contents(node: Node | undefined, code: string): RunReference | undefined {
  if (!node || literalText(node) === undefined) return undefined;
  const from = node.start! + 1;
  const to = node.end! - 1;
  const name = code.slice(from, to);
  // An escape makes what is written and what it means two different strings, and a
  // script name needs neither: the disk resolves a relative, forward-slashed name.
  return name.includes("\\") ? undefined : { name, start: from, end: to };
}

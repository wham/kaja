import ts from "typescript";
import { deriveDraftTitle } from "./draftTitle";

// A draft opened, never edited and never run is a browsing buffer, not work. The
// sweep drops one this old — the steady state of a pile that grows one row per method
// clicked is otherwise only ever upward.
export const SWEEP_DAYS = 7;

// How many drafts the sidebar draws before the rest become `n more…`. Capped rather
// than scrolled, so the Scripts region stays a predictable share of the panel.
export const VISIBLE_DRAFTS = 8;

/**
 * A draft is the unit of exploration: unlimited, kept in the app, named from its own
 * code. It has no name and no place, and that is the entire difference between it and
 * a file — not durability, since a draft survives quit and reopen exactly as a file
 * does. Naming one gives it both and moves it into Files.
 */
export interface Draft {
  id: string;
  // Always read from the code — there is no rename, because naming a draft and filing
  // it are the same act.
  title: string;
  code: string;
  // While the code still matches this and nothing has been run, the next method click
  // takes this draft over instead of starting another one.
  generatedCode: string;
  ran: boolean;
  // The qualifier beside the title, which tells two same-named calls in different apps
  // apart. A draft is not bound to the method it came from.
  originAppName?: string;
  // What an agent calls itself, on the one draft an MCP client writes in. It is what
  // pins the row above your own drafts, outside the count and outside the sweep.
  agentClient?: string;
  createdAt: number;
  updatedAt: number;
}

let sequence = 0;

export function newDraftId(): string {
  sequence++;
  return `draft-${Date.now().toString(36)}-${sequence}`;
}

export function createDraft(code: string, originAppName: string | undefined, now: number): Draft {
  return {
    id: newDraftId(),
    title: deriveDraftTitle(code) ?? "Draft",
    code,
    generatedCode: code,
    ran: false,
    originAppName,
    createdAt: now,
    updatedAt: now,
  };
}

// Untouched means still exactly what was generated, and never run.
export function isUntouched(draft: Draft): boolean {
  return !draft.ran && draft.code === draft.generatedCode;
}

// Two untouched drafts of the same call are one browsing buffer written twice, so a
// call reopens the buffer that already holds it rather than adding another beside it.
export function findUntouched(drafts: Draft[], code: string, originAppName: string | undefined): Draft | undefined {
  return drafts.find((draft) => !isAgentDraft(draft) && isUntouched(draft) && draft.code === code && draft.originAppName === originAppName);
}

// Reopening is not work, so it settles nothing — it only keeps the buffer at the top
// of the list and out of the way of the pruner.
export function reopen(draft: Draft, now: number): Draft {
  return { ...draft, updatedAt: now };
}

export function takeOver(draft: Draft, code: string, originAppName: string | undefined, now: number): Draft {
  return {
    ...draft,
    title: deriveDraftTitle(code) ?? "Draft",
    code,
    generatedCode: code,
    originAppName,
    updatedAt: now,
  };
}

// Adding a call is as deliberate as running one, so it settles the title the same
// way. Typing does not — that would rename the row under the cursor.
export function withCode(draft: Draft, code: string, now: number): Draft {
  return { ...draft, code, title: deriveDraftTitle(code) ?? draft.title, updatedAt: now };
}

// A run is the punctuation that settles a draft. Doing it on every keystroke would
// rename the row while you type.
export function markRun(draft: Draft, code: string, now: number): Draft {
  return {
    ...draft,
    code,
    title: deriveDraftTitle(code) ?? draft.title,
    ran: true,
    updatedAt: now,
  };
}

// Excluded from the count and from the sweep: it persists with no client connected,
// because that is how you read what the last one did.
export function isAgentDraft(draft: Draft): boolean {
  return draft.agentClient !== undefined;
}

/**
 * The order the Drafts group reads in: the agents' rows first, then edited drafts —
 * work never hides behind generated calls — then the browsing buffers, each half most
 * recently opened first.
 */
export function orderDrafts(drafts: Draft[]): Draft[] {
  const rank = (draft: Draft) => (isAgentDraft(draft) ? 0 : isUntouched(draft) ? 2 : 1);
  return [...drafts].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

// Clicking the method again regenerates the same code, so clearing these removes
// nothing you wrote.
export function untouchedDrafts(drafts: Draft[]): Draft[] {
  return drafts.filter((draft) => !isAgentDraft(draft) && isUntouched(draft));
}

// Unlimited only works if the browsing buffers clear themselves out. Anything run or
// edited is kept forever, and so is the agent's row.
export function pruneDrafts(drafts: Draft[], now: number, openIds: Set<string>, sweep = true): Draft[] {
  if (!sweep) return drafts;
  const cutoff = now - SWEEP_DAYS * 24 * 60 * 60 * 1000;
  return drafts.filter((draft) => openIds.has(draft.id) || isAgentDraft(draft) || !isUntouched(draft) || draft.updatedAt >= cutoff);
}

/**
 * Add a generated call to a draft that already holds one, merging the import lines
 * instead of stacking a second copy. Edits the existing text rather than reprinting
 * it, so whatever the author wrote keeps its formatting.
 */
export function appendCall(existingCode: string, generatedCode: string): string {
  const existing = ts.createSourceFile("existing.ts", existingCode, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const generated = ts.createSourceFile("generated.ts", generatedCode, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

  const body = statementsText(generated, generatedCode);
  if (!body) return existingCode;

  let code = existingCode;
  const additions: string[] = [];

  for (const imported of importsOf(generated, generatedCode)) {
    const target = importsOf(ts.createSourceFile("existing.ts", code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS), code).find(
      (candidate) => candidate.module === imported.module,
    );

    if (!target) {
      additions.push(imported.text);
      continue;
    }

    const missing = imported.names.filter((name) => !target.names.includes(name));
    if (missing.length === 0) continue;
    // Insert after the last name in the existing named imports, keeping whatever spacing
    // sits before the closing brace.
    const brace = code.lastIndexOf("}", target.end);
    if (brace === -1) continue;
    let at = brace;
    while (at > 0 && /\s/.test(code[at - 1])) at--;
    code = code.slice(0, at) + `, ${missing.join(", ")}` + code.slice(at);
  }

  if (additions.length > 0) {
    const last = importsOf(ts.createSourceFile("existing.ts", code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS), code).at(-1);
    const at = last ? last.end : 0;
    code = code.slice(0, at) + (at === 0 ? "" : "\n") + additions.join("\n") + code.slice(at);
  }

  return `${code.replace(/\s*$/, "")}\n\n${body}\n`;
}

interface ImportLine {
  module: string;
  names: string[];
  text: string;
  end: number;
}

function importsOf(file: ts.SourceFile, code: string): ImportLine[] {
  const lines: ImportLine[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.map((element) => element.name.text) : [];
    lines.push({ module: statement.moduleSpecifier.text, names, text: code.slice(statement.getStart(file), statement.end), end: statement.end });
  }
  return lines;
}

// Everything in the generated file that isn't an import: the call itself.
function statementsText(file: ts.SourceFile, code: string): string {
  const rest = file.statements.filter((statement) => !ts.isImportDeclaration(statement));
  if (rest.length === 0) return "";
  return code.slice(rest[0].getStart(file), rest[rest.length - 1].end).trim();
}

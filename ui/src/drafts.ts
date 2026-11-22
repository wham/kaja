import type { File } from "@babel/types";
import { deriveDraftTitle, titleParts } from "./draftTitle";
import { parseScript } from "./scriptSyntax";

// How many rows Recent draws before the rest are behind `Earlier…`. Capped rather
// than scrolled, so the Scripts region stays a predictable share of the panel.
export const VISIBLE_DRAFTS = 8;

// An agent's pile grows with nobody there to discard it, so it is the one that is bounded.
export const AGENT_DRAFTS = 5;

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
  // What an agent calls itself, on a draft it ran. It is who the row is signed by.
  agentName?: string;
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

// The dimming says the row holds nothing of yours; what it leaves open is what
// becomes of it, which is the one thing the note says. "Replaces" rather than takes
// over, the internal verb, because appending to a draft is the neighbouring gesture
// and the sentence has to be unmistakably not that.
export const BROWSING_NOTE = "The next call you pick replaces this.";

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
// of the list.
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

export function isAgentDraft(draft: Draft): boolean {
  return draft.agentName !== undefined;
}

// A bridge names itself after the agent it carries, in brackets: "claude-ai (via mcp-remote 0.16.6)".
export function agentLabel(agentName: string): string {
  return agentName.replace(/\s*\(.*\)\s*$/, "") || agentName;
}

/**
 * What Recent lists, newest first: everything that was run or written in. A call that
 * was only picked is not a run anybody made, so it is listed only while it is the one
 * on screen.
 */
export function recentDrafts(drafts: Draft[], currentId: string | undefined): Draft[] {
  return drafts.filter((draft) => draft.id === currentId || !isUntouched(draft)).sort((a, b) => b.updatedAt - a.updatedAt);
}

// The buffer the next picked call is written into. Any one will do, on screen or not,
// which is what keeps the unlisted ones from piling up.
export function findSpare(drafts: Draft[]): Draft | undefined {
  return drafts.find((draft) => !isAgentDraft(draft) && isUntouched(draft));
}

/**
 * The draft an agent's snippet runs in: the one that agent already ran the same call
 * in, so eight tries at a call are eight runs of one row and a different call is a row
 * of its own.
 */
export function findAgentDraft(drafts: Draft[], agentName: string, code: string): Draft | undefined {
  const name = titleParts(deriveDraftTitle(code) ?? "Draft").name;
  return drafts.find((draft) => draft.agentName === agentName && titleParts(draft.title).name === name);
}

// What an agent holds past its cap, oldest first out.
export function agentOverflow(drafts: Draft[], agentName: string): Draft[] {
  return drafts
    .filter((draft) => draft.agentName === agentName)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(AGENT_DRAFTS);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// A row's age in the width of a word: the column it sits in is the hover actions' own.
export function shortAge(then: number, now: number): string {
  const span = Math.max(0, now - then);
  if (span < MINUTE) return "now";
  if (span < HOUR) return `${Math.floor(span / MINUTE)}m`;
  if (span < DAY) return `${Math.floor(span / HOUR)}h`;
  const date = new Date(then);
  if (span < 7 * DAY) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Add a generated call to a draft that already holds one, merging the import lines
 * instead of stacking a second copy. Edits the existing text rather than reprinting
 * it, so whatever the author wrote keeps its formatting.
 */
export function appendCall(existingCode: string, generatedCode: string): string {
  const generated = parseScript(generatedCode);
  const body = generated ? statementsText(generated, generatedCode) : "";
  if (!generated || !body) return existingCode;
  return `${mergeImports(existingCode, generatedCode).replace(/\s*$/, "")}\n\n${body}\n`;
}

/**
 * The import lines of `importing` merged into `code`: a name a module already imports
 * is left alone, a missing one joins its line, and a module with no line gets one.
 */
export function mergeImports(existingCode: string, importing: string): string {
  let code = existingCode;
  const additions: string[] = [];

  for (const imported of importsOf(parseScript(importing), importing)) {
    // A draft mid-edit has no import lines to merge into, so the call brings its own.
    const target = importsOf(parseScript(code), code).find((candidate) => candidate.module === imported.module);

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
    const last = importsOf(parseScript(code), code).at(-1);
    const at = last ? last.end : 0;
    code = code.slice(0, at) + (at === 0 ? "" : "\n") + additions.join("\n") + (at === 0 ? "\n" : "") + code.slice(at);
  }

  return code;
}

interface ImportLine {
  module: string;
  names: string[];
  text: string;
  end: number;
}

function importsOf(file: File | undefined, code: string): ImportLine[] {
  const lines: ImportLine[] = [];
  for (const statement of file?.program.body ?? []) {
    if (statement.type !== "ImportDeclaration") continue;
    const names = statement.specifiers.flatMap((specifier) => (specifier.type === "ImportSpecifier" ? [specifier.local.name] : []));
    lines.push({ module: statement.source.value, names, text: code.slice(statement.start!, statement.end!), end: statement.end! });
  }
  return lines;
}

// Everything in the generated file that isn't an import: the call itself.
function statementsText(file: File, code: string): string {
  const rest = file.program.body.filter((statement) => statement.type !== "ImportDeclaration");
  if (rest.length === 0) return "";
  return code.slice(rest[0].start!, rest[rest.length - 1].end!).trim();
}

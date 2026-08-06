import ts from "typescript";
import { deriveScratchTitle } from "./scratchTitle";

// A scratch that was opened, never edited and never run is a browsing buffer,
// not work. It is dropped once it is this old.
const STALE_DAYS = 14;

// Where a scratch came from, so the sidebar can show which method you are
// looking at. Only a hint — the scratch is free to grow past it.
export interface ScratchOrigin {
  appName: string;
  serviceName: string;
  methodName: string;
}

/**
 * A scratch is the unit of exploration: unlimited, kept in the app, and named
 * from its own code. It is not a file — saving it as a script is what puts it
 * on disk, where agents and other tools can see it.
 */
export interface Scratch {
  id: string;
  title: string;
  // A rename pins the title; otherwise it is re-read from the code on each run.
  titlePinned: boolean;
  code: string;
  // What the scratch was born as. While the code still matches this and nothing
  // has been run, the next method click takes this scratch over instead of
  // starting another one.
  generatedCode: string;
  ran: boolean;
  origin?: ScratchOrigin;
  createdAt: number;
  updatedAt: number;
}

let sequence = 0;

export function newScratchId(): string {
  sequence++;
  return `scratch-${Date.now().toString(36)}-${sequence}`;
}

export function createScratch(code: string, origin: ScratchOrigin | undefined, now: number): Scratch {
  return {
    id: newScratchId(),
    title: deriveScratchTitle(code) ?? "Scratch",
    titlePinned: false,
    code,
    generatedCode: code,
    ran: false,
    origin,
    createdAt: now,
    updatedAt: now,
  };
}

// Untouched means: still exactly what was generated, and never run. Clicking
// another method takes such a scratch over rather than leaving a trail.
export function isUntouched(scratch: Scratch): boolean {
  return !scratch.ran && scratch.code === scratch.generatedCode;
}

export function takeOver(scratch: Scratch, code: string, origin: ScratchOrigin | undefined, now: number): Scratch {
  return {
    ...scratch,
    title: scratch.titlePinned ? scratch.title : (deriveScratchTitle(code) ?? "Scratch"),
    code,
    generatedCode: code,
    origin,
    updatedAt: now,
  };
}

// Adding a call is as deliberate as running one, so it settles the title the
// same way. Typing does not — that would rename the row under the cursor.
export function withCode(scratch: Scratch, code: string, now: number): Scratch {
  return { ...scratch, code, title: scratch.titlePinned ? scratch.title : (deriveScratchTitle(code) ?? scratch.title), updatedAt: now };
}

// A run is the punctuation that settles a scratch, so it is when the title is
// re-read. Doing it on every keystroke would rename the row while you type.
export function markRun(scratch: Scratch, code: string, now: number): Scratch {
  return {
    ...scratch,
    code,
    title: scratch.titlePinned ? scratch.title : (deriveScratchTitle(code) ?? scratch.title),
    ran: true,
    updatedAt: now,
  };
}

export function renameScratch(scratch: Scratch, title: string, now: number): Scratch {
  return { ...scratch, title: title.trim() || scratch.title, titlePinned: true, updatedAt: now };
}

// Unlimited only works if the browsing buffers clear themselves out. Anything
// run or edited is kept forever.
export function pruneScratches(scratches: Scratch[], now: number, openIds: Set<string>): Scratch[] {
  const cutoff = now - STALE_DAYS * 24 * 60 * 60 * 1000;
  return scratches.filter((scratch) => openIds.has(scratch.id) || !isUntouched(scratch) || scratch.updatedAt >= cutoff);
}

/**
 * Add a generated call to a scratch that already holds one, merging the import
 * lines instead of stacking a second copy. Edits the existing text rather than
 * reprinting it, so whatever the author wrote keeps its formatting.
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
    // Insert after the last name in the existing named imports, keeping
    // whatever spacing sits before the closing brace.
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
